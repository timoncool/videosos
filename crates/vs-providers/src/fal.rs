//! fal.ai: a model is an endpoint id, one per mode (text-to-video and image-to-video are two endpoints).
//! Jobs go through the queue (`queue.fal.run`): submit, poll `status_url`, read `response_url`. The
//! catalogue (`api.fal.ai/v1/models`) and each model's OpenAPI need no key; prices do.

use serde_json::{json, Map, Value};

use crate::http::{refusal, Http};
use crate::model::{MediaPayload, ModelEntry, ModelForm, Output, Polled, PriceRule, Provider, ProviderError, Rate, Submitted, Task};
use crate::schema_form::{fields_of_object, resolve, unflatten, Skip};

const PLATFORM: &str = "https://api.fal.ai/v1";
const QUEUE: &str = "https://queue.fal.run";
const STORAGE: &str = "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";

/// The categories the catalogue is read for, in the order a person meets them.
pub const CATEGORIES: &[&str] = &[
    "text-to-image",
    "image-to-image",
    "text-to-video",
    "image-to-video",
    "video-to-video",
    "text-to-speech",
    "text-to-audio",
    "audio-to-audio",
    "speech-to-text",
];

fn auth(key: &str) -> Option<(&'static str, String)> {
    Some(("Authorization", format!("Key {key}")))
}

pub fn tasks_of(category: &str, endpoint: &str, name: &str) -> Vec<Task> {
    let lower = format!("{endpoint} {name}").to_ascii_lowercase();
    let is = |words: &[&str]| words.iter().any(|word| lower.contains(word));
    match category {
        "text-to-image" => vec![Task::Image],
        "image-to-image" if is(&["upscal", "esrgan", "clarity", "seedvr"]) => vec![Task::Upscale],
        "image-to-image" if is(&["background", "birefnet", "rembg", "bria/background"]) => vec![Task::RemoveBackground],
        "image-to-image" => vec![Task::ImageEdit],
        "text-to-video" | "image-to-video" if is(&["lipsync", "lip-sync", "avatar", "omnihuman"]) => vec![Task::LipSync],
        "text-to-video" | "image-to-video" => vec![Task::Video],
        "video-to-video" if is(&["lipsync", "lip-sync", "latentsync"]) => vec![Task::LipSync],
        "video-to-video" if is(&["upscal", "seedvr", "topaz"]) => vec![Task::Upscale],
        "video-to-video" if is(&["mmaudio", "foley", "sound"]) => vec![Task::Sound],
        "video-to-video" => vec![Task::VideoEdit],
        "text-to-speech" => vec![Task::Speech],
        "text-to-audio" if is(&["sound", "sfx", "effect", "foley"]) => vec![Task::Sound],
        "text-to-audio" if is(&["speech", "tts", "voice"]) => vec![Task::Speech],
        "text-to-audio" => vec![Task::Music],
        "audio-to-audio" if is(&["voice", "speech"]) => vec![Task::Speech],
        "audio-to-audio" => vec![Task::Music],
        "speech-to-text" => vec![Task::Transcribe],
        _ => Vec::new(),
    }
}

fn entry_of(model: &Value) -> Option<ModelEntry> {
    let endpoint = model["endpoint_id"].as_str()?.to_string();
    let meta = &model["metadata"];
    let name = meta["display_name"].as_str().unwrap_or(&endpoint).to_string();
    let category = meta["category"].as_str().unwrap_or_default();
    let tasks = tasks_of(category, &endpoint, &name);
    if tasks.is_empty() || meta["kind"].as_str().is_some_and(|kind| kind != "inference") {
        return None;
    }
    let created = meta["date"].as_str().and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok()).map(|date| date.timestamp());
    Some(ModelEntry {
        provider: Provider::Fal,
        id: endpoint,
        name,
        description: meta["description"].as_str().map(|text| text.chars().take(300).collect()).unwrap_or_default(),
        tasks,
        created,
        status: if meta["status"].as_str() == Some("deprecated") { "deprecated".into() } else { "live".into() },
        price: None,
        rates: Vec::new(),
        thumbnail: meta["thumbnail_url"].as_str().map(str::to_string),
        source: json!({ "category": category }),
    })
}

