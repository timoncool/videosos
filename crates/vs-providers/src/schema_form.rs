//! A model's JSON Schema made into the fields of a form. Runware and fal describe every model's input as
//! JSON Schema (fal through OpenAPI); one reader turns either into typed fields with a meaning (`Role`),
//! so the window draws one form for hundreds of models and the agent reads the same list.

use serde_json::{json, Map, Value};

use crate::model::{Choice, Field, FieldKind, FrameAt, MediaKind, Role};

/// Follows `$ref` (`#/components/schemas/X`, `#/$defs/X`) inside the same document.
pub fn resolve<'a>(root: &'a Value, node: &'a Value) -> &'a Value {
    let mut current = node;
    for _ in 0..8 {
        let Some(reference) = current.get("$ref").and_then(Value::as_str) else { return current };
        let Some(pointer) = reference.strip_prefix('#') else { return current };
        match root.pointer(pointer) {
            Some(target) => current = target,
            None => return current,
        }
    }
    current
}

/// The alternatives of `anyOf`/`oneOf`, `null` left out.
fn alternatives<'a>(root: &'a Value, node: &'a Value) -> Vec<&'a Value> {
    let mut found = Vec::new();
    for key in ["anyOf", "oneOf"] {
        if let Some(list) = node.get(key).and_then(Value::as_array) {
            for alternative in list {
                let alternative = resolve(root, alternative);
                if alternative.get("type").and_then(Value::as_str) == Some("null") {
                    continue;
                }
                found.push(alternative);
            }
        }
    }
    found
}

fn schema_type(node: &Value) -> Option<&str> {
    match node.get("type") {
        Some(Value::String(kind)) => Some(kind.as_str()),
        Some(Value::Array(kinds)) => kinds.iter().filter_map(Value::as_str).find(|kind| *kind != "null"),
        _ => None,
    }
}

/// `enum`, or `oneOf`/`anyOf` of `const`s with their descriptions as labels; a short integer range beside them
/// (`auto` or 5..20 seconds) is listed number by number, and a value open beyond that makes it no list at all.
fn choices(root: &Value, node: &Value) -> Option<Vec<Choice>> {
    if let Some(values) = node.get("enum").and_then(Value::as_array) {
        let options: Vec<Choice> = values
            .iter()
            .filter(|value| !value.is_null())
            .map(|value| Choice { value: value.clone(), label: label_of_value(value) })
            .collect();
        return (!options.is_empty()).then_some(options);
    }
    let mut options = Vec::new();
    let mut ranges = Vec::new();
    for alternative in alternatives(root, node) {
        if let Some(constant) = alternative.get("const") {
            let label = alternative
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| label_of_value(constant));
            options.push(Choice { value: constant.clone(), label });
        } else if let Some(values) = alternative.get("enum").and_then(Value::as_array) {
            options.extend(values.iter().filter(|v| !v.is_null()).map(|value| Choice { value: value.clone(), label: label_of_value(value) }));
        } else if let Some(kind @ ("integer" | "number")) = schema_type(alternative) {
            let bounds = (alternative.get("minimum").and_then(Value::as_i64), alternative.get("maximum").and_then(Value::as_i64));
            match (kind, bounds) {
                ("integer", (Some(min), Some(max))) if max >= min && max - min <= 60 => ranges.push(min..=max),
                _ => return None,
            }
        }
    }
    if options.is_empty() {
        return None;
    }
    options.extend(ranges.into_iter().flatten().map(|value| Choice { value: json!(value), label: value.to_string() }));
    Some(options)
}

fn label_of_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.replace('_', " "),
        other => other.to_string(),
    }
}

