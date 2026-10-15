//! Runware: one `POST https://api.runware.ai/v1` taking an array of tasks. The catalogue is the public
//! `docs/models/index.json`; each model's `schema.json` is a JSON Schema of its task, with its price
//! (`x-pricing`) and modes (`x-modes`). Videos run `async` and are polled with `getResponse` on the same
//! `taskUUID` — a job is never sent again under a new one, which would be paid twice.

use serde_json::{json, Map, Value};

use crate::http::Http;
use crate::model::{Choice, Field, FieldKind, MediaPayload, ModelEntry, ModelForm, Output, Polled, PriceRule, Provider, ProviderError, Rate, Role, Submitted, Task};
use crate::schema_form::{fields_of_object, size_presets, unflatten, Skip};

const API: &str = "https://api.runware.ai/v1";
const INDEX: &str = "https://runware.ai/docs/models/index.json";

/// The tasks a model serves, from its capabilities and its name.
pub fn tasks_of(capabilities: &[String], id: &str, name: &str) -> Vec<Task> {
    let has = |capability: &str| capabilities.iter().any(|c| c == capability);
    let lower = format!("{id} {name}").to_ascii_lowercase();
    if has("remove-background") {
        return vec![Task::RemoveBackground];
    }
    if has("upscale") {
        return vec![Task::Upscale];
    }
    let mut tasks = Vec::new();
    if has("text-to-image") {
        tasks.push(Task::Image);
    }
    if has("edit") || has("inpaint") || (has("image-to-image") && !has("vectorize")) {
        tasks.push(Task::ImageEdit);
    }
    if has("text-to-video") || has("image-to-video") {
        tasks.push(Task::Video);
    }
    if has("video-to-video") || has("extend") {
        tasks.push(Task::VideoEdit);
    }
    if has("audio-to-video") || lower.contains("lipsync") || lower.contains("lip-sync") || lower.contains("avatar") {
        tasks.push(Task::LipSync);
    }
    if has("text-to-audio") || has("audio-to-audio") || has("video-to-audio") || has("image-to-audio") {
        if lower.contains("speech") || lower.contains("tts") || lower.contains("voice") || lower.contains("dia") {
            tasks.push(Task::Speech);
        } else if lower.contains("mirelo") || lower.contains("sound") || lower.contains("sfx") || lower.contains("foley") || has("video-to-audio") {
            tasks.push(Task::Sound);
        } else {
            tasks.push(Task::Music);
        }
    }
    tasks.dedup();
    tasks
}

pub async fn catalog(http: &Http) -> Result<Vec<ModelEntry>, ProviderError> {
    let index: Vec<Value> = http.get_json(INDEX, None).await?;
    let mut entries = Vec::new();
    for model in index {
        let capabilities: Vec<String> = model["capabilities"].as_array().map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
        let id = model["air"].as_str().unwrap_or_default().to_string();
        let name = model["name"].as_str().unwrap_or_default().to_string();
        let slug = model["id"].as_str().unwrap_or_default().to_string();
        let tasks = tasks_of(&capabilities, &slug, &name);
        let status = model["status"].as_str().unwrap_or("live").to_string();
        if tasks.is_empty() || id.is_empty() || !matches!(status.as_str(), "live" | "deprecated") {
            continue;
        }
        entries.push(ModelEntry {
            provider: Provider::Runware,
            id,
            name,
            description: String::new(),
            tasks,
            created: None,
            status,
            price: None,
            rates: Vec::new(),
            thumbnail: Some(format!("https://assets.runware.ai/covers/{slug}.jpg")),
            source: json!({ "schema": model["schema"], "slug": slug, "capabilities": capabilities }),
        });
    }
    Ok(entries)
}

/// Reads a model's schema for what the catalogue shows before a form is opened: release, price, status.
pub fn details(schema: &Value) -> (Option<i64>, Option<String>, Option<String>) {
    let info = &schema["info"];
    let created = info["x-released-at"].as_str().and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok()).map(|date| date.timestamp());
    let price = info["x-pricing"]["rates"].as_array().and_then(|rates| rates.first()).and_then(|rate| rate["display"].as_str()).map(|display| {
        let label = info["x-pricing"]["rates"][0]["label"].as_str().map(|label| format!(" ({label})")).unwrap_or_default();
        format!("{display}{label}")
    });
    let description = info["description"].as_str().map(|text| text.chars().take(300).collect());
    (created, price, description)
}

