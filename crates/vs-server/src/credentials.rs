//! API keys of the providers. The environment variable wins over the stored key, so scripted runs never
//! read or overwrite the person's key; the stored key is a file in `secrets/` beside the other data.
//! A key never leaves the server: routes only say whether one is set and where it comes from.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use vs_providers::Provider;

static SECRETS: OnceLock<PathBuf> = OnceLock::new();

pub const SECRETS_ENV: &str = "VIDEOSOS_SECRETS_DIR";

pub fn init(root: &Path) {
    let dir = std::env::var_os(SECRETS_ENV).filter(|value| !value.is_empty()).map(PathBuf::from).unwrap_or_else(|| root.join("secrets"));
    let _ = SECRETS.set(dir);
}

fn dir() -> &'static Path {
    SECRETS.get().map(PathBuf::as_path).unwrap_or_else(|| Path::new("secrets"))
}

pub fn env_var(provider: Provider) -> &'static str {
    match provider {
        Provider::Openrouter => "OPENROUTER_API_KEY",
        Provider::Fal => "FAL_KEY",
        Provider::Runware => "RUNWARE_API_KEY",
    }
}

fn file(provider: Provider) -> PathBuf {
    dir().join(format!("{}-api-key", provider.as_str()))
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Environment,
    Stored,
}

pub fn key(provider: Provider) -> Option<(String, Source)> {
    if let Some(value) = std::env::var(env_var(provider)).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        return Some((value, Source::Environment));
    }
    let stored = std::fs::read_to_string(file(provider)).ok()?.trim().to_string();
    (!stored.is_empty()).then_some((stored, Source::Stored))
}

/// Stores or clears the key. Refuses while the environment variable shadows it, so nobody believes they
/// replaced a key the process is not using.
pub fn store(provider: Provider, value: Option<&str>) -> Result<(), String> {
    if std::env::var(env_var(provider)).is_ok_and(|value| !value.trim().is_empty()) {
        return Err(t!("keys-env-wins", variable = env_var(provider)));
    }
    let path = file(provider);
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            if value.contains(['\n', '\r']) {
                return Err(t!("keys-one-line"));
            }
            std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
            let partial = path.with_extension("partial");
            std::fs::write(&partial, value).map_err(|e| e.to_string())?;
            std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
        }
        None => match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        },
    }
    Ok(())
}

#[derive(Serialize)]
pub struct KeyState {
    pub provider: Provider,
    pub set: bool,
    pub source: Option<Source>,
    pub variable: &'static str,
}

pub fn states() -> Vec<KeyState> {
    Provider::ALL
        .into_iter()
        .map(|provider| {
            let found = key(provider);
            KeyState { provider, set: found.is_some(), source: found.map(|(_, source)| source), variable: env_var(provider) }
        })
        .collect()
}