/// The catalogue, `pages` pages of twelve per category (the API stalls on larger pages). A page is tried
/// three times; a category that still fails keeps what was read and is named in the second list.
pub async fn catalog(http: &Http, pages: usize) -> (Vec<ModelEntry>, Vec<String>) {
    let mut entries: Vec<ModelEntry> = Vec::new();
    let mut failures = Vec::new();
    for category in CATEGORIES {
        let mut cursor: Option<String> = None;
        for _ in 0..pages {
            let mut url = format!("{PLATFORM}/models?limit=12&status=active&category={category}");
            if let Some(cursor) = &cursor {
                url.push_str(&format!("&cursor={cursor}"));
            }
            let mut page: Option<Value> = None;
            let mut last_error = String::new();
            for attempt in 0..3u64 {
                match http.get_json::<Value>(&url, None).await {
                    Ok(value) => {
                        page = Some(value);
                        break;
                    }
                    Err(error) => {
                        last_error = error.to_string();
                        tokio::time::sleep(std::time::Duration::from_secs(2 * (attempt + 1))).await;
                    }
                }
            }
            let Some(page) = page else {
                failures.push(format!("{category}: {last_error}"));
                break;
            };
            for model in page["models"].as_array().into_iter().flatten() {
                if let Some(entry) = entry_of(model)
                    && !entries.iter().any(|seen| seen.id == entry.id) {
                        entries.push(entry);
                    }
            }
            cursor = page["next_cursor"].as_str().map(str::to_string);
            if cursor.is_none() || page["has_more"] == false {
                break;
            }
        }
    }
    (entries, failures)
}

/// Models matching a search, straight from fal.
pub async fn search(http: &Http, query: &str) -> Result<Vec<ModelEntry>, ProviderError> {
    let url = format!("{PLATFORM}/models?limit=12&status=active&q={}", urlencode(query));
    let page: Value = http.get_json(&url, None).await?;
    Ok(page["models"].as_array().into_iter().flatten().filter_map(entry_of).collect())
}

fn urlencode(text: &str) -> String {
    text.bytes()
        .map(|byte| if byte.is_ascii_alphanumeric() || b"-_.~/".contains(&byte) { (byte as char).to_string() } else { format!("%{byte:02X}") })
        .collect()
}

/// The model's OpenAPI document.
pub async fn openapi(http: &Http, endpoint: &str) -> Result<Value, ProviderError> {
    let url = format!("{PLATFORM}/models?endpoint_id={}&expand=openapi-3.0", urlencode(endpoint));
    let page: Value = http.get_json(&url, None).await?;
    page["models"]
        .as_array()
        .and_then(|models| models.first())
        .map(|model| model["openapi"].clone())
        .filter(|document| !document.is_null())
        .ok_or_else(|| ProviderError::Refused(format!("fal has no description of {endpoint}")))
}

fn input_schema(document: &Value) -> Option<&Value> {
    let paths = document.get("paths")?.as_object()?;
    for (path, item) in paths {
        if path.contains("/requests/") {
            continue;
        }
        if let Some(schema) = item.pointer("/post/requestBody/content/application~1json/schema") {
            return Some(resolve(document, schema));
        }
    }
    document
        .pointer("/components/schemas")
        .and_then(Value::as_object)
        .and_then(|schemas| schemas.iter().find(|(name, _)| name.ends_with("Input")).map(|(_, schema)| schema))
}

pub fn form(endpoint: &str, document: &Value) -> Result<ModelForm, ProviderError> {
    let input = input_schema(document).ok_or_else(|| ProviderError::Refused(format!("fal's description of {endpoint} has no input")))?;
    let order: Option<Vec<String>> = input
        .get("x-fal-order-properties")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect());
    let mut fields = fields_of_object(
        document,
        input,
        "",
        &Skip { keys: &["sync_mode", "webhook_url", "enable_safety_checker", "safety_tolerance"] },
        false,
        order.as_deref(),
    );
    crate::schema_form::order_fields(&mut fields);
    Ok(ModelForm {
        provider: Provider::Fal,
        id: endpoint.to_string(),
        fields,
        price: PriceRule::default(),
        delivery: "async".into(),
        source: Value::Null,
    })
}