const SKIP: &[&str] = &[
    "taskType", "taskUUID", "model", "webhookURL", "includeCost", "uploadEndpoint", "ttl", "outputType",
    "deliveryMethod", "safety", "advancedFeatures", "width", "height", "providerSettings", "acceleratorOptions",
    "outputFormat",
];

fn task_schema(schema: &Value) -> Result<&Value, ProviderError> {
    schema
        .pointer("/components/schemas/RequestBody/items")
        .ok_or_else(|| ProviderError::Refused("the model's schema has no task description".into()))
}

pub fn form(model: &str, schema: &Value) -> Result<ModelForm, ProviderError> {
    let task = task_schema(schema)?;
    let properties = task.get("properties").and_then(Value::as_object).cloned().unwrap_or_default();
    let mut fields = fields_of_object(schema, task, "", &Skip { keys: SKIP }, false, None);
    if properties.contains_key("width") && properties.contains_key("height") {
        let mut options = size_presets(task);
        if options.is_empty() {
            options = sizes_from_constraints(task);
        }
        if !options.is_empty() {
            let default = options
                .iter()
                .find(|choice| choice.label.contains("16:9"))
                .or_else(|| options.first())
                .map(|choice| choice.value.clone());
            fields.push(
                Field {
                    key: "size".into(),
                    label: "Size".into(),
                    description: None,
                    kind: FieldKind::Size { options, width_key: "width".into(), height_key: "height".into() },
                    required: false,
                    default,
                    advanced: false,
                    role: Some(Role::Size),
                },
            );
        } else {
            for key in ["width", "height"] {
                fields.push(Field {
                    key: key.into(),
                    label: if key == "width" { "Width".into() } else { "Height".into() },
                    description: None,
                    kind: FieldKind::Integer { min: Some(64.0), max: Some(4096.0) },
                    required: false,
                    default: None,
                    advanced: false,
                    role: Some(Role::Size),
                });
            }
        }
    }
    let task_type = properties.get("taskType").and_then(|node| node.get("const")).and_then(Value::as_str).unwrap_or("imageInference").to_string();
    let deliveries: Vec<String> = properties
        .get("deliveryMethod")
        .map(|node| {
            let mut found: Vec<String> = node.get("enum").and_then(Value::as_array).map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
            if let Some(list) = node.get("oneOf").and_then(Value::as_array) {
                found.extend(list.iter().filter_map(|alt| alt.get("const").and_then(Value::as_str)).map(str::to_string));
            }
            found
        })
        .unwrap_or_default();
    let delivery = if deliveries.iter().any(|d| d == "async") && (task_type != "imageInference" || !deliveries.iter().any(|d| d == "sync")) {
        "async"
    } else {
        "sync"
    };
    crate::schema_form::order_fields(&mut fields);
    Ok(ModelForm {
        provider: Provider::Runware,
        id: model.to_string(),
        fields,
        price: price_rule(schema),
        delivery: delivery.into(),
        source: json!({ "taskType": task_type }),
    })
}