/// `positivePrompt` → "Positive prompt", `image_size` → "Image size".
pub fn humanize(key: &str) -> String {
    let mut words = String::new();
    let mut previous_lower = false;
    for character in key.chars() {
        if character == '_' || character == '-' || character == '.' {
            words.push(' ');
            previous_lower = false;
            continue;
        }
        if character.is_uppercase() && previous_lower {
            words.push(' ');
        }
        previous_lower = character.is_lowercase() || character.is_ascii_digit();
        words.push(character.to_ascii_lowercase());
    }
    let mut letters = words.trim().chars();
    letters.next().map(|first| first.to_uppercase().chain(letters).collect()).unwrap_or_default()
}

/// The kind of file a field takes, read from its name.
pub fn media_of_name(name: &str) -> Option<MediaKind> {
    let name = name.to_ascii_lowercase();
    if name.contains("video") {
        Some(MediaKind::Video)
    } else if name.contains("audio") || name.contains("voice_ref") || name.contains("speech_file") || name.contains("music_file") {
        Some(MediaKind::Audio)
    } else if name.contains("image") || name.contains("frame") || name.contains("mask") || name.contains("photo") || name == "face_url" {
        Some(MediaKind::Image)
    } else {
        None
    }
}

/// The meaning of a field, from its name and whether it takes files.
pub fn role_of(key: &str, media: Option<MediaKind>) -> Option<Role> {
    let leaf = key.rsplit('.').next().unwrap_or(key).to_ascii_lowercase();
    if let Some(media) = media {
        return Some(if leaf.contains("mask") {
            Role::Mask
        } else if leaf.contains("end") || leaf.contains("last") || leaf.contains("tail") {
            Role::LastFrame
        } else if leaf.contains("reference") || leaf.contains("ref_") || leaf.contains("style") {
            Role::Reference
        } else if leaf.contains("frame") || leaf.contains("start") || leaf.contains("first") {
            Role::FirstFrame
        } else if media == MediaKind::Audio {
            Role::Audio
        } else {
            Role::Source
        });
    }
    Some(match leaf.as_str() {
        "prompt" | "positiveprompt" | "text" | "input" | "lyrics" | "script" | "gen_text" => Role::Prompt,
        "negativeprompt" | "negative_prompt" => Role::NegativePrompt,
        "duration" | "seconds" | "duration_seconds" | "num_frames" => Role::Duration,
        "resolution" | "quality_mode" => Role::Resolution,
        "aspect_ratio" | "aspectratio" | "image_size" | "video_size" | "size" => Role::Aspect,
        "num_images" | "numberresults" | "n" | "num_outputs" | "number_of_images" => Role::Count,
        "seed" => Role::Seed,
        "voice" | "voice_id" | "voiceid" | "speaker" => Role::Voice,
        _ => return None,
    })
}

/// Fields that only matter to the transport, never to the person.
pub struct Skip<'a> {
    pub keys: &'a [&'a str],
}

impl Skip<'_> {
    fn skips(&self, key: &str) -> bool {
        self.keys.iter().any(|skip| skip.eq_ignore_ascii_case(key))
    }
}

/// The fields of one object schema; `inputs`-like objects (`media_object`) hold files only.
/// The fields in the order a person fills them: what to make, the files, the main settings, the rest.
pub fn order_fields(fields: &mut [Field]) {
    let rank = |field: &Field| match (&field.kind, field.role, field.advanced) {
        (_, Some(Role::Prompt), _) => 0,
        (FieldKind::Media { .. }, _, _) => 1,
        (_, _, false) => 2,
        (_, Some(Role::NegativePrompt), _) => 3,
        _ => 4,
    };
    fields.sort_by_key(rank);
}

