//! Elements, as Kling's "@name" references: a prompt that names one sends its pictures in the model's reference
//! slot and keeps the name as a word, by the same rules as the window's `prompt-elements.ts`. The window applies
//! them before it sends a run, so a prompt from it names none; an agent's run gets them here.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value};
use vs_providers::model::{Field, FieldKind, MediaKind, Role};

fn mention() -> &'static Regex {
    static MENTION: OnceLock<Regex> = OnceLock::new();
    MENTION.get_or_init(|| Regex::new(r"@([\p{L}\p{N}_-]+)").expect("the mention pattern"))
}

/// An element as the window keeps it: a name and its pictures.
#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub name: String,
    pub refs: Vec<Value>,
}

/// The elements kept in the generation choices.
pub fn from_choices(choices: &Value) -> Vec<Element> {
    choices
        .get("elements")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|each| {
            let name = each.get("name")?.as_str()?.to_string();
            let refs = each.get("refs")?.as_array()?.clone();
            Some(Element { name, refs })
        })
        .collect()
}

fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// Adds the pictures of every element a prompt names to the model's reference pictures and writes "@name" as
/// "name"; an element the model has no slot or no room for is refused, naming it.
pub fn apply(fields: &[Field], values: &mut Map<String, Value>, elements: &[Element]) -> Result<(), String> {
    let prompts: Vec<&Field> = fields.iter().filter(|field| field.role == Some(Role::Prompt) && values.get(&field.key).is_some_and(Value::is_string)).collect();
    let mut named: Vec<&Element> = Vec::new();
    for field in &prompts {
        let text = values[&field.key].as_str().unwrap_or_default();
        for found in mention().captures_iter(text) {
            if let Some(element) = elements.iter().find(|element| same(&element.name, &found[1]))
                && !named.contains(&element)
            {
                named.push(element);
            }
        }
    }
    if named.is_empty() {
        return Ok(());
    }
    for field in &prompts {
        let text = values[&field.key].as_str().unwrap_or_default().to_string();
        let written = mention().replace_all(&text, |found: &regex::Captures| {
            if named.iter().any(|element| same(&element.name, &found[1])) { found[1].to_string() } else { found[0].to_string() }
        });
        values.insert(field.key.clone(), Value::String(written.into_owned()));
    }
    let pictures = || fields.iter().filter_map(|field| match field.kind {
        FieldKind::Media { media: MediaKind::Image, max, .. } => Some((field, max as usize)),
        _ => None,
    });
    let slot = pictures().find(|(field, _)| field.role == Some(Role::Reference)).or_else(|| pictures().find(|(_, max)| *max > 1));
    let names = |list: &[&Element]| list.iter().map(|element| element.name.clone()).collect::<Vec<_>>().join(", ");
    let Some((slot, max)) = slot else {
        return Err(crate::t!("elements-no-slot", elements = names(&named)));
    };
    let mut refs: Vec<Value> = match values.get(&slot.key) {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Null) | None => Vec::new(),
        Some(other) => vec![other.clone()],
    };
    let mut left = Vec::new();
    for element in named {
        if refs.len() + element.refs.len() > max {
            left.push(element);
            continue;
        }
        refs.extend(element.refs.iter().cloned());
    }
    if !left.is_empty() {
        return Err(crate::t!("elements-no-room", field = slot.label.clone(), max = max as u64, elements = names(&left)));
    }
    values.insert(slot.key.clone(), Value::Array(refs));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn field(key: &str, kind: FieldKind, role: Role) -> Field {
        Field { key: key.into(), label: key.into(), description: None, kind, required: false, default: None, advanced: false, role: Some(role) }
    }

    #[test]
    fn a_named_element_sends_its_pictures_as_the_window_does() {
        let fields = vec![
            field("prompt", FieldKind::Textarea { max_length: None }, Role::Prompt),
            field("refs", FieldKind::Media { media: MediaKind::Image, min: 0, max: 3, list: true, at: None }, Role::Reference),
        ];
        let elements = from_choices(&json!({ "elements": [{ "name": "Kite", "refs": [{ "media": "m1" }] }, { "name": "Fox", "refs": [{ "media": "m2" }, { "media": "m3" }] }] }));
        let mut values = json!({ "prompt": "@kite flies over @Nobody", "refs": [{ "media": "m0" }] }).as_object().unwrap().clone();
        apply(&fields, &mut values, &elements).unwrap();
        assert_eq!(values["prompt"], json!("kite flies over @Nobody"));
        assert_eq!(values["refs"], json!([{ "media": "m0" }, { "media": "m1" }]));

        let mut full = json!({ "prompt": "@Kite and @Fox", "refs": [{ "media": "m0" }] }).as_object().unwrap().clone();
        assert!(apply(&fields, &mut full, &elements).unwrap_err().contains("Fox"));

        let no_slot = vec![field("prompt", FieldKind::Textarea { max_length: None }, Role::Prompt)];
        let mut plain = json!({ "prompt": "@Kite" }).as_object().unwrap().clone();
        assert!(apply(&no_slot, &mut plain, &elements).unwrap_err().contains("Kite"));
        let mut none = json!({ "prompt": "a kite" }).as_object().unwrap().clone();
        apply(&no_slot, &mut none, &elements).unwrap();
        assert_eq!(none["prompt"], json!("a kite"));
    }
}