/// Common shapes inside the area and ratio limits of `x-constraints`, for models that take any width and
/// height: each aspect at the smallest allowed area (about a megapixel when the model sets no limit) and
/// at four megapixels when that fits.
fn sizes_from_constraints(task: &Value) -> Vec<Choice> {
    let constraints = task.get("x-constraints").and_then(Value::as_array).cloned().unwrap_or_default();
    let limit = |operation: &str, bound: &str| {
        constraints
            .iter()
            .find(|c| c["operation"] == operation && c["parameters"] == json!(["width", "height"]))
            .and_then(|c| c[bound].as_f64())
    };
    let min_area = limit("area", "minimum").unwrap_or(1024.0 * 1024.0);
    let max_area = limit("area", "maximum").unwrap_or(4096.0 * 4096.0);
    let width = task.pointer("/properties/width").cloned().unwrap_or(Value::Null);
    let step = width.get("multipleOf").and_then(Value::as_f64).unwrap_or(16.0).max(1.0);
    let min_side = width.get("minimum").and_then(Value::as_f64).unwrap_or(0.0);
    let max_side = width.get("maximum").and_then(Value::as_f64).unwrap_or(f64::MAX);
    let aspects: [(&str, f64, f64); 8] = [("1:1", 1.0, 1.0), ("16:9", 16.0, 9.0), ("9:16", 9.0, 16.0), ("4:3", 4.0, 3.0), ("3:4", 3.0, 4.0), ("3:2", 3.0, 2.0), ("2:3", 2.0, 3.0), ("21:9", 21.0, 9.0)];
    let mut options = Vec::new();
    for target in [min_area.max(1024.0 * 1024.0), 4.0 * 1024.0 * 1024.0] {
        for (label, aw, ah) in aspects {
            let unit = (target / (aw * ah)).sqrt();
            let round = |v: f64| ((v / step).round() * step) as u64;
            let (w, h) = (round(aw * unit), round(ah * unit));
            let area = (w * h) as f64;
            let sides_fit = [w, h].iter().all(|side| (*side as f64) >= min_side && (*side as f64) <= max_side);
            if area < min_area * 0.97 || area > max_area || !sides_fit {
                continue;
            }
            let value = Value::String(format!("{w}x{h}"));
            if options.iter().any(|c: &Choice| c.value == value) {
                continue;
            }
            options.push(Choice { value, label: format!("{label} · {w}×{h}") });
        }
    }
    options
}

fn price_rule(schema: &Value) -> PriceRule {
    let pricing = &schema["info"]["x-pricing"];
    let rates = pricing["rates"]
        .as_array()
        .map(|rates| {
            rates
                .iter()
                .filter_map(|rate| {
                    let amount = rate["amount"].as_f64()?;
                    let unit = match rate["unit"].as_str()? {
                        "durationSecond" => "second",
                        "output" => "output",
                        "inputImage" => "image_input",
                        "character" | "utf8Byte" => "character",
                        "outputMegapixel" | "inputMegapixel" => "megapixel",
                        "inputToken" => "token_in",
                        "outputToken" => "token_out",
                        other => other,
                    };
                    Some(Rate { amount, unit: unit.to_string(), label: rate["label"].as_str().map(str::to_string) })
                })
                .collect()
        })
        .unwrap_or_default();
    PriceRule { rates, note: pricing["overview"].as_str().map(|text| text.trim().to_string()) }
}

/// The task as Runware takes it: dotted keys nested, the size split into width and height, our task id,
/// cost asked for.
pub fn build_task(model: &str, form: &ModelForm, values: &Map<String, Value>, task_uuid: &str) -> Map<String, Value> {
    let mut flat = Map::new();
    for (key, value) in values {
        if value.is_null() || value.as_str().is_some_and(str::is_empty) || value.as_array().is_some_and(Vec::is_empty) {
            continue;
        }
        if key == "size" {
            if let Some((w, h)) = value.as_str().and_then(|size| size.split_once('x'))
                && let (Ok(w), Ok(h)) = (w.parse::<u64>(), h.parse::<u64>()) {
                    flat.insert("width".into(), json!(w));
                    flat.insert("height".into(), json!(h));
                }
            continue;
        }
        flat.insert(key.clone(), value.clone());
    }
    let mut task = unflatten(&flat);
    task.insert("taskType".into(), form.source["taskType"].clone());
    task.insert("taskUUID".into(), json!(task_uuid));
    task.insert("model".into(), json!(model));
    task.insert("includeCost".into(), json!(true));
    task.insert("deliveryMethod".into(), json!(form.delivery));
    task
}

/// The size pair the form offers first, sent only when the task needs a size and the person chose none.
pub fn default_size(form: &ModelForm) -> Option<String> {
    form.fields.iter().find(|field| matches!(field.kind, FieldKind::Size { .. })).and_then(|field| field.default.as_ref()).and_then(Value::as_str).map(str::to_string)
}

