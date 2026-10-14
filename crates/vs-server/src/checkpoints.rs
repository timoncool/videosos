//! Checkpoints of a project's timeline, as WeftCut keeps them for its agent: the window keeps the timeline as it
//! was before each agent's edit (and whenever the person or an agent asks), the person or an agent goes back to
//! one. They live in `data/checkpoints/<project>/`, the newest thirty of each project.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use axum::extract::Path as UrlPath;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppState;

const KEPT: usize = 30;
/// A timeline is JSON of items, not media: a larger one is a window sending something it should not.
const MAX_BYTES: usize = 8 * 1024 * 1024;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static WRITE: Mutex<()> = Mutex::new(());

pub fn init(data: &std::path::Path) {
    let _ = DIR.set(data.join("checkpoints"));
}

type Failure = (StatusCode, String);

fn project_dir(project: &str) -> Result<PathBuf, Failure> {
    if project.is_empty() || !project.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err((StatusCode::BAD_REQUEST, format!("{project} is not a project id")));
    }
    let dir = DIR.get().ok_or((StatusCode::INTERNAL_SERVER_ERROR, "the checkpoints are not open".to_string()))?;
    Ok(dir.join(project))
}

/// What a checkpoint says of itself in a list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Summary {
    pub id: String,
    pub created: i64,
    /// `agent` before an agent's edit, `restore` before going back to another checkpoint, `asked` when made on purpose.
    pub reason: String,
    /// How many edits the agent was about to make, for `agent`.
    #[serde(default)]
    pub edits: Option<u32>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Checkpoint {
    #[serde(flatten)]
    pub summary: Summary,
    pub timeline: Value,
}

#[derive(Debug, Deserialize)]
struct NewCheckpoint {
    reason: String,
    #[serde(default)]
    edits: Option<u32>,
    #[serde(default)]
    label: Option<String>,
    timeline: Value,
}

fn summaries(project: &str) -> Result<Vec<Summary>, Failure> {
    let dir = project_dir(project)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut list: Vec<Summary> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|extension| extension == "json"))
        .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_json::from_str::<Checkpoint>(&text).ok())
        .map(|checkpoint| checkpoint.summary)
        .collect();
    list.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| b.id.cmp(&a.id)));
    Ok(list)
}

async fn list(UrlPath(project): UrlPath<String>) -> Result<Json<Vec<Summary>>, Failure> {
    summaries(&project).map(Json)
}

async fn create(UrlPath(project): UrlPath<String>, Json(request): Json<NewCheckpoint>) -> Result<Json<Summary>, Failure> {
    if !matches!(request.reason.as_str(), "agent" | "restore" | "asked") {
        return Err((StatusCode::BAD_REQUEST, format!("{} is not a reason for a checkpoint", request.reason)));
    }
    if !request.timeline.is_object() {
        return Err((StatusCode::BAD_REQUEST, "a checkpoint keeps a timeline object".to_string()));
    }
    let dir = project_dir(&project)?;
    let summary = Summary {
        id: uuid::Uuid::now_v7().simple().to_string(),
        created: chrono::Utc::now().timestamp_millis(),
        reason: request.reason,
        edits: request.edits,
        label: request.label.map(|label| label.chars().take(200).collect()),
    };
    let text = serde_json::to_string(&Checkpoint { summary: summary.clone(), timeline: request.timeline }).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    if text.len() > MAX_BYTES {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, format!("the checkpoint is {} bytes, at most {MAX_BYTES}", text.len())));
    }
    let _held = WRITE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    std::fs::create_dir_all(&dir).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    std::fs::write(dir.join(format!("{}.json", summary.id)), text).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    for old in summaries(&project)?.into_iter().skip(KEPT) {
        std::fs::remove_file(dir.join(format!("{}.json", old.id))).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    Ok(Json(summary))
}

async fn read(UrlPath((project, id)): UrlPath<(String, String)>) -> Result<Json<Checkpoint>, Failure> {
    if !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err((StatusCode::BAD_REQUEST, format!("{id} is not a checkpoint id")));
    }
    let path = project_dir(&project)?.join(format!("{id}.json"));
    let text = std::fs::read_to_string(&path).map_err(|_| (StatusCode::NOT_FOUND, format!("no checkpoint {id} of {project}")))?;
    serde_json::from_str(&text).map(Json).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("{}: {error}", path.display())))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/checkpoints/{project}", get(list).post(create))
        .route("/api/checkpoints/{project}/{id}", get(read))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn checkpoints_are_kept_newest_first_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        let project = "p1".to_string();
        let first = create(UrlPath(project.clone()), Json(NewCheckpoint { reason: "agent".into(), edits: Some(2), label: None, timeline: json!({ "items": [1] }) })).await.unwrap().0;
        let second = create(UrlPath(project.clone()), Json(NewCheckpoint { reason: "asked".into(), edits: None, label: Some("before the cut".into()), timeline: json!({ "items": [] }) })).await.unwrap().0;
        let listed = list(UrlPath(project.clone())).await.unwrap().0;
        assert_eq!(listed.iter().map(|each| each.id.clone()).collect::<Vec<_>>(), vec![second.id.clone(), first.id.clone()]);
        assert_eq!(read(UrlPath((project.clone(), first.id.clone()))).await.unwrap().0.timeline, json!({ "items": [1] }));
        assert_eq!(create(UrlPath("../x".into()), Json(NewCheckpoint { reason: "agent".into(), edits: None, label: None, timeline: json!({}) })).await.unwrap_err().0, StatusCode::BAD_REQUEST);
        assert_eq!(create(UrlPath(project.clone()), Json(NewCheckpoint { reason: "other".into(), edits: None, label: None, timeline: json!({}) })).await.unwrap_err().0, StatusCode::BAD_REQUEST);
        assert_eq!(read(UrlPath((project, "zz".into()))).await.unwrap_err().0, StatusCode::BAD_REQUEST);
    }
}