pub fn fields_of_object(root: &Value, object: &Value, prefix: &str, skip: &Skip, media_object: bool, order: Option<&[String]>) -> Vec<Field> {
    let object = resolve(root, object);
    let Some(properties) = object.get("properties").and_then(Value::as_object) else { return Vec::new() };
    let required: Vec<&str> = object.get("required").and_then(Value::as_array).map(|list| list.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let mut keys: Vec<&String> = properties.keys().collect();
    if let Some(order) = order {
        keys.sort_by_key(|key| order.iter().position(|ordered| ordered == *key).unwrap_or(usize::MAX));
    }
    let mut fields = Vec::new();
    for key in keys {
        if skip.skips(key) {
            continue;
        }
        let node = resolve(root, &properties[key]);
        let path = if prefix.is_empty() { key.clone() } else { format!("{prefix}.{key}") };
        let is_required = required.contains(&key.as_str());
        if (media_object && input_is_file(key, node)) || is_media_node(root, key, node) {
            if let Some(field) = media_field(root, key, &path, node, is_required, media_object) {
                fields.push(field);
            }
            continue;
        }
        if schema_type(node) == Some("object") || (node.get("properties").is_some() && node.get("type").is_none()) {
            let nested_media = key.eq_ignore_ascii_case("inputs");
            if nested_media || key.eq_ignore_ascii_case("settings") || key.eq_ignore_ascii_case("audioSettings") || key.eq_ignore_ascii_case("speech") {
                fields.extend(fields_of_object(root, node, &path, skip, nested_media, None));
            }
            continue;
        }
        if let Some(field) = plain_field(root, key, &path, node, is_required) {
            fields.push(field);
        }
    }
    fields
}

fn is_media_node(root: &Value, key: &str, node: &Value) -> bool {
    let lower = key.to_ascii_lowercase();
    let named = lower.ends_with("_url") || lower.ends_with("_urls") || lower.ends_with("url") && media_of_name(&lower).is_some();
    if named && media_of_name(&lower).is_some() {
        return true;
    }
    let string_like = |n: &Value| n.get("format").and_then(Value::as_str) == Some("uri") || n.get("contentMediaType").is_some();
    let item = node.get("items").map(|items| resolve(root, items));
    media_of_name(&lower).is_some() && (string_like(node) || item.is_some_and(string_like))
}

/// Whether an entry of Runware's `inputs` takes a file: named for one, or a picture by its schema. A draft's cache,
/// an id of the provider's own (`videoId`, `draftId`), fonts or a checkpoint are not files of the library.
fn input_is_file(key: &str, node: &Value) -> bool {
    !key.ends_with("Id") && (media_of_name(key).is_some() || node.to_string().contains("data:image"))
}

fn media_field(root: &Value, key: &str, path: &str, node: &Value, required: bool, inside_inputs: bool) -> Option<Field> {
    let media = media_of_name(key).or(if inside_inputs { Some(MediaKind::Image) } else { None })?;
    let is_array = schema_type(node) == Some("array") || alternatives(root, node).iter().any(|alt| schema_type(alt) == Some("array"));
    let array_node = if schema_type(node) == Some("array") {
        node
    } else {
        alternatives(root, node).into_iter().find(|alt| schema_type(alt) == Some("array")).unwrap_or(node)
    };
    let (min, max) = if is_array {
        (
            array_node.get("minItems").and_then(Value::as_u64).unwrap_or(0) as u32,
            array_node.get("maxItems").and_then(Value::as_u64).unwrap_or(10) as u32,
        )
    } else {
        (0, 1)
    };
    Some(Field {
        key: path.to_string(),
        label: title(node, key),
        description: description(node),
        kind: FieldKind::Media { media, min: if required { min.max(1) } else { min }, max: max.max(1), list: is_array, at: if is_array { frame_at(root, array_node) } else { None } },
        required,
        default: None,
        advanced: false,
        role: role_of(path, Some(media)),
    })
}

/// The position a list's item may carry beside its file (Runware's `{image, timestamp | frame}`): a second
/// when the model takes one up to a known end, else a frame number; named places alone (`first`, `last`) follow the
/// order.
fn frame_at(root: &Value, array: &Value) -> Option<FrameAt> {
    let items = resolve(root, array.get("items")?);
    let mut objects = alternatives(root, items);
    objects.push(items);
    let properties = objects.into_iter().filter(|alt| schema_type(alt) == Some("object")).find_map(|alt| alt.get("properties"))?;
    if let Some(max) = properties.get("timestamp").and_then(|node| resolve(root, node).get("maximum")).and_then(Value::as_f64) {
        return Some(FrameAt::Second { max });
    }
    let frame = resolve(root, properties.get("frame")?);
    let mut kinds = alternatives(root, frame);
    kinds.push(frame);
    kinds.iter().any(|alt| schema_type(alt) == Some("integer")).then_some(FrameAt::Frame)
}

fn title(node: &Value, key: &str) -> String {
    node.get("title").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| humanize(key))
}