/// The task as given when the schema accepts it; when it lacks the size the schema requires and the person chose
/// none, the same task with the form's first size. Nothing the person chose is ever dropped: a combination the
/// model refuses comes back as the schema's own complaint.
pub fn pick_valid(schema: &Value, task: Map<String, Value>, fallback_size: Option<&str>) -> Result<Map<String, Value>, ProviderError> {
    let item = task_schema(schema)?.clone();
    let mut validator_schema = item;
    if let (Some(object), Some(components)) = (validator_schema.as_object_mut(), schema.get("components")) {
        object.insert("components".into(), components.clone());
    }
    let validator = jsonschema::validator_for(&validator_schema).map_err(|error| ProviderError::Refused(format!("the model's schema does not compile: {error}")))?;
    let given = Value::Object(task.clone());
    if validator.is_valid(&given) {
        return Ok(task);
    }
    if !task.contains_key("width")
        && let Some((w, h)) = fallback_size.and_then(|size| size.split_once('x')).and_then(|(w, h)| Some((w.parse::<u64>().ok()?, h.parse::<u64>().ok()?))) {
            let mut sized = task.clone();
            sized.insert("width".into(), json!(w));
            sized.insert("height".into(), json!(h));
            if validator.is_valid(&Value::Object(sized.clone())) {
                return Ok(sized);
            }
        }
    let mut problems: Vec<String> = validator.iter_errors(&given).map(|error| describe(&error)).collect();
    problems.dedup();
    problems.truncate(3);
    Err(ProviderError::Refused(format!("the model does not accept these settings: {}", problems.join("; "))))
}

/// A schema complaint in the person's terms. The validator's own text quotes the whole value it judged, which
/// for a task holds every setting and the files as data URLs; this names the settings instead.
fn describe(error: &jsonschema::ValidationError) -> String {
    use jsonschema::error::ValidationErrorKind as Kind;
    let setting = |name: &str| if name == "width" || name == "height" { "size".to_string() } else { name.to_string() };
    let names = |values: Vec<String>| {
        let mut names: Vec<String> = values.iter().map(|name| setting(name)).collect();
        names.dedup();
        names.join(", ")
    };
    let path = error.instance_path().as_str().trim_start_matches('/').replace('/', ".");
    match error.kind() {
        Kind::Not { schema } => {
            let mut required = Vec::new();
            collect_required(schema, &mut required);
            if required.is_empty() {
                format!("{} is not allowed with the other settings", if path.is_empty() { "this combination".into() } else { setting(&path) })
            } else {
                format!("{} cannot be set together with the other settings chosen; leave it empty", names(required))
            }
        }
        Kind::Required { property } => format!("{} is required", setting(property.as_str().unwrap_or_default())),
        Kind::AdditionalProperties { unexpected } => format!("the model does not take {}", names(unexpected.clone())),
        _ if path.is_empty() => format!("the settings do not fit the model's rules ({})", error.schema_path().as_str()),
        _ => {
            let text = error.to_string();
            let short: String = text.chars().take(200).collect();
            format!("{}: {}{}", setting(&path), short, if text.chars().count() > 200 { "..." } else { "" })
        }
    }
}

fn collect_required(schema: &Value, into: &mut Vec<String>) {
    match schema {
        Value::Object(object) => {
            if let Some(Value::Array(names)) = object.get("required") {
                into.extend(names.iter().filter_map(Value::as_str).map(str::to_string));
            }
            object.iter().filter(|(key, _)| key.as_str() != "required").for_each(|(_, value)| collect_required(value, into));
        }
        Value::Array(items) => items.iter().for_each(|item| collect_required(item, into)),
        _ => {}
    }
}

fn errors_of(body: &Value) -> Option<(String, bool)> {
    let errors = body.get("errors")?.as_array()?;
    let first = errors.first()?;
    let code = first["code"].as_str().unwrap_or_default();
    let message = first["message"].as_str().unwrap_or("Runware refused the task");
    let busy = matches!(code, "rateLimitExceeded" | "inferenceRateLimitExceeded" | "serviceOverloaded" | "serviceUnavailable");
    Some((format!("{message} ({code})"), busy))
}

fn outputs_of(item: &Value) -> Vec<Output> {
    let mut outputs = Vec::new();
    for (key, mime) in [("imageURL", "image"), ("videoURL", "video"), ("audioURL", "audio"), ("mediaURL", ""), ("glbURL", "")] {
        if let Some(url) = item.get(key).and_then(Value::as_str) {
            outputs.push(Output::Url { url: url.to_string(), mime: (!mime.is_empty()).then(|| mime.to_string()) });
        }
    }
    if let Some(files) = item.pointer("/outputs/files").and_then(Value::as_array) {
        for file in files {
            if let Some(url) = file.get("url").and_then(Value::as_str) {
                outputs.push(Output::Url { url: url.to_string(), mime: None });
            }
        }
    }
    if outputs.is_empty()
        && let Some(text) = item.get("text").and_then(Value::as_str) {
            outputs.push(Output::Text { text: text.to_string() });
        }
    outputs
}

