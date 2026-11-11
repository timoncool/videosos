//! The server's words in the language the window shows. Every message a person reads - progress, an
//! error, a setup status - is a key of the Fluent catalogues in `locales/<lang>/server.ftl`, looked up
//! in the language the window last reported, so the six interface languages read the server too.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::RwLock;

use fluent_templates::fluent_bundle::FluentValue;
use fluent_templates::{static_loader, LanguageIdentifier, Loader};

static_loader! {
    static LOCALES = {
        locales: "./locales",
        fallback_language: "en",
        customise: |bundle| bundle.set_use_isolating(false),
    };
}

/// Languages with a server catalogue; another interface language reads the English one.
pub const CATALOGUES: [&str; 2] = ["en", "ru"];

/// The interface languages; the window reports one of these.
pub const LANGUAGES: [&str; 10] = ["en", "ru", "es", "fr", "de", "pt-BR", "tr", "ja", "ko", "zh"];

static CURRENT: RwLock<Option<LanguageIdentifier>> = RwLock::new(None);

/// Tests run in parallel and the language is global: a test that sets the language or compares a message
/// with one language holds this for its whole body.
#[cfg(test)]
pub(crate) static TEST_LANGUAGE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Holds [`TEST_LANGUAGE_LOCK`] and sets `code` as the language for the rest of the test.
#[cfg(test)]
pub(crate) fn test_language(code: &str) -> std::sync::MutexGuard<'static, ()> {
    let guard = TEST_LANGUAGE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    set_language(code).expect("an interface language");
    guard
}

/// The language the window shows now; English until it reports one.
pub fn language() -> LanguageIdentifier {
    CURRENT.read().ok().and_then(|current| current.clone()).unwrap_or_else(|| "en".parse().expect("a language tag"))
}

/// Whether the window has told its language yet.
pub fn reported() -> bool {
    CURRENT.read().is_ok_and(|current| current.is_some())
}

pub fn set_language(code: &str) -> Result<(), String> {
    if !LANGUAGES.contains(&code) {
        return Err(format!("unknown interface language {code}; one of {}", LANGUAGES.join(", ")));
    }
    let id: LanguageIdentifier = code.parse().map_err(|_| format!("not a language tag: {code}"))?;
    *CURRENT.write().map_err(|_| "the language lock is poisoned".to_string())? = Some(id);
    Ok(())
}

/// The message `key` in the current language with its arguments. A key no catalogue has comes back as
/// the key itself, which the catalogue test catches before it ships.
pub fn tr(key: &str, args: Vec<(&'static str, FluentValue<'static>)>) -> String {
    let map: HashMap<Cow<'static, str>, FluentValue<'static>> = args.into_iter().map(|(name, value)| (Cow::Borrowed(name), value)).collect();
    LOCALES.try_lookup_with_args(&language(), key, &map).unwrap_or_else(|| key.to_string())
}

