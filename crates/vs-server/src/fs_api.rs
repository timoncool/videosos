//! The editor's workspace folder over HTTP. The window keeps its projects, media, thumbnails and caches as
//! files in one directory tree and walks it with the File System Access calls (`getDirectoryHandle`,
//! `getFileHandle`, `values`, `removeEntry`, `createWritable`, `move`); the page's adapter maps each call to
//! one of these routes, so the tree lives on disk under `data/workspace`, where the server, the MCP tools
//! and finished generations reach the same files.
//!
//! A failure answers with the name of the DOMException the browser would have thrown (`NotFoundError`,
//! `TypeMismatchError`, `InvalidModificationError`, `NotAllowedError`), which the adapter rethrows as is:
//! the editor's storage code branches on those names.

use std::path::{Component, Path, PathBuf};

use axum::body::Body;
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::AppState;

#[derive(Debug)]
pub struct FsError {
    name: &'static str,
    message: String,
}

impl FsError {
    fn new(name: &'static str, message: impl Into<String>) -> Self {
        Self { name, message: message.into() }
    }

    fn not_found(path: &str) -> Self {
        Self::new("NotFoundError", format!("{path} does not exist in the workspace"))
    }

    fn io(path: &str, error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::not_found(path),
            std::io::ErrorKind::PermissionDenied => Self::new("NotAllowedError", format!("{path}: {error}")),
            _ => Self::new("InvalidStateError", format!("{path}: {error}")),
        }
    }
}

impl IntoResponse for FsError {
    fn into_response(self) -> Response {
        let status = match self.name {
            "NotFoundError" => StatusCode::NOT_FOUND,
            "TypeMismatchError" | "InvalidModificationError" => StatusCode::CONFLICT,
            "NotAllowedError" => StatusCode::FORBIDDEN,
            "TypeError" => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(json!({ "name": self.name, "message": self.message }))).into_response()
    }
}

/// A workspace path from the window: `/`-separated names, each a plain file or folder name. The empty
/// path is the workspace itself.
pub fn resolve(workspace: &Path, relative: &str) -> Result<PathBuf, FsError> {
    let mut path = workspace.to_path_buf();
    for name in relative.split('/').filter(|name| !name.is_empty()) {
        let plain = !matches!(name, "." | "..")
            && !name.contains(['\\', ':', '\0'])
            && Path::new(name).components().all(|part| matches!(part, Component::Normal(_)));
        if !plain {
            return Err(FsError::new("TypeError", format!("not a name inside the workspace: {name:?}")));
        }
        path.push(name);
    }
    Ok(path)
}

#[derive(Deserialize)]
pub struct PathQuery {
    #[serde(default)]
    path: String,
    #[serde(default)]
    recursive: bool,
}

#[derive(Serialize)]
struct Entry {
    name: String,
    kind: &'static str,
    size: Option<u64>,
}