async fn post(http: &Http, key: &str, tasks: Value) -> Result<Value, ProviderError> {
    let (status, body) = http.post_json(API, Some(("Authorization", format!("Bearer {key}"))), &tasks).await?;
    if let Some((message, busy)) = errors_of(&body) {
        let has_data = body.get("data").and_then(Value::as_array).is_some_and(|data| !data.is_empty());
        if !has_data {
            return Err(if busy { ProviderError::Busy(message) } else { ProviderError::Refused(message) });
        }
    }
    if !status.is_success() && body.get("data").is_none() {
        let message = format!("Runware answered {status}");
        // a gateway error may come after Runware took the task: its outcome is unknown, not a refusal
        return Err(if status.as_u16() == 429 {
            ProviderError::Busy(message)
        } else if status.is_server_error() {
            ProviderError::Network(message)
        } else {
            ProviderError::Refused(message)
        });
    }
    Ok(body)
}

pub async fn submit(http: &Http, key: &str, task: Map<String, Value>) -> Result<Submitted, ProviderError> {
    let task_uuid = task["taskUUID"].as_str().unwrap_or_default().to_string();
    let task_type = task["taskType"].as_str().unwrap_or_default().to_string();
    let asynchronous = task.get("deliveryMethod").and_then(Value::as_str) == Some("async");
    let body = post(http, key, Value::Array(vec![Value::Object(task)])).await?;
    if asynchronous {
        return Ok(Submitted::Pending { handle: json!({ "taskUUID": task_uuid, "taskType": task_type }) });
    }
    let items: Vec<&Value> = body["data"].as_array().map(|data| data.iter().filter(|item| item["taskUUID"] == task_uuid.as_str()).collect()).unwrap_or_default();
    let cost: f64 = items.iter().filter_map(|item| item["cost"].as_f64()).sum();
    let outputs: Vec<Output> = items.iter().flat_map(|item| outputs_of(item)).collect();
    if outputs.is_empty() {
        return Err(ProviderError::Refused("Runware finished the task but sent no result".into()));
    }
    Ok(Submitted::Done { outputs, cost: (cost > 0.0).then_some(cost) })
}

pub async fn poll(http: &Http, key: &str, handle: &Value) -> Result<Polled, ProviderError> {
    let task_uuid = handle["taskUUID"].as_str().unwrap_or_default();
    let body = match post(http, key, json!([{ "taskType": "getResponse", "taskUUID": task_uuid }])).await {
        Ok(body) => body,
        Err(ProviderError::Refused(message)) => return Ok(Polled::Failed { message }),
        Err(other) => return Err(other),
    };
    let items: Vec<&Value> = body["data"].as_array().map(|data| data.iter().filter(|item| item["taskUUID"] == task_uuid).collect()).unwrap_or_default();
    if items.is_empty() {
        if let Some((message, _)) = errors_of(&body) {
            return Ok(Polled::Failed { message });
        }
        return Ok(Polled::Waiting { progress: None });
    }
    if items.iter().any(|item| item["status"] == "error") {
        let message = items.iter().find_map(|item| item["message"].as_str()).unwrap_or("Runware could not make it").to_string();
        return Ok(Polled::Failed { message });
    }
    let done: Vec<&&Value> = items.iter().filter(|item| item["status"] == "success" || (item.get("status").is_none() && !outputs_of(item).is_empty())).collect();
    // getResponse lists the results finished so far: a task of several waits for all of them
    let expected = handle["results"].as_u64().unwrap_or(1).max(1) as usize;
    if done.len() == items.len() && done.len() >= expected {
        let cost: f64 = items.iter().filter_map(|item| item["cost"].as_f64()).sum();
        let outputs: Vec<Output> = items.iter().flat_map(|item| outputs_of(item)).collect();
        return Ok(Polled::Done { outputs, cost: (cost > 0.0).then_some(cost) });
    }
    let progress = items.iter().filter_map(|item| item["progress"].as_f64()).fold(None, |acc: Option<f64>, p| Some(acc.map_or(p, |a| a.min(p))));
    Ok(Polled::Waiting { progress: progress.map(|p| p / 100.0) })
}

