//! The price of a run before it runs, from the model's rates and the values in its form. `exact` is false
//! when a rate had to be guessed among variants; `None` when the price is only known afterwards.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::model::{FieldKind, ModelForm, Rate, Role};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Estimate {
    pub usd: f64,
    pub exact: bool,
}

fn value_of<'a>(form: &ModelForm, values: &'a Map<String, Value>, role: Role) -> Option<&'a Value> {
    form.fields.iter().filter(|field| field.role == Some(role)).find_map(|field| values.get(&field.key).filter(|value| !value.is_null()))
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|text| text.trim_end_matches('s').parse().ok()))
}

fn default_of(form: &ModelForm, role: Role) -> Option<Value> {
    form.fields.iter().find(|field| field.role == Some(role)).and_then(|field| field.default.clone())
}

/// The resolution a run asks for, as the labels name it ("720p", "1080p", "2k").
fn resolution(form: &ModelForm, values: &Map<String, Value>) -> Option<String> {
    if let Some(value) = value_of(form, values, Role::Resolution) {
        return value.as_str().map(|text| text.to_ascii_lowercase());
    }
    if let Some(value) = value_of(form, values, Role::Size) {
        let (w, h) = value.as_str()?.split_once('x')?;
        let short = w.parse::<u32>().ok()?.min(h.parse::<u32>().ok()?);
        return Some(format!("{short}p"));
    }
    default_of(form, Role::Resolution).and_then(|value| value.as_str().map(|text| text.to_ascii_lowercase()))
}

fn pick<'a>(rates: &[&'a Rate], wanted: &[String]) -> (Option<&'a Rate>, bool) {
    if rates.is_empty() {
        return (None, true);
    }
    if rates.len() == 1 {
        return (Some(rates[0]), true);
    }
    let audio_wanted = wanted.iter().any(|word| word == "audio");
    let scored = rates.iter().map(|rate| {
        let label = rate.label.clone().unwrap_or_default().to_ascii_lowercase();
        let matched = wanted.iter().filter(|word| !word.is_empty() && label.contains(word.as_str())).count() as i64;
        // a variant with sound is a different price, not a closer match, when no sound was asked for
        let unwanted = i64::from(!audio_wanted && label.contains("audio"));
        (matched - unwanted, *rate)
    });
    let best = scored.max_by_key(|(score, _)| *score);
    match best {
        Some((score, rate)) if score > 0 => (Some(rate), true),
        _ => (rates.iter().copied().min_by(|a, b| a.amount.total_cmp(&b.amount)), false),
    }
}

