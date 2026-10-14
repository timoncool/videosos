//! OpenRouter: one endpoint per modality — `/images` (answers at once), `/videos` (a job polled until it
//! ends), `/audio/speech` (the audio bytes), `/audio/transcriptions`, `/chat/completions`. Its catalogues
//! are public and typed, so forms are built from them without a schema.

use serde_json::{json, Map, Value};

use crate::http::{refusal, Http};
use crate::model::{Choice, Field, FieldKind, MediaKind, MediaPayload, ModelEntry, ModelForm, Output, Polled, PriceRule, Provider, ProviderError, Rate, Role, Submitted, Task};

const API: &str = "https://openrouter.ai/api/v1";

fn auth(key: &str) -> Option<(&'static str, String)> {
    Some(("Authorization", format!("Bearer {key}")))
}

fn created(model: &Value) -> Option<i64> {
    model["created"].as_i64()
}

fn short(text: &Value) -> String {
    text.as_str().map(|text| text.chars().take(300).collect()).unwrap_or_default()
}

/// Dollars with the digits that matter: 0.04, 0.0035, 12.5.
pub fn money(amount: f64) -> String {
    if amount == 0.0 {
        return "0".into();
    }
    let digits = if amount >= 1.0 { 2 } else { (2 - amount.log10().floor() as i32).clamp(2, 6) as usize };
    let text = format!("{amount:.digits$}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    text.to_string()
}

fn price_number(value: &Value) -> Option<f64> {
    value.as_str().and_then(|text| text.parse::<f64>().ok()).or_else(|| value.as_f64())
}

pub async fn catalog(http: &Http) -> Result<Vec<ModelEntry>, ProviderError> {
    let mut entries = Vec::new();
    let images: Value = http.get_json(&format!("{API}/images/models"), None).await?;
    for model in images["data"].as_array().into_iter().flatten() {
        let Some(id) = model["id"].as_str() else { continue };
        let references = model.pointer("/supported_parameters/input_references/max").and_then(Value::as_u64).unwrap_or(0);
        let mut tasks = vec![Task::Image];
        if references > 0 {
            tasks.push(Task::ImageEdit);
        }
        entries.push(ModelEntry {
            provider: Provider::Openrouter,
            id: id.to_string(),
            name: model["name"].as_str().unwrap_or(id).to_string(),
            description: short(&model["description"]),
            tasks,
            created: created(model),
            status: "live".into(),
            price: None,
            rates: Vec::new(),
            thumbnail: None,
            source: json!({ "kind": "image", "parameters": model["supported_parameters"] }),
        });
    }
    let videos: Value = http.get_json(&format!("{API}/videos/models"), None).await?;
    for model in videos["data"].as_array().into_iter().flatten() {
        let Some(id) = model["id"].as_str() else { continue };
        let lower = id.to_ascii_lowercase();
        let task = if lower.contains("upscale") {
            Task::Upscale
        } else if lower.contains("edit") || lower.contains("aleph") {
            Task::VideoEdit
        } else if lower.contains("avatar") {
            Task::LipSync
        } else {
            Task::Video
        };
        let rule = video_price(&model["pricing_skus"]);
        entries.push(ModelEntry {
            provider: Provider::Openrouter,
            id: id.to_string(),
            name: model["name"].as_str().unwrap_or(id).to_string(),
            description: short(&model["description"]),
            tasks: vec![task],
            created: created(model),
            status: "live".into(),
            price: None,
            rates: rule.rates.iter().filter(|rate| rate.unit == "second").min_by(|a, b| a.amount.total_cmp(&b.amount)).cloned().into_iter().collect(),
            thumbnail: None,
            source: json!({ "kind": "video", "model": model }),
        });
    }
    let all: Value = http.get_json(&format!("{API}/models?output_modalities=all"), None).await?;
    for model in all["data"].as_array().into_iter().flatten() {
        let Some(id) = model["id"].as_str() else { continue };
        let outputs: Vec<&str> = model.pointer("/architecture/output_modalities").and_then(Value::as_array).map(|list| list.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let prompt_price = price_number(&model["pricing"]["prompt"]);
        if prompt_price.is_some_and(|price| price < 0.0) {
            continue;
        }
        let (kind, task) = if outputs.contains(&"speech") {
            ("speech", Task::Speech)
        } else if outputs.contains(&"transcription") {
            ("transcribe", Task::Transcribe)
        } else if outputs == ["text"] {
            ("text", Task::Text)
        } else {
            continue;
        };
        let rates = match kind {
            "speech" => prompt_price.map(|amount| vec![Rate { amount, unit: "character".into(), label: None }]).unwrap_or_default(),
            "text" => prompt_price
                .zip(price_number(&model["pricing"]["completion"]))
                .map(|(input, output)| vec![Rate { amount: input, unit: "token_in".into(), label: None }, Rate { amount: output, unit: "token_out".into(), label: None }])
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        entries.push(ModelEntry {
            provider: Provider::Openrouter,
            id: id.to_string(),
            name: model["name"].as_str().unwrap_or(id).to_string(),
            description: short(&model["description"]),
            tasks: vec![task],
            created: created(model),
            status: if model["expiration_date"].is_null() { "live".into() } else { "deprecated".into() },
            price: None,
            rates,
            thumbnail: None,
            source: json!({ "kind": kind, "voices": model["supported_voices"], "pricing": model["pricing"], "parameters": model["supported_parameters"], "inputs": model.pointer("/architecture/input_modalities") }),
        });
    }
    Ok(entries)
}

/// Seconds of output, cents or dollars, per resolution and with or without sound, as the SKU keys say.
pub fn video_price(skus: &Value) -> PriceRule {
    let mut rates = Vec::new();
    let mut note = None;
    for (key, value) in skus.as_object().into_iter().flatten() {
        let Some(amount) = price_number(value) else { continue };
        let lower = key.to_ascii_lowercase();
        if lower.contains("token") {
            note = Some("billed by video tokens; the price is known after the run".to_string());
            continue;
        }
        let dollars = if lower.starts_with("cents") { amount / 100.0 } else { amount };
        let label = lower
            .split('_')
            .filter(|part| part.ends_with('p') && part[..part.len() - 1].chars().all(|c| c.is_ascii_digit()) || *part == "audio" || part.ends_with('k') && part.len() <= 3)
            .collect::<Vec<_>>()
            .join(" ");
        let unit = if lower.contains("second") {
            "second"
        } else if lower.contains("image_input") || lower.contains("per_image") {
            "image_input"
        } else if lower.contains("minimum") {
            "minimum"
        } else {
            "output"
        };
        rates.push(Rate { amount: dollars, unit: unit.into(), label: (!label.is_empty()).then_some(label) });
    }
    PriceRule { rates, note }
}

fn select(key: &str, label: &str, values: &Value, role: Option<Role>, advanced: bool) -> Option<Field> {
    let list = values.as_array()?;
    let options: Vec<Choice> = list.iter().filter(|value| !value.is_null()).map(|value| Choice { value: value.clone(), label: value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string()) }).collect();
    if options.is_empty() {
        return None;
    }
    Some(Field { key: key.into(), label: label.into(), description: None, default: options.first().map(|choice| choice.value.clone()), kind: FieldKind::Select { options }, required: false, advanced, role })
}

fn prompt(key: &str, label: &str, required: bool) -> Field {
    Field { key: key.into(), label: label.into(), description: None, kind: FieldKind::Textarea { max_length: None }, required, default: None, advanced: false, role: Some(Role::Prompt) }
}

fn media(key: &str, label: &str, kind: MediaKind, min: u32, max: u32, role: Role) -> Field {
    Field { key: key.into(), label: label.into(), description: None, kind: FieldKind::Media { media: kind, min, max, list: matches!(key, "input_references" | "input_images") }, required: min > 0, default: None, advanced: false, role: Some(role) }
}

pub fn form(entry: &ModelEntry) -> Result<ModelForm, ProviderError> {
    let source = &entry.source;
    let mut fields = Vec::new();
    let mut price = PriceRule::default();
    match source["kind"].as_str().unwrap_or_default() {
        "image" => {
            fields.push(prompt("prompt", "Prompt", true));
            let parameters = &source["parameters"];
            if let Some(max) = parameters.pointer("/input_references/max").and_then(Value::as_u64).filter(|max| *max > 0) {
                fields.push(media("input_references", "Reference images", MediaKind::Image, 0, max as u32, Role::Reference));
            }
            for (key, label, role, advanced) in [
                ("aspect_ratio", "Aspect ratio", Some(Role::Aspect), false),
                ("resolution", "Resolution", Some(Role::Resolution), false),
                ("size", "Size", Some(Role::Aspect), false),
                ("quality", "Quality", None, false),
                ("background", "Background", None, true),
                ("output_format", "Format", None, true),
            ] {
                if let Some(field) = select(key, label, &parameters[key]["values"], role, advanced) {
                    fields.push(field);
                }
            }
            if let Some(max) = parameters.pointer("/n/max").and_then(Value::as_u64).filter(|max| *max > 1) {
                fields.push(Field { key: "n".into(), label: "Images".into(), description: None, kind: FieldKind::Integer { min: Some(1.0), max: Some(max as f64) }, required: false, default: Some(json!(1)), advanced: false, role: Some(Role::Count) });
            }
            if parameters.get("seed").is_some() {
                fields.push(Field { key: "seed".into(), label: "Seed".into(), description: None, kind: FieldKind::Integer { min: Some(0.0), max: None }, required: false, default: None, advanced: true, role: Some(Role::Seed) });
            }
        }
        "video" => {
            let model = &source["model"];
            fields.push(prompt("prompt", "Prompt", true));
            if entry.tasks.contains(&Task::VideoEdit) {
                fields.push(media("input_video", "Source video", MediaKind::Video, 1, 1, Role::Source));
            }
            let frames: Vec<&str> = model["supported_frame_images"].as_array().map(|list| list.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
            if frames.contains(&"first_frame") {
                fields.push(media("frame_first", "First frame", MediaKind::Image, 0, 1, Role::FirstFrame));
            }
            if frames.contains(&"last_frame") {
                fields.push(media("frame_last", "Last frame", MediaKind::Image, 0, 1, Role::LastFrame));
            }
            if let Some(field) = select("duration", "Duration, s", &model["supported_durations"], Some(Role::Duration), false) {
                fields.push(field);
            }
            if let Some(field) = select("resolution", "Resolution", &model["supported_resolutions"], Some(Role::Resolution), false) {
                fields.push(field);
            }
            if let Some(field) = select("aspect_ratio", "Aspect ratio", &model["supported_aspect_ratios"], Some(Role::Aspect), false) {
                fields.push(field);
            }
            if let Some(field) = select("size", "Size", &model["supported_sizes"], Some(Role::Aspect), true) {
                fields.push(field);
            }
            if !model["generate_audio"].is_null() {
                fields.push(Field { key: "generate_audio".into(), label: "Sound".into(), description: None, kind: FieldKind::Boolean, required: false, default: model["generate_audio"].as_bool().map(Value::Bool), advanced: false, role: None });
            }
            if !model["seed"].is_null() {
                fields.push(Field { key: "seed".into(), label: "Seed".into(), description: None, kind: FieldKind::Integer { min: Some(0.0), max: None }, required: false, default: None, advanced: true, role: Some(Role::Seed) });
            }
            price = video_price(&model["pricing_skus"]);
        }
        "speech" => {
            fields.push(prompt("input", "Text", true));
            if let Some(field) = select("voice", "Voice", &source["voices"], Some(Role::Voice), false) {
                fields.push(field);
            }
            fields.push(Field { key: "instructions".into(), label: "How to read it".into(), description: Some("Tone, pace and emotion, in words.".into()), kind: FieldKind::Text { max_length: None }, required: false, default: None, advanced: true, role: None });
            fields.push(Field { key: "speed".into(), label: "Speed".into(), description: None, kind: FieldKind::Number { min: Some(0.5), max: Some(2.0) }, required: false, default: None, advanced: true, role: None });
            if let Some(per_character) = price_number(&source["pricing"]["prompt"]).filter(|price| *price > 0.0) {
                price.rates.push(Rate { amount: per_character, unit: "character".into(), label: None });
            }
        }
        "transcribe" => {
            fields.push(media("input_audio", "Audio", MediaKind::Audio, 1, 1, Role::Audio));
            fields.push(Field { key: "language".into(), label: "Language".into(), description: Some("ISO code, for example ru or en; empty to detect".into()), kind: FieldKind::Text { max_length: None }, required: false, default: None, advanced: false, role: None });
            price.note = Some("billed by the length of the recording".into());
        }
        "text" => {
            fields.push(prompt("prompt", "Request", true));
            if source["inputs"].as_array().is_some_and(|inputs| inputs.iter().any(|input| input == "image")) {
                fields.push(media("input_images", "Images", MediaKind::Image, 0, 4, Role::Reference));
            }
            fields.push(Field { key: "system".into(), label: "Instructions".into(), description: Some("How the model should answer".into()), kind: FieldKind::Textarea { max_length: None }, required: false, default: None, advanced: true, role: None });
            fields.push(Field { key: "temperature".into(), label: "Temperature".into(), description: None, kind: FieldKind::Number { min: Some(0.0), max: Some(2.0) }, required: false, default: None, advanced: true, role: None });
            if let (Some(input), Some(output)) = (price_number(&source["pricing"]["prompt"]), price_number(&source["pricing"]["completion"])) {
                price.rates.push(Rate { amount: input, unit: "token_in".into(), label: None });
                price.rates.push(Rate { amount: output, unit: "token_out".into(), label: None });
            }
        }
        other => return Err(ProviderError::Refused(format!("OpenRouter model kind {other} is not supported"))),
    }
    Ok(ModelForm {
        provider: Provider::Openrouter,
        id: entry.id.clone(),
        fields,
        price,
        delivery: if source["kind"] == "video" { "async".into() } else { "sync".into() },
        source: json!({ "kind": source["kind"] }),
    })
}

/// The per-image price of an image model, from its providers.
pub async fn image_price(http: &Http, id: &str) -> Result<PriceRule, ProviderError> {
    let body: Value = http.get_json(&format!("{API}/images/models/{id}/endpoints"), None).await?;
    let mut rates = Vec::new();
    let mut note = None;
    if let Some(endpoint) = body["endpoints"].as_array().and_then(|list| list.first()) {
        for price in endpoint["pricing"].as_array().into_iter().flatten() {
            let Some(amount) = price["cost_usd"].as_f64() else { continue };
            match (price["billable"].as_str(), price["unit"].as_str()) {
                (Some("output_image"), Some("image")) => rates.push(Rate { amount, unit: "output".into(), label: price["variant"].as_str().map(str::to_string) }),
                (Some("output_image"), Some("megapixel")) => rates.push(Rate { amount, unit: "megapixel".into(), label: None }),
                (Some("input_image" | "input_reference"), Some("image")) => rates.push(Rate { amount, unit: "image_input".into(), label: None }),
                _ => note = Some("billed by tokens; the price is known after the run".into()),
            }
        }
    }
    Ok(PriceRule { rates, note })
}

fn image_part(url: &str) -> Value {
    json!({ "type": "image_url", "image_url": { "url": url } })
}

/// The request for one run: media values are already data URLs.
pub fn build(form: &ModelForm, values: &Map<String, Value>) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert("model".into(), json!(form.id));
    for (key, value) in values {
        if value.is_null() || value.as_str().is_some_and(str::is_empty) || value.as_array().is_some_and(Vec::is_empty) {
            continue;
        }
        match key.as_str() {
            "input_references" => {
                let parts: Vec<Value> = value.as_array().into_iter().flatten().filter_map(Value::as_str).map(image_part).collect();
                body.insert("input_references".into(), Value::Array(parts));
            }
            "frame_first" | "frame_last" => {
                let url = value.as_array().and_then(|list| list.first()).and_then(Value::as_str).or(value.as_str());
                if let Some(url) = url {
                    let mut part = image_part(url);
                    part["frame_type"] = json!(if key == "frame_first" { "first_frame" } else { "last_frame" });
                    body.entry("frame_images").or_insert_with(|| json!([])).as_array_mut().expect("an array").push(part);
                }
            }
            "input_video" => {
                let url = value.as_array().and_then(|list| list.first()).and_then(Value::as_str).or(value.as_str());
                if let Some(url) = url {
                    let part = json!({ "type": "video_url", "video_url": { "url": url } });
                    body.entry("input_references").or_insert_with(|| json!([])).as_array_mut().expect("an array").push(part);
                }
            }
            "input_audio" => {
                let uri = value.as_array().and_then(|list| list.first()).and_then(Value::as_str).or(value.as_str()).unwrap_or_default();
                let (format, data) = split_data_uri(uri);
                body.insert("input_audio".into(), json!({ "data": data, "format": format }));
            }
            _ => {
                body.insert(key.clone(), value.clone());
            }
        }
    }
    body
}

fn split_data_uri(uri: &str) -> (String, String) {
    let Some(rest) = uri.strip_prefix("data:") else { return ("mp3".into(), uri.into()) };
    let (meta, data) = rest.split_once(',').unwrap_or(("audio/mpeg;base64", ""));
    let mime = meta.split(';').next().unwrap_or("audio/mpeg");
    let format = match mime {
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/flac" => "flac",
        "audio/ogg" => "ogg",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/webm" => "webm",
        _ => "mp3",
    };
    (format.into(), data.into())
}

fn cost_of(body: &Value) -> Option<f64> {
    body.pointer("/usage/cost").and_then(Value::as_f64)
}

async fn post(http: &Http, key: &str, path: &str, body: &Map<String, Value>) -> Result<Value, ProviderError> {
    let (status, value) = http.post_json(&format!("{API}{path}"), auth(key), &Value::Object(body.clone())).await?;
    if !status.is_success() {
        return Err(refusal(status, &value.to_string()));
    }
    Ok(value)
}

pub async fn submit(http: &Http, key: &str, form: &ModelForm, values: &Map<String, Value>) -> Result<Submitted, ProviderError> {
    let mut body = build(form, values);
    match form.source["kind"].as_str().unwrap_or_default() {
        "image" => {
            let answer = post(http, key, "/images", &body).await?;
            let outputs: Vec<Output> = answer["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    if let Some(data) = item["b64_json"].as_str() {
                        Some(Output::Data { data_base64: data.to_string(), mime: item["media_type"].as_str().unwrap_or("image/png").to_string() })
                    } else {
                        item["url"].as_str().map(|url| Output::Url { url: url.to_string(), mime: Some("image".into()) })
                    }
                })
                .collect();
            if outputs.is_empty() {
                return Err(ProviderError::Refused(format!("OpenRouter answered without an image: {}", answer.to_string().chars().take(300).collect::<String>())));
            }
            Ok(Submitted::Done { outputs, cost: cost_of(&answer) })
        }
        "video" => {
            let answer = post(http, key, "/videos", &body).await?;
            let id = answer["id"].as_str().ok_or_else(|| ProviderError::Refused(format!("OpenRouter took the video without an id: {answer}")))?;
            Ok(Submitted::Pending { handle: json!({ "id": id }) })
        }
        "speech" => {
            body.insert("response_format".into(), json!("mp3"));
            let response = http.client.post(format!("{API}/audio/speech")).bearer_auth(key).json(&Value::Object(body)).send().await?;
            let status = response.status();
            if !status.is_success() {
                return Err(refusal(status, &response.text().await.unwrap_or_default()));
            }
            let bytes = response.bytes().await?;
            use base64::Engine;
            Ok(Submitted::Done { outputs: vec![Output::Data { data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes), mime: "audio/mpeg".into() }], cost: None })
        }
        "transcribe" => {
            let answer = post(http, key, "/audio/transcriptions", &body).await?;
            let text = answer["text"].as_str().ok_or_else(|| ProviderError::Refused("OpenRouter answered without a transcript".into()))?;
            Ok(Submitted::Done { outputs: vec![Output::Text { text: text.to_string() }], cost: cost_of(&answer) })
        }
        "text" => {
            let mut messages = Vec::new();
            if let Some(system) = body.remove("system").and_then(|value| value.as_str().map(str::to_string)) {
                messages.push(json!({ "role": "system", "content": system }));
            }
            let request = body.remove("prompt").and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default();
            let images: Vec<Value> = body.remove("input_images").and_then(|value| value.as_array().cloned()).unwrap_or_default().iter().filter_map(Value::as_str).map(image_part).collect();
            if images.is_empty() {
                messages.push(json!({ "role": "user", "content": request }));
            } else {
                let mut content = vec![json!({ "type": "text", "text": request })];
                content.extend(images);
                messages.push(json!({ "role": "user", "content": content }));
            }
            body.insert("messages".into(), Value::Array(messages));
            let answer = post(http, key, "/chat/completions", &body).await?;
            let text = answer.pointer("/choices/0/message/content").and_then(Value::as_str).ok_or_else(|| ProviderError::Refused(format!("OpenRouter answered without text: {}", answer.to_string().chars().take(300).collect::<String>())))?;
            Ok(Submitted::Done { outputs: vec![Output::Text { text: text.to_string() }], cost: cost_of(&answer) })
        }
        other => Err(ProviderError::Refused(format!("OpenRouter model kind {other} is not supported"))),
    }
}