/// A file for a task: small images go inline, the rest through Runware's media storage.
pub async fn upload(http: &Http, key: &str, media: &MediaPayload) -> Result<String, ProviderError> {
    if media.mime.starts_with("image/") && media.bytes.len() <= 4 * 1024 * 1024 {
        return Ok(media.data_uri());
    }
    let task_uuid = uuid::Uuid::new_v4().to_string();
    let body = post(http, key, json!([{ "taskType": "mediaStorage", "taskUUID": task_uuid, "operation": "upload", "media": media.data_uri() }])).await?;
    body["data"]
        .as_array()
        .and_then(|data| data.iter().find_map(|item| item["mediaURL"].as_str().or(item["mediaUUID"].as_str())))
        .map(str::to_string)
        .ok_or_else(|| ProviderError::Refused("Runware stored the file but gave no address for it".into()))
}

/// The account balance in USD.
pub async fn balance(http: &Http, key: &str) -> Result<Option<f64>, ProviderError> {
    let body = post(http, key, json!([{ "taskType": "accountManagement", "taskUUID": uuid::Uuid::new_v4().to_string(), "operation": "getDetails" }])).await?;
    Ok(body["data"].as_array().and_then(|data| data.first()).and_then(|item| item["balance"].as_f64().or_else(|| item["balance"]["amount"].as_f64())))
}

