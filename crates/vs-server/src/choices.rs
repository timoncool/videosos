//! What the generation panel was left at: the task, the model of each task, what was typed into each model's
//! form, the run count, the timeline switch and the pinned models. The server keeps them in
//! `data/generate-choices.json`, as Dub Studio keeps its launch form, so every window finds them and they
//! outlive the window's own storage.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use axum::http::StatusCode;
use axum::{Json, Router};
use serde_json::Value;

use crate::AppState;

/// A form's typed text is kept, not files: a larger answer is a window sending something it should not.
const MAX_BYTES: usize = 2 * 1024 * 1024;

static PATH: OnceLock<PathBuf> = OnceLock::new();
static WRITE: Mutex<()> = Mutex::new(());

pub fn init(data: &std::path::Path) {
    let _ = PATH.set(data.join("generate-choices.json"));
}

fn path() -> Result<&'static PathBuf, (StatusCode, String)> {
    PATH.get().ok_or((StatusCode::INTERNAL_SERVER_ERROR, "the generation choices are not open".to_string()))
}

/// The choices as the window last saved them; an empty object before it ever did.
pub fn current() -> Result<Value, String> {
    read_value().map_err(|(_, error)| error)
}

fn read_value() -> Result<Value, (StatusCode, String)> {
    let path = path()?;
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("{}: {error}", path.display()))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Default::default())),
        Err(error) => Err((StatusCode::INTERNAL_SERVER_ERROR, format!("{}: {error}", path.display()))),
    }
}

async fn read() -> Result<Json<Value>, (StatusCode, String)> {
    read_value().map(Json)
}

async fn write(Json(choices): Json<Value>) -> Result<StatusCode, (StatusCode, String)> {
    if !choices.is_object() {
        return Err((StatusCode::BAD_REQUEST, "the generation choices are an object".to_string()));
    }
    let text = serde_json::to_string(&choices).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    if text.len() > MAX_BYTES {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, format!("the generation choices are {} bytes, at most {MAX_BYTES}", text.len())));
    }
    let path = path()?;
    let _held = WRITE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let partial = path.with_extension("partial");
    std::fs::write(&partial, text).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    std::fs::rename(&partial, path).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/generate/choices", axum::routing::get(read).put(write))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn choices_are_kept_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        assert_eq!(read().await.unwrap().0, serde_json::json!({}));
        let choices = serde_json::json!({ "task": "video", "repeat": 2 });
        assert_eq!(write(Json(choices.clone())).await.unwrap(), StatusCode::NO_CONTENT);
        assert_eq!(read().await.unwrap().0, choices);
        assert_eq!(write(Json(serde_json::json!([1]))).await.unwrap_err().0, StatusCode::BAD_REQUEST);
    }
}