pub fn estimate(form: &ModelForm, values: &Map<String, Value>) -> Option<Estimate> {
    let rates = &form.price.rates;
    if rates.is_empty() {
        return None;
    }
    let count = value_of(form, values, Role::Count).and_then(number).or_else(|| default_of(form, Role::Count).as_ref().and_then(number)).unwrap_or(1.0).max(1.0);
    let duration = value_of(form, values, Role::Duration).and_then(number).or_else(|| default_of(form, Role::Duration).as_ref().and_then(number));
    let with_audio = values.iter().any(|(key, value)| key.contains("audio") && value.as_bool() == Some(true));
    let mut wanted = Vec::new();
    if let Some(resolution) = resolution(form, values) {
        wanted.push(resolution);
    }
    if with_audio {
        wanted.push("audio".to_string());
    }
    let by_unit = |unit: &str| rates.iter().filter(|rate| rate.unit == unit).collect::<Vec<_>>();
    let mut total = 0.0;
    let mut exact = true;
    let mut priced = false;

    let seconds = by_unit("second");
    if !seconds.is_empty() {
        let (rate, sure) = pick(&seconds, &wanted);
        let duration = duration?;
        total += rate?.amount * duration * count;
        exact &= sure;
        priced = true;
    }
    let outputs = by_unit("output");
    if !priced && !outputs.is_empty() {
        let (rate, sure) = pick(&outputs, &wanted);
        total += rate?.amount * count;
        exact &= sure;
        priced = true;
    }
    let characters = by_unit("character");
    if !priced && !characters.is_empty() {
        let text = value_of(form, values, Role::Prompt).and_then(Value::as_str).unwrap_or_default();
        total += characters[0].amount * text.chars().count() as f64;
        priced = true;
    }
    let megapixels = by_unit("megapixel");
    if !priced && !megapixels.is_empty() {
        let size = value_of(form, values, Role::Size).and_then(Value::as_str).and_then(|size| size.split_once('x')).and_then(|(w, h)| Some(w.parse::<f64>().ok()? * h.parse::<f64>().ok()? / 1e6));
        total += megapixels[0].amount * size.unwrap_or(1.0) * count;
        exact &= size.is_some();
        priced = true;
    }
    if !priced {
        return None;
    }
    let image_inputs = by_unit("image_input");
    if let Some(rate) = image_inputs.first() {
        let images: usize = form
            .fields
            .iter()
            .filter(|field| matches!(field.kind, FieldKind::Media { media: crate::model::MediaKind::Image, .. }))
            .filter_map(|field| values.get(&field.key))
            .map(|value| value.as_array().map(Vec::len).unwrap_or(usize::from(!value.is_null())))
            .sum();
        total += rate.amount * images as f64;
    }
    Some(Estimate { usd: (total * 10000.0).round() / 10000.0, exact })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Field, PriceRule, Provider};
    use serde_json::json;

    fn video_form() -> ModelForm {
        ModelForm {
            provider: Provider::Runware,
            id: "v".into(),
            fields: vec![
                Field { key: "resolution".into(), label: "R".into(), description: None, kind: FieldKind::Text { max_length: None }, required: false, default: Some(json!("480p")), advanced: false, role: Some(Role::Resolution) },
                Field { key: "duration".into(), label: "D".into(), description: None, kind: FieldKind::Integer { min: None, max: None }, required: false, default: Some(json!(6)), advanced: false, role: Some(Role::Duration) },
                Field { key: "inputs.frameImages".into(), label: "F".into(), description: None, kind: FieldKind::Media { media: crate::model::MediaKind::Image, min: 0, max: 1, list: true, at: None }, required: false, default: None, advanced: false, role: Some(Role::FirstFrame) },
            ],
            price: PriceRule {
                rates: vec![
                    Rate { amount: 0.02, unit: "second".into(), label: Some("480p".into()) },
                    Rate { amount: 0.03, unit: "second".into(), label: Some("720p".into()) },
                    Rate { amount: 0.01, unit: "image_input".into(), label: None },
                ],
                note: None,
            },
            delivery: "async".into(),
            source: Value::Null,
        }
    }

    #[test]
    fn seconds_times_the_rate_of_the_resolution() {
        let form = video_form();
        let mut values = Map::new();
        values.insert("resolution".into(), json!("720p"));
        values.insert("duration".into(), json!(4));
        assert_eq!(estimate(&form, &values), Some(Estimate { usd: 0.12, exact: true }));
        values.insert("inputs.frameImages".into(), json!(["x"]));
        assert_eq!(estimate(&form, &values), Some(Estimate { usd: 0.13, exact: true }));
    }

    #[test]
    fn defaults_count_when_the_person_left_them() {
        let form = video_form();
        assert_eq!(estimate(&form, &Map::new()), Some(Estimate { usd: 0.12, exact: true }));
    }

    #[test]
    fn the_rate_with_sound_is_taken_only_when_sound_is_asked_for() {
        let mut form = video_form();
        form.price.rates = vec![
            Rate { amount: 0.03, unit: "second".into(), label: Some("720p".into()) },
            Rate { amount: 0.05, unit: "second".into(), label: Some("720p audio".into()) },
        ];
        let mut values = Map::new();
        values.insert("resolution".into(), json!("720p"));
        values.insert("duration".into(), json!(4));
        assert_eq!(estimate(&form, &values), Some(Estimate { usd: 0.12, exact: true }));
        values.insert("generate_audio".into(), json!(true));
        assert_eq!(estimate(&form, &values), Some(Estimate { usd: 0.2, exact: true }));
    }
}
