//! Finished videos onto the disk the person chooses. The editor renders in the window; the file comes here and
//! is written where the system "Save as" dialog says (by default the Videos folder), or into `data/exports`
//! when an agent exports. A saved file can be shown in the file manager.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{post, put};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio::io::AsyncWriteExt;

use crate::AppState;

/// A file name without folders or characters Windows refuses.
fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "videosos-export.mp4".into() } else { cleaned }
}

/// `name` in `dir`, numbered when the name is taken.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) => (stem.to_string(), format!(".{extension}")),
        None => (name.to_string(), String::new()),
    };
    (2..10_000).map(|n| dir.join(format!("{stem} ({n}){extension}"))).find(|path| !path.exists()).unwrap_or(candidate)
}

fn bad(status: StatusCode, message: String) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

#[derive(Deserialize)]
pub struct SaveQuery {
    name: String,
    /// Ask where to save with the system dialog.
    #[serde(default)]
    dialog: bool,
    /// Save next to this file (a subtitle beside its video) instead of asking.
    #[serde(default)]
    beside: Option<String>,
}

async fn save(State(state): State<AppState>, Query(query): Query<SaveQuery>, body: Body) -> Response {
    let name = clean_name(&query.name);
    let exports = state.data.join("exports");
    if let Err(error) = tokio::fs::create_dir_all(&exports).await {
        return bad(StatusCode::INTERNAL_SERVER_ERROR, error.to_string());
    }
    let partial = exports.join(format!(".{}.partial", uuid::Uuid::new_v4().simple()));
    let written = async {
        let mut file = tokio::fs::File::create(&partial).await?;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            file.write_all(&chunk.map_err(std::io::Error::other)?).await?;
        }
        file.flush().await?;
        std::io::Result::Ok(())
    }
    .await;
    if let Err(error) = written {
        let _ = tokio::fs::remove_file(&partial).await;
        return bad(StatusCode::INTERNAL_SERVER_ERROR, error.to_string());
    }
    let target = if let Some(beside) = query.beside.as_deref().filter(|beside| !beside.is_empty()) {
        let Some(dir) = Path::new(beside).parent().filter(|dir| dir.is_dir()) else {
            let _ = tokio::fs::remove_file(&partial).await;
            return bad(StatusCode::BAD_REQUEST, t!("exports-no-folder", path = beside.to_string()));
        };
        free_path(dir, &name)
    } else if query.dialog {
        let start = dirs::video_dir().filter(|dir| dir.is_dir()).unwrap_or_else(|| exports.clone());
        let chosen = rfd::AsyncFileDialog::new().set_directory(&start).set_file_name(&name).set_title(t!("exports-dialog-title")).save_file().await;
        match chosen {
            Some(handle) => handle.path().to_path_buf(),
            None => {
                let _ = tokio::fs::remove_file(&partial).await;
                return Json(json!({ "cancelled": true })).into_response();
            }
        }
    } else {
        free_path(&exports, &name)
    };
    let moved = match tokio::fs::rename(&partial, &target).await {
        Ok(()) => Ok(()),
        // another disk: copy, then let the partial go
        Err(_) => tokio::fs::copy(&partial, &target).await.map(|_| ()).and(tokio::fs::remove_file(&partial).await),
    };
    if let Err(error) = moved {
        let _ = tokio::fs::remove_file(&partial).await;
        return bad(StatusCode::INTERNAL_SERVER_ERROR, format!("{}: {error}", target.display()));
    }
    crate::hub::count("export_done");
    Json(json!({ "path": target.display().to_string() })).into_response()
}

#[derive(Deserialize)]
pub struct RevealBody {
    path: String,
}

/// Shows a file in the file manager, selected.
async fn reveal(Json(body): Json<RevealBody>) -> Response {
    let path = PathBuf::from(&body.path);
    if !path.exists() {
        return bad(StatusCode::NOT_FOUND, t!("exports-no-file", path = body.path.clone()));
    }
    let mut command = if cfg!(windows) {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", path.display()));
        command
    } else if cfg!(target_os = "macos") {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(&path);
        command
    } else {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(&path));
        command
    };
    match crate::process_group::detach_from_group(&mut command).spawn() {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => bad(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/exports", put(save)).route("/api/reveal", post(reveal))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_folders_and_forbidden_characters() {
        assert_eq!(clean_name("../a:b?.mp4"), ".._a_b_.mp4".trim_matches('.'));
        assert_eq!(clean_name("  "), "videosos-export.mp4");
        assert_eq!(clean_name("Клип 1.mp4"), "Клип 1.mp4");
    }
}
