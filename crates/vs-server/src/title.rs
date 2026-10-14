//! The name a result goes by, as YuE2 Studio names a track nobody named: what the prompt asked for, ended at
//! its first sentence, at most two comma phrases and fifty characters cut on a word. A job with no prompt (an
//! upscale, a background removal) goes by its model. The window names the library item by it and the file
//! carries it in its tags.

use serde_json::Value;

const MAX_CHARS: usize = 50;

/// The request's own words: the prompt, or the text a voice or a transcript was asked for; never a negative prompt.
pub fn prompt_of(values: &Value) -> Option<&str> {
    values.as_object()?.iter().find_map(|(key, value)| {
        let text = value.as_str().filter(|text| !text.trim().is_empty())?;
        let key = key.to_lowercase();
        (!key.contains("negative") && (key.contains("prompt") || key == "input" || key == "text")).then_some(text)
    })
}

fn sentence_end(text: &str) -> Option<usize> {
    let characters: Vec<char> = text.chars().collect();
    (0..characters.len()).find(|&at| matches!(characters[at], '.' | '!' | '?' | '…') && characters.get(at + 1).is_none_or(|next| next.is_whitespace()))
}

pub fn trim_title(raw: &str) -> String {
    let mut value = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.starts_with('(') && value.ends_with(')') && value.chars().count() > 2 {
        value = value[1..value.len() - 1].trim().to_string();
    }
    if let Some(end) = sentence_end(&value)
        && end < MAX_CHARS
    {
        value = value.chars().take(end + 1).collect::<String>().trim().to_string();
    }
    let phrases: Vec<&str> = value.split(',').collect();
    if phrases.len() > 2 {
        value = phrases[..2].join(",").trim().to_string();
    }
    if value.chars().count() <= MAX_CHARS {
        return value;
    }
    let cut: String = value.chars().take(MAX_CHARS).collect();
    let trimmed = match cut.rfind(' ') {
        Some(space) if space > 0 => cut[..space].trim_end().to_string(),
        _ => cut,
    };
    format!("{trimmed}…")
}

/// The title of a job's results.
pub fn result_title(values: &Value, model_name: &str) -> String {
    match prompt_of(values) {
        Some(prompt) => trim_title(prompt),
        None => model_name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn takes_the_prompt_never_the_negative_prompt() {
        assert_eq!(prompt_of(&json!({ "negative_prompt": "blur", "prompt": "a lighthouse at dusk" })), Some("a lighthouse at dusk"));
        assert_eq!(prompt_of(&json!({ "positivePrompt": "neon city" })), Some("neon city"));
        assert_eq!(prompt_of(&json!({ "image_url": "x" })), None);
    }

    #[test]
    fn ends_at_the_first_sentence_and_keeps_two_phrases() {
        assert_eq!(trim_title("A lighthouse at dusk. Waves crash below."), "A lighthouse at dusk.");
        assert_eq!(trim_title("red fox, snow, morning light, 35mm"), "red fox, snow");
    }

    #[test]
    fn cuts_a_long_prompt_on_a_word() {
        assert_eq!(
            trim_title("an extremely detailed cinematic wide shot of an ancient mountain monastery wrapped in fog"),
            "an extremely detailed cinematic wide shot of an…"
        );
    }

    #[test]
    fn a_job_without_a_prompt_goes_by_its_model() {
        assert_eq!(result_title(&json!({ "image": [{ "media": "m1" }] }), "Clarity Upscaler"), "Clarity Upscaler");
        assert_eq!(result_title(&json!({ "prompt": "Кот на крыше, закат, дождь, неон" }), "FLUX"), "Кот на крыше, закат");
    }
}