/// A message for a caller outside this crate (the desktop shell), with text arguments.
pub fn text(key: &str, args: &[(&'static str, String)]) -> String {
    tr(key, args.iter().map(|(name, value)| (*name, FluentValue::from(value.clone()))).collect())
}

/// `t!("key")` or `t!("key", name = value, ...)`: a message of the catalogues in the current language.
#[macro_export]
macro_rules! t {
    ($key:literal) => {
        $crate::i18n::tr($key, Vec::new())
    };
    ($key:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::i18n::tr($key, vec![$((stringify!($name), fluent_templates::fluent_bundle::FluentValue::from($value))),+])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every key the code asks for is in every language's catalogue.
    #[test]
    fn every_key_is_in_every_catalogue() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let pattern = regex::Regex::new(r#"t!\(\s*"([a-z0-9-]+)""#).unwrap();
        let mut keys = std::collections::BTreeSet::new();
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.file_name().is_some_and(|name| name == "i18n.rs") {
                    continue;
                }
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|extension| extension == "rs") {
                    for found in pattern.captures_iter(&std::fs::read_to_string(&path).unwrap()) {
                        keys.insert(found[1].to_string());
                    }
                }
            }
        }
        assert!(!keys.is_empty());
        let defined = regex::Regex::new(r"(?m)^([a-z0-9-]+)\s*=").unwrap();
        let catalogues = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("locales");
        let mut missing = Vec::new();
        for code in CATALOGUES {
            let mut have = std::collections::BTreeSet::new();
            for entry in std::fs::read_dir(catalogues.join(code)).unwrap().flatten() {
                for found in defined.captures_iter(&std::fs::read_to_string(entry.path()).unwrap()) {
                    have.insert(found[1].to_string());
                }
            }
            missing.extend(keys.iter().filter(|key| !have.contains(*key)).map(|key| format!("{code}: {key}")));
        }
        assert!(missing.is_empty(), "keys missing from catalogues: {missing:?}");
    }

    /// The source files of the crate, except this one.
    fn sources() -> Vec<std::path::PathBuf> {
        let mut found = Vec::new();
        let mut stack = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|extension| extension == "rs") && path.file_name().is_some_and(|name| name != "i18n.rs") {
                    found.push(path);
                }
            }
        }
        found
    }

    /// Every `t!` call of `code`: its key and the names of the arguments it passes. Comments, strings and
    /// character literals are skipped, so only real calls count.
    fn calls(code: &str) -> Vec<(String, Vec<String>)> {
        let chars: Vec<char> = code.chars().collect();
        let skip_literal = |i: usize| -> Option<usize> {
            if chars[i] == 'r' && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_')) {
                let hashes = chars[i + 1..].iter().take_while(|&&c| c == '#').count();
                if chars.get(i + 1 + hashes) == Some(&'"') {
                    let close: Vec<char> = std::iter::once('"').chain(std::iter::repeat_n('#', hashes)).collect();
                    let mut j = i + 2 + hashes;
                    while chars[j..j + close.len()] != close[..] {
                        j += 1;
                    }
                    return Some(j + close.len());
                }
            }
            match chars[i] {
                '"' => {
                    let mut j = i + 1;
                    while chars[j] != '"' {
                        j += if chars[j] == '\\' { 2 } else { 1 };
                    }
                    Some(j + 1)
                }
                '\'' if chars.get(i + 1) == Some(&'\\') => chars[i + 3..].iter().position(|&c| c == '\'').map(|k| i + 4 + k),
                '\'' if chars.get(i + 2) == Some(&'\'') => Some(i + 3),
                '/' if chars.get(i + 1) == Some(&'/') => Some(chars[i..].iter().position(|&c| c == '\n').map_or(chars.len(), |k| i + k)),
                '/' if chars.get(i + 1) == Some(&'*') => {
                    Some((i + 2..chars.len() - 1).find(|&k| chars[k] == '*' && chars[k + 1] == '/').map_or(chars.len(), |k| k + 2))
                }
                _ => None,
            }
        };
        let mut out = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            if let Some(next) = skip_literal(i) {
                i = next;
                continue;
            }
            let is_call = chars[i..].starts_with(&['t', '!', '('])
                && (i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_'));
            if !is_call {
                i += 1;
                continue;
            }
            let mut parts = vec![String::new()];
            let (mut depth, mut j) = (0usize, i + 3);
            while j < chars.len() {
                if let Some(next) = skip_literal(j) {
                    parts.last_mut().unwrap().extend(&chars[j..next]);
                    j = next;
                    continue;
                }
                match chars[j] {
                    '(' | '[' | '{' => depth += 1,
                    ')' if depth == 0 => break,
                    ')' | ']' | '}' => depth -= 1,
                    ',' if depth == 0 => {
                        parts.push(String::new());
                        j += 1;
                        continue;
                    }
                    _ => {}
                }
                parts.last_mut().unwrap().push(chars[j]);
                j += 1;
            }
            let key = parts[0].trim().trim_matches('"').to_string();
            let names = parts[1..]
                .iter()
                .filter(|part| !part.trim().is_empty())
                .map(|part| part.split('=').next().unwrap().trim().to_string())
                .collect();
            out.push((key, names));
            i = j;
        }
        out
    }

    /// Every `t!` call formats in every language with exactly the arguments it passes: a message that
    /// refers to an argument the call does not give fails here, where at run time `tr` would hand back the
    /// bare key.
    #[test]
    fn every_call_formats_in_every_language_with_its_arguments() {
        use fluent_templates::fluent_bundle::{FluentArgs, FluentBundle, FluentResource};
        let mut all = Vec::new();
        for path in sources() {
            let place = path.file_name().unwrap().to_string_lossy().to_string();
            all.extend(calls(&std::fs::read_to_string(&path).unwrap()).into_iter().map(|(key, names)| (place.clone(), key, names)));
        }
        assert!(!all.is_empty(), "the calls were not found");
        let catalogues = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("locales");
        let mut problems = Vec::new();
        for code in CATALOGUES {
            let mut bundle = FluentBundle::new(vec![code.parse::<LanguageIdentifier>().unwrap()]);
            bundle.set_use_isolating(false);
            for entry in std::fs::read_dir(catalogues.join(code)).unwrap().flatten() {
                let resource = FluentResource::try_new(std::fs::read_to_string(entry.path()).unwrap())
                    .unwrap_or_else(|(_, errors)| panic!("{code}: {errors:?}"));
                bundle.add_resource(resource).unwrap_or_else(|errors| panic!("{code}: {errors:?}"));
            }
            for (place, key, names) in &all {
                let Some(pattern) = bundle.get_message(key).and_then(|message| message.value()) else {
                    problems.push(format!("{code} {place}: {key} is not in the catalogue"));
                    continue;
                };
                for count in [1, 3, 5, 21] {
                    let mut args = FluentArgs::new();
                    for name in names {
                        args.set(name.clone(), count);
                    }
                    let mut errors = Vec::new();
                    bundle.format_pattern(pattern, Some(&args), &mut errors);
                    if !errors.is_empty() {
                        problems.push(format!("{code} {place}: {key} with {names:?}: {errors:?}"));
                        break;
                    }
                }
            }
        }
        assert!(problems.is_empty(), "{} messages do not format:\n{}", problems.len(), problems.join("\n"));
    }

    #[test]
    fn the_language_follows_the_window_and_counts_in_russian() {
        let _language = test_language("ru");
        assert_eq!(t!("jobs-variants", count = 2), "2 варианта");
        assert_eq!(t!("jobs-variants", count = 5), "5 вариантов");
        assert!(t!("chat-too-many-turns", turns = 60).contains("60 шагов"));
        assert!(t!("chat-too-many-turns", turns = 24).contains("24 шага"));
        set_language("en").unwrap();
        assert_eq!(t!("jobs-variants", count = 1), "1 variant");
        assert!(set_language("xx").is_err());
    }
}