async fn list(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Result<Json<Vec<Entry>>, FsError> {
    let dir = resolve(&state.workspace, &query.path)?;
    let meta = tokio::fs::metadata(&dir).await.map_err(|e| FsError::io(&query.path, e))?;
    if !meta.is_dir() {
        return Err(FsError::new("TypeMismatchError", format!("{} is a file, not a folder", query.path)));
    }
    let mut reader = tokio::fs::read_dir(&dir).await.map_err(|e| FsError::io(&query.path, e))?;
    let mut entries = Vec::new();
    while let Some(entry) = reader.next_entry().await.map_err(|e| FsError::io(&query.path, e))? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(PARTIAL) {
            continue;
        }
        let Ok(meta) = entry.metadata().await else { continue };
        entries.push(Entry {
            name,
            kind: if meta.is_dir() { "directory" } else { "file" },
            size: meta.is_file().then(|| meta.len()),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(entries))
}

async fn stat(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Result<Json<serde_json::Value>, FsError> {
    let path = resolve(&state.workspace, &query.path)?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| FsError::io(&query.path, e))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as u64);
    Ok(Json(json!({
        "kind": if meta.is_dir() { "directory" } else { "file" },
        "size": meta.is_file().then(|| meta.len()),
        "modified": modified,
    })))
}

async fn mkdir(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Result<StatusCode, FsError> {
    let path = resolve(&state.workspace, &query.path)?;
    if let Ok(meta) = tokio::fs::metadata(&path).await {
        return if meta.is_dir() {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(FsError::new("TypeMismatchError", format!("{} is a file, not a folder", query.path)))
        };
    }
    tokio::fs::create_dir_all(&path).await.map_err(|e| FsError::io(&query.path, e))?;
    Ok(StatusCode::NO_CONTENT)
}

/// The suffix of a file being written; it is never listed, and the rename at the end of the upload makes
/// the new content appear whole.
const PARTIAL: &str = ".vs-partial";

/// Creates an empty file when there is none (`getFileHandle(name, { create: true })`).
async fn touch(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Result<StatusCode, FsError> {
    let path = resolve(&state.workspace, &query.path)?;
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => Err(FsError::new("TypeMismatchError", format!("{} is a folder, not a file", query.path))),
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(_) => {
            let parent = path.parent().ok_or_else(|| FsError::new("TypeError", "the workspace itself is not a file"))?;
            if !parent.is_dir() {
                return Err(FsError::not_found(&query.path));
            }
            tokio::fs::write(&path, b"").await.map_err(|e| FsError::io(&query.path, e))?;
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

/// The file's bytes; byte ranges are honoured, so a video plays and seeks straight from disk.
async fn read(State(state): State<AppState>, Query(query): Query<PathQuery>, request: Request) -> Result<Response, FsError> {
    let path = resolve(&state.workspace, &query.path)?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| FsError::io(&query.path, e))?;
    if meta.is_dir() {
        return Err(FsError::new("TypeMismatchError", format!("{} is a folder, not a file", query.path)));
    }
    serve_file(&path, request).await
}

/// A file from disk with byte ranges and the type its name says.
pub async fn serve_file(path: &Path, request: Request) -> Result<Response, FsError> {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let response = ServeFile::new_with_mime(path, &mime)
        .oneshot(request)
        .await
        .map_err(|error| FsError::new("InvalidStateError", error.to_string()))?;
    let mut response = response.map(Body::new);
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

/// The body becomes the file's whole new content: written beside it, then renamed over it.
async fn write(State(state): State<AppState>, Query(query): Query<PathQuery>, body: Body) -> Result<StatusCode, FsError> {
    let path = resolve(&state.workspace, &query.path)?;
    if path.is_dir() {
        return Err(FsError::new("TypeMismatchError", format!("{} is a folder, not a file", query.path)));
    }
    let parent = path.parent().ok_or_else(|| FsError::new("TypeError", "the workspace itself is not a file"))?;
    if !parent.is_dir() {
        return Err(FsError::not_found(&query.path));
    }
    let partial = path.with_file_name(format!(
        "{}.{}{PARTIAL}",
        path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        uuid::Uuid::new_v4().simple()
    ));
    let written = async {
        let mut file = tokio::fs::File::create(&partial).await?;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(std::io::Error::other)?;
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        file.sync_all().await?;
        drop(file);
        replace(&partial, &path).await
    }
    .await;
    if let Err(error) = written {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(FsError::io(&query.path, error));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Renames `from` over `to`. Windows refuses while another reader has `to` open for a moment (a thumbnail
/// being served), so the rename is retried briefly before it counts as failed.
async fn replace(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..20u64 {
        match tokio::fs::rename(from, to).await {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                last = Some(error);
                tokio::time::sleep(std::time::Duration::from_millis(25 * (attempt + 1))).await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rename failed")))
}

async fn remove(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Result<StatusCode, FsError> {
    if query.path.trim_matches('/').is_empty() {
        return Err(FsError::new("InvalidModificationError", "the workspace folder itself is not removed"));
    }
    let path = resolve(&state.workspace, &query.path)?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| FsError::io(&query.path, e))?;
    if meta.is_dir() {
        if query.recursive {
            tokio::fs::remove_dir_all(&path).await.map_err(|e| FsError::io(&query.path, e))?;
        } else {
            let mut reader = tokio::fs::read_dir(&path).await.map_err(|e| FsError::io(&query.path, e))?;
            if reader.next_entry().await.map_err(|e| FsError::io(&query.path, e))?.is_some() {
                return Err(FsError::new("InvalidModificationError", format!("{} is not empty", query.path)));
            }
            tokio::fs::remove_dir(&path).await.map_err(|e| FsError::io(&query.path, e))?;
        }
    } else {
        tokio::fs::remove_file(&path).await.map_err(|e| FsError::io(&query.path, e))?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct MoveQuery {
    from: String,
    to: String,
}

async fn rename(State(state): State<AppState>, Query(query): Query<MoveQuery>) -> Result<StatusCode, FsError> {
    let from = resolve(&state.workspace, &query.from)?;
    let to = resolve(&state.workspace, &query.to)?;
    if !from.exists() {
        return Err(FsError::not_found(&query.from));
    }
    if to.is_dir() {
        return Err(FsError::new("InvalidModificationError", format!("{} is a folder", query.to)));
    }
    replace(&from, &to).await.map_err(|e| FsError::io(&query.to, e))?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/fs/list", get(list))
        .route("/api/fs/stat", get(stat))
        .route("/api/fs/mkdir", post(mkdir))
        .route("/api/fs/touch", post(touch))
        .route("/api/fs/read", get(read))
        .route("/api/fs/write", put(write))
        .route("/api/fs/remove", delete(remove))
        .route("/api/fs/move", post(rename))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_names_resolve_inside_the_workspace() {
        let root = Path::new("/w");
        assert_eq!(resolve(root, "").unwrap(), PathBuf::from("/w"));
        assert_eq!(resolve(root, "projects/a b/project.json").unwrap(), PathBuf::from("/w/projects/a b/project.json"));
        for bad in ["..", "a/../b", "C:", "a\\b", "./x", "a/\0"] {
            assert!(resolve(root, bad).is_err(), "{bad} must be refused");
        }
    }
}