pub async fn poll(http: &Http, key: &str, handle: &Value) -> Result<Polled, ProviderError> {
    let id = handle["id"].as_str().unwrap_or_default();
    let answer: Value = http.get_json(&format!("{API}/videos/{id}"), auth(key)).await?;
    match answer["status"].as_str() {
        Some("completed") => {
            let count = answer["unsigned_urls"].as_array().map(Vec::len).unwrap_or(1).max(1);
            let outputs = (0..count).map(|index| Output::Url { url: format!("{API}/videos/{id}/content?index={index}"), mime: Some("video".into()) }).collect();
            Ok(Polled::Done { outputs, cost: cost_of(&answer) })
        }
        Some("failed" | "cancelled" | "expired") => Ok(Polled::Failed {
            message: answer["error"].as_str().map(str::to_string).unwrap_or_else(|| format!("the video job ended as {}", answer["status"].as_str().unwrap_or_default())),
        }),
        _ => Ok(Polled::Waiting { progress: answer["progress"].as_f64().map(|p| if p > 1.0 { p / 100.0 } else { p }) }),
    }
}

/// Files of a finished video are read with the key.
pub fn needs_key_to_download(url: &str) -> bool {
    url.starts_with(API)
}

pub fn upload(media: &MediaPayload) -> String {
    media.data_uri()
}