/// The price per unit; fal asks for a key.
pub async fn price(http: &Http, key: &str, endpoint: &str) -> Result<PriceRule, ProviderError> {
    let url = format!("{PLATFORM}/models/pricing?endpoint_id={}", urlencode(endpoint));
    let body: Value = http.get_json(&url, auth(key)).await?;
    let rates = body["prices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|price| {
            let amount = price["unit_price"].as_f64()?;
            let unit = match price["unit"].as_str().unwrap_or("request") {
                "image" | "images" | "request" | "video" | "videos" | "generation" => "output",
                "second" | "seconds" | "video second" | "video_seconds" | "audio second" => "second",
                "megapixel" | "megapixels" => "megapixel",
                "character" | "characters" | "1000 characters" => "character",
                other => other,
            };
            let amount = if price["unit"].as_str() == Some("1000 characters") { amount / 1000.0 } else { amount };
            Some(Rate { amount, unit: unit.to_string(), label: price["unit"].as_str().map(str::to_string) })
        })
        .collect();
    Ok(PriceRule { rates, note: None })
}

pub fn build_input(values: &Map<String, Value>) -> Map<String, Value> {
    let kept: Map<String, Value> = values
        .iter()
        .filter(|(_, value)| !(value.is_null() || value.as_str().is_some_and(str::is_empty) || value.as_array().is_some_and(Vec::is_empty)))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    unflatten(&kept)
}

pub async fn submit(http: &Http, key: &str, endpoint: &str, input: Map<String, Value>) -> Result<Submitted, ProviderError> {
    let url = format!("{QUEUE}/{endpoint}");
    let (status, body) = http.post_json(&url, auth(key), &Value::Object(input)).await?;
    if !status.is_success() {
        return Err(refusal(status, &body.to_string()));
    }
    let handle = json!({
        "request_id": body["request_id"],
        "status_url": body["status_url"],
        "response_url": body["response_url"],
        "cancel_url": body["cancel_url"],
    });
    if handle["status_url"].as_str().is_none() || handle["response_url"].as_str().is_none() {
        return Err(ProviderError::Refused(format!("fal took the job but gave no address to follow it: {body}")));
    }
    Ok(Submitted::Pending { handle })
}

pub async fn poll(http: &Http, key: &str, handle: &Value) -> Result<Polled, ProviderError> {
    let status_url = handle["status_url"].as_str().unwrap_or_default();
    let status: Value = http.get_json(status_url, auth(key)).await?;
    match status["status"].as_str() {
        Some("COMPLETED") => {
            if let Some(error) = status["error"].as_str().filter(|error| !error.is_empty()) {
                let kind = status["error_type"].as_str().unwrap_or_default();
                return Ok(Polled::Failed { message: if kind.is_empty() { error.to_string() } else { format!("{error} ({kind})") } });
            }
            let response_url = handle["response_url"].as_str().unwrap_or_default();
            let response = http.client.get(response_url).header("Authorization", format!("Key {key}")).send().await?;
            let code = response.status();
            let text = response.text().await?;
            if !code.is_success() {
                return Ok(Polled::Failed { message: refusal(code, &text).to_string() });
            }
            let body: Value = serde_json::from_str(&text).map_err(|error| ProviderError::Network(format!("fal result: {error}")))?;
            let outputs = outputs_of(&body);
            if outputs.is_empty() {
                return Ok(Polled::Failed { message: format!("fal finished without a file: {}", text.chars().take(300).collect::<String>()) });
            }
            Ok(Polled::Done { outputs, cost: None })
        }
        _ => Ok(Polled::Waiting { progress: None }),
    }
}