fn description(node: &Value) -> Option<String> {
    let text = node.get("description").and_then(Value::as_str)?.trim();
    if text.is_empty() {
        return None;
    }
    let first = text.split("\n\n").next().unwrap_or(text);
    let short: String = first.chars().take(400).collect();
    Some(short.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn plain_field(root: &Value, key: &str, path: &str, node: &Value, required: bool) -> Option<Field> {
    let default = node.get("default").cloned().filter(|value| !value.is_null());
    if node.get("const").is_some() {
        return None;
    }
    let role = role_of(path, None);
    let kind = if let Some(options) = choices(root, node) {
        FieldKind::Select { options }
    } else {
        let effective = match schema_type(node) {
            Some(kind) => Some((kind, node)),
            None => alternatives(root, node).into_iter().find_map(|alt| schema_type(alt).map(|kind| (kind, alt))),
        };
        let (kind, typed) = effective?;
        match kind {
            "string" => {
                let max_length = typed.get("maxLength").and_then(Value::as_u64);
                let long = matches!(role, Some(Role::Prompt) | Some(Role::NegativePrompt)) || max_length.is_some_and(|max| max > 300);
                if long { FieldKind::Textarea { max_length } } else { FieldKind::Text { max_length } }
            }
            "integer" => FieldKind::Integer { min: typed.get("minimum").and_then(Value::as_f64), max: typed.get("maximum").and_then(Value::as_f64) },
            "number" => FieldKind::Number { min: typed.get("minimum").and_then(Value::as_f64), max: typed.get("maximum").and_then(Value::as_f64) },
            "boolean" => FieldKind::Boolean,
            _ => return None,
        }
    };
    let primary = matches!(
        role,
        Some(Role::Prompt | Role::Duration | Role::Resolution | Role::Aspect | Role::Count | Role::Voice | Role::Size)
    );
    Some(Field {
        key: path.to_string(),
        label: title(node, key),
        description: description(node),
        kind,
        required,
        default,
        advanced: !(primary || required),
        role,
    })
}

/// Width and height pairs a schema allows: `oneOf` lists of `{title, properties: {width: {const}, height: {const}}}`
/// anywhere in its conditions.
pub fn size_presets(schema: &Value) -> Vec<Choice> {
    let mut found = Vec::new();
    collect_sizes(schema, &mut found, 0);
    let mut unique: Vec<Choice> = Vec::new();
    for choice in found {
        if !unique.iter().any(|seen| seen.value == choice.value) {
            unique.push(choice);
        }
    }
    unique
}

fn collect_sizes(node: &Value, found: &mut Vec<Choice>, depth: usize) {
    if depth > 12 {
        return;
    }
    match node {
        Value::Object(map) => {
            if let Some(size) = size_choice(map) {
                found.push(size);
                return;
            }
            for (key, child) in map {
                if key == "description" || key == "examples" {
                    continue;
                }
                collect_sizes(child, found, depth + 1);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect_sizes(item, found, depth + 1)),
        _ => {}
    }
}

fn size_choice(map: &Map<String, Value>) -> Option<Choice> {
    let properties = map.get("properties")?.as_object()?;
    let width = properties.get("width")?.get("const")?.as_u64()?;
    let height = properties.get("height")?.get("const")?.as_u64()?;
    let label = map.get("title").and_then(Value::as_str).map(|title| format!("{title} · {width}×{height}")).unwrap_or_else(|| format!("{width}×{height}"));
    Some(Choice { value: Value::String(format!("{width}x{height}")), label })
}

/// Dotted keys into nested objects: `{"inputs.frameImages": [..]}` → `{"inputs": {"frameImages": [..]}}`.
pub fn unflatten(values: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (key, value) in values {
        let mut parts = key.split('.').peekable();
        let mut cursor = &mut out;
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                cursor.insert(part.to_string(), value.clone());
            } else {
                let entry = cursor.entry(part.to_string()).or_insert_with(|| Value::Object(Map::new()));
                if !entry.is_object() {
                    *entry = Value::Object(Map::new());
                }
                cursor = entry.as_object_mut().expect("an object was just put here");
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_become_labels() {
        assert_eq!(humanize("positivePrompt"), "Positive prompt");
        assert_eq!(humanize("image_size"), "Image size");
        assert_eq!(humanize("CFGScale"), "Cfgscale");
    }

    #[test]
    fn a_keyframe_list_says_how_a_frame_is_pinned() {
        let list = |frame: Value, timestamp: Option<Value>| {
            let mut properties = json!({ "image": { "type": "string" }, "frame": frame });
            if let Some(timestamp) = timestamp {
                properties["timestamp"] = timestamp;
            }
            json!({ "type": "object", "properties": { "frameImages": {
                "type": "array", "maxItems": 10,
                "items": { "anyOf": [{ "type": "string", "format": "uri" }, { "type": "object", "properties": properties, "required": ["image"] }] }
            } } })
        };
        let at = |object: Value| match fields_of_object(&object, &object, "inputs", &Skip { keys: &[] }, true, None).remove(0).kind {
            FieldKind::Media { at, .. } => at,
            other => panic!("{other:?}"),
        };
        let index = json!({ "oneOf": [{ "type": "string", "enum": ["first", "last"] }, { "type": "integer", "minimum": -1 }] });
        assert_eq!(at(list(index.clone(), Some(json!({ "type": "number", "minimum": 0, "maximum": 20 })))), Some(FrameAt::Second { max: 20.0 }));
        assert_eq!(at(list(index, None)), Some(FrameAt::Frame));
        assert_eq!(at(list(json!({ "oneOf": [{ "const": "first" }, { "const": "last" }] }), None)), None);
    }

    #[test]
    fn a_short_range_is_listed_only_beside_named_values() {
        let range = json!({ "type": "integer", "minimum": 5, "maximum": 20 });
        let listed = choices(&Value::Null, &json!({ "oneOf": [range, { "const": "auto" }] })).unwrap();
        assert_eq!(listed.len(), 17);
        assert_eq!(listed[0].value, json!("auto"));
        assert!(choices(&Value::Null, &json!({ "anyOf": [range, { "type": "null" }] })).is_none(), "an optional number stays a number");
    }

    #[test]
    fn dotted_keys_nest() {
        let mut flat = Map::new();
        flat.insert("inputs.frameImages".into(), json!(["a"]));
        flat.insert("inputs.referenceImages".into(), json!(["b"]));
        flat.insert("duration".into(), json!(6));
        let nested = unflatten(&flat);
        assert_eq!(Value::Object(nested), json!({"inputs": {"frameImages": ["a"], "referenceImages": ["b"]}, "duration": 6}));
    }

    #[test]
    fn roles_of_media_fields() {
        assert_eq!(role_of("end_image_url", Some(MediaKind::Image)), Some(Role::LastFrame));
        assert_eq!(role_of("image_url", Some(MediaKind::Image)), Some(Role::Source));
        assert_eq!(role_of("inputs.frameImages", Some(MediaKind::Image)), Some(Role::FirstFrame));
        assert_eq!(role_of("inputs.referenceImages", Some(MediaKind::Image)), Some(Role::Reference));
        assert_eq!(role_of("audio_url", Some(MediaKind::Audio)), Some(Role::Audio));
    }
}