/// A sized choice list helper used by the tests and the snapshot.
pub fn choices_of(field: &Field) -> Vec<Choice> {
    match &field.kind {
        FieldKind::Select { options } | FieldKind::Size { options, .. } => options.clone(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn video_form_has_prompt_frame_and_size() {
        let schema = fixture("rw-schema-xai-grok-imagine-video-1-5-lite.json");
        let form = form("xai:grok-imagine@video-1.5-lite", &schema).unwrap();
        assert_eq!(form.delivery, "async");
        assert_eq!(form.source["taskType"], "videoInference");
        let keys: Vec<&str> = form.fields.iter().map(|field| field.key.as_str()).collect();
        assert!(keys.contains(&"positivePrompt"), "{keys:?}");
        assert!(keys.contains(&"inputs.frameImages"), "{keys:?}");
        assert!(keys.contains(&"size"), "{keys:?}");
        assert!(keys.contains(&"duration"), "{keys:?}");
        let frames = form.fields.iter().find(|field| field.key == "inputs.frameImages").unwrap();
        assert_eq!(frames.role, Some(Role::FirstFrame));
        assert!(matches!(frames.kind, FieldKind::Media { max: 1, list: true, .. }));
        assert!(form.price.rates.iter().any(|rate| rate.unit == "second" && rate.label.as_deref() == Some("720p")));
    }

    #[test]
    fn text_to_video_keeps_the_size_and_image_to_video_drops_it() {
        let schema = fixture("rw-schema-xai-grok-imagine-video-1-5-lite.json");
        let form = form("xai:grok-imagine@video-1.5-lite", &schema).unwrap();
        let mut values = Map::new();
        values.insert("positivePrompt".into(), json!("a lighthouse at dusk"));
        values.insert("size".into(), json!("848x480"));
        values.insert("duration".into(), json!(2));
        let task = build_task(&form.id, &form, &values, "3f0c2a7e-0000-4000-8000-000000000001");
        let chosen = pick_valid(&schema, task, default_size(&form).as_deref()).unwrap();
        assert_eq!(chosen["width"], 848);
        assert!(chosen.get("resolution").is_none());

        values.remove("size");
        let task = build_task(&form.id, &form, &values, "3f0c2a7e-0000-4000-8000-000000000003");
        let chosen = pick_valid(&schema, task, default_size(&form).as_deref()).unwrap();
        assert!(chosen.get("width").is_some(), "text-to-video gets the form's first size: {chosen:?}");

        values.insert("inputs.frameImages".into(), json!(["https://example.com/a.png"]));
        values.insert("resolution".into(), json!("480p"));
        let task = build_task(&form.id, &form, &values, "3f0c2a7e-0000-4000-8000-000000000002");
        let chosen = pick_valid(&schema, task, default_size(&form).as_deref()).unwrap();
        assert!(chosen.get("width").is_none(), "{chosen:?}");
        assert_eq!(chosen["resolution"], "480p");

        values.insert("size".into(), json!("848x480"));
        values.insert("inputs.frameImages".into(), json!([format!("data:image/jpeg;base64,{}", "A".repeat(4000))]));
        let task = build_task(&form.id, &form, &values, "3f0c2a7e-0000-4000-8000-000000000004");
        let refusal = pick_valid(&schema, task, default_size(&form).as_deref()).expect_err("a size the model refuses with frames is reported, not dropped").to_string();
        assert!(refusal.contains("size cannot be set together"), "{refusal}");
        assert!(!refusal.contains("base64") && refusal.len() < 400, "the refusal names settings, not their values: {refusal}");
    }

    #[test]
    fn keyframes_pinned_at_seconds_pass_the_models_schema() {
        let schema = fixture("rw-schema-bfl-flux-3-video.json");
        let form = form("bfl:flux@3-video", &schema).unwrap();
        let frames = form.fields.iter().find(|field| field.key == "inputs.frameImages").unwrap();
        assert!(matches!(frames.kind, FieldKind::Media { max: 10, at: Some(crate::model::FrameAt::Second { max }), .. } if max == 20.0), "{frames:?}");
        let duration = form.fields.iter().find(|field| field.key == "duration").unwrap();
        let durations: Vec<Value> = choices_of(duration).into_iter().map(|choice| choice.value).collect();
        assert!(durations.contains(&json!("auto")) && durations.contains(&json!(5)) && durations.contains(&json!(20)), "{durations:?}");

        let mut values = Map::new();
        values.insert("positivePrompt".into(), json!("a paper boat drifts down a rainy street"));
        values.insert("duration".into(), json!(5));
        values.insert("inputs.frameImages".into(), json!([
            { "image": "https://example.com/a.png", "timestamp": 0.0 },
            "https://example.com/b.png",
            { "image": "https://example.com/c.png", "timestamp": 4.5 },
        ]));
        let task = build_task(&form.id, &form, &values, "3f0c2a7e-0000-4000-8000-000000000005");
        let chosen = pick_valid(&schema, task, default_size(&form).as_deref()).unwrap();
        assert_eq!(chosen["inputs"]["frameImages"][2]["timestamp"], 4.5);

        values.insert("inputs.frameImages".into(), json!([{ "image": "https://example.com/a.png", "timestamp": 25.0 }]));
        let task = build_task(&form.id, &form, &values, "3f0c2a7e-0000-4000-8000-000000000006");
        assert!(pick_valid(&schema, task, default_size(&form).as_deref()).is_err(), "a second past the video is refused before sending");
    }

    #[test]
    fn image_form_and_sync_delivery() {
        let schema = fixture("rw-schema-bytedance-seedream-5-0-flash.json");
        let form = form("bytedance:seedream@5.0-flash", &schema).unwrap();
        assert_eq!(form.delivery, "sync");
        assert!(form.fields.iter().any(|field| field.key == "inputs.referenceImages" && field.role == Some(Role::Reference)));
        let size = form.fields.iter().find(|field| field.key == "size").unwrap();
        assert!(!choices_of(size).is_empty());
    }

    #[test]
    fn capabilities_name_the_tasks() {
        let caps = |list: &[&str]| list.iter().map(|c| c.to_string()).collect::<Vec<_>>();
        assert_eq!(tasks_of(&caps(&["text-to-image", "image-to-image"]), "flux", "FLUX"), vec![Task::Image, Task::ImageEdit]);
        assert_eq!(tasks_of(&caps(&["image-to-image", "remove-background"]), "bria", "Bria RMBG"), vec![Task::RemoveBackground]);
        assert_eq!(tasks_of(&caps(&["text-to-audio"]), "minimax-speech-2-8", "MiniMax Speech 2.8"), vec![Task::Speech]);
        assert_eq!(tasks_of(&caps(&["text-to-audio"]), "minimax-music-2-6", "MiniMax Music 2.6"), vec![Task::Music]);
    }
}