pub async fn cancel(http: &Http, key: &str, handle: &Value) -> Result<(), ProviderError> {
    let Some(url) = handle["cancel_url"].as_str() else {
        return Err(ProviderError::Refused("fal gave no address to cancel the job".into()));
    };
    let response = http.client.put(url).header("Authorization", format!("Key {key}")).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(refusal(status, &response.text().await.unwrap_or_default()));
    }
    Ok(())
}

/// Files anywhere in a fal result: objects with an http `url`.
pub fn outputs_of(body: &Value) -> Vec<Output> {
    let mut found = Vec::new();
    collect(body, &mut found);
    if found.is_empty()
        && let Some(text) = body.get("text").and_then(Value::as_str) {
            found.push(Output::Text { text: text.to_string() });
        }
    found
}

fn collect(node: &Value, found: &mut Vec<Output>) {
    match node {
        Value::Object(map) => {
            if let Some(url) = map.get("url").and_then(Value::as_str).filter(|url| url.starts_with("http")) {
                let mime = map.get("content_type").and_then(Value::as_str).map(str::to_string);
                found.push(Output::Url { url: url.to_string(), mime });
                return;
            }
            for value in map.values() {
                collect(value, found);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect(item, found)),
        _ => {}
    }
}

/// A file onto fal's CDN, for a job to read.
pub async fn upload(http: &Http, key: &str, media: &MediaPayload) -> Result<String, ProviderError> {
    let (status, body) = http.post_json(STORAGE, auth(key), &json!({ "content_type": media.mime, "file_name": media.name })).await?;
    if !status.is_success() {
        return Err(refusal(status, &body.to_string()));
    }
    let upload_url = body["upload_url"].as_str().ok_or_else(|| ProviderError::Refused("fal gave no upload address".into()))?;
    let file_url = body["file_url"].as_str().ok_or_else(|| ProviderError::Refused("fal gave no file address".into()))?.to_string();
    let put = http.client.put(upload_url).header("Content-Type", media.mime.clone()).body(media.bytes.clone()).send().await?;
    if !put.status().is_success() {
        let code = put.status();
        return Err(refusal(code, &put.text().await.unwrap_or_default()));
    }
    Ok(file_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schnell_form_reads_the_input_in_fal_order() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fal-schnell.json");
        let page: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let document = &page["models"][0]["openapi"];
        let form = form("fal-ai/flux/schnell", document).unwrap();
        let keys: Vec<&str> = form.fields.iter().map(|field| field.key.as_str()).collect();
        assert!(keys.contains(&"prompt") && keys.contains(&"image_size") && keys.contains(&"num_images"), "{keys:?}");
        assert!(!keys.contains(&"sync_mode"));
        let size = form.fields.iter().find(|field| field.key == "image_size").unwrap();
        assert!(matches!(&size.kind, crate::model::FieldKind::Select { options } if options.len() == 6));
    }

    #[test]
    fn files_are_found_anywhere_in_a_result() {
        let body = json!({"images": [{"url": "https://v3b.fal.media/a.png", "content_type": "image/png"}], "seed": 1});
        assert_eq!(outputs_of(&body), vec![Output::Url { url: "https://v3b.fal.media/a.png".into(), mime: Some("image/png".into()) }]);
        let video = json!({"video": {"url": "https://v3b.fal.media/b.mp4"}});
        assert_eq!(outputs_of(&video).len(), 1);
        assert_eq!(outputs_of(&json!({"text": "hello"})), vec![Output::Text { text: "hello".into() }]);
    }

    #[test]
    fn categories_name_the_tasks() {
        assert_eq!(tasks_of("image-to-image", "fal-ai/birefnet/v2", "BiRefNet"), vec![Task::RemoveBackground]);
        assert_eq!(tasks_of("video-to-video", "fal-ai/sync-lipsync/v3", "Sync Lipsync"), vec![Task::LipSync]);
        assert_eq!(tasks_of("text-to-audio", "fal-ai/elevenlabs/sound-effects/v2", "Sound Effects"), vec![Task::Sound]);
    }
}