/// What the key may still spend, when it has a limit.
pub async fn balance(http: &Http, key: &str) -> Result<Option<f64>, ProviderError> {
    let answer: Value = http.get_json(&format!("{API}/key"), auth(key)).await?;
    Ok(answer.pointer("/data/limit_remaining").and_then(Value::as_f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_model_that_sees_pictures_takes_them() {
        let entry = |inputs: Value| ModelEntry {
            provider: Provider::Openrouter,
            id: "x/vision".into(),
            name: "Vision".into(),
            description: String::new(),
            tasks: vec![Task::Text],
            created: None,
            status: "live".into(),
            price: None,
            rates: Vec::new(),
            thumbnail: None,
            source: json!({ "kind": "text", "pricing": {}, "parameters": [], "inputs": inputs }),
        };
        let seeing = form(&entry(json!(["text", "image"]))).unwrap();
        assert!(seeing.fields.iter().any(|field| field.key == "input_images"));
        let blind = form(&entry(json!(["text"]))).unwrap();
        assert!(!blind.fields.iter().any(|field| field.key == "input_images"));
    }

    #[test]
    fn a_video_edit_model_takes_its_source_as_a_video_reference() {
        let entry = ModelEntry {
            provider: Provider::Openrouter,
            id: "black-forest-labs/flux-video-edit".into(),
            name: "FLUX Video Edit".into(),
            description: String::new(),
            tasks: vec![Task::VideoEdit],
            created: None,
            status: "live".into(),
            price: None,
            rates: Vec::new(),
            thumbnail: None,
            source: json!({ "kind": "video", "model": { "pricing_skus": {} } }),
        };
        let edit = form(&entry).unwrap();
        let source = edit.fields.iter().find(|field| field.key == "input_video").expect("a source video field");
        assert!(source.required && source.role == Some(Role::Source));
        let values = Map::from_iter([("prompt".into(), json!("paint it")), ("input_video".into(), json!(["data:video/mp4;base64,AAAA"]))]);
        let body = build(&edit, &values);
        assert_eq!(body["input_references"], json!([{ "type": "video_url", "video_url": { "url": "data:video/mp4;base64,AAAA" } }]));
        assert!(body.get("input_video").is_none());
    }

    #[test]
    fn video_skus_become_rates() {
        let skus = json!({"cents_per_image_input": "1", "cents_per_video_output_second_720p": "3", "duration_seconds_1080p_audio": "0.4"});
        let rule = video_price(&skus);
        assert!(rule.rates.iter().any(|rate| rate.unit == "second" && (rate.amount - 0.03).abs() < 1e-9 && rate.label.as_deref() == Some("720p")));
        assert!(rule.rates.iter().any(|rate| rate.unit == "second" && (rate.amount - 0.4).abs() < 1e-9 && rate.label.as_deref() == Some("1080p audio")));
        assert!(rule.rates.iter().any(|rate| rate.unit == "image_input"));
    }

    #[test]
    fn frames_and_references_take_the_shape_openrouter_reads() {
        let form = ModelForm { provider: Provider::Openrouter, id: "x/v".into(), fields: Vec::new(), price: PriceRule::default(), delivery: "async".into(), source: json!({"kind": "video"}) };
        let mut values = Map::new();
        values.insert("prompt".into(), json!("rain"));
        values.insert("frame_first".into(), json!(["data:image/png;base64,AA"]));
        values.insert("duration".into(), json!(4));
        let body = build(&form, &values);
        assert_eq!(body["frame_images"][0]["frame_type"], "first_frame");
        assert_eq!(body["frame_images"][0]["image_url"]["url"], "data:image/png;base64,AA");
        assert_eq!(body["duration"], 4);
    }

    #[test]
    fn audio_goes_as_raw_base64_with_its_format() {
        assert_eq!(split_data_uri("data:audio/wav;base64,UklG"), ("wav".to_string(), "UklG".to_string()));
    }
}
