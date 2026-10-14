//! The window's assistant questions put to the connected agent: when the person chose the agent as VideoSOS's
//! assistant (Settings, Agents), Improve prompt, Prompt from the picture, the storyboard's split, the blocking and
//! the chat ask it here instead of a paid model, as YuE2 Studio's writing assistant asks its agent.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::AppState;

#[derive(Debug, Deserialize)]
struct Ask {
    /// What the question is for: `improve_prompt`, `describe_image`, `split_script`, `blocking`, `chat`.
    target: String,
    /// What the window's own assistant would be told to do.
    instructions: String,
    request: String,
    /// The pictures the assistant would see, as media or job references.
    #[serde(default)]
    images: Vec<Value>,
    /// The form of the answer, when it must be JSON.
    #[serde(default)]
    answer_form: Option<Value>,
    #[serde(default)]
    project_id: Option<String>,
}

async fn ask(Json(ask): Json<Ask>) -> Response {
    if ask.request.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "the question is empty" }))).into_response();
    }
    let question = json!({
        "target": ask.target,
        "instructions": ask.instructions,
        "request": ask.request,
        "images": ask.images,
        "answer_form": ask.answer_form,
        "project_id": ask.project_id,
    });
    match crate::mcp::ask_agent(question).await {
        Ok(answer) => Json(json!({ "answer": answer })).into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": error }))).into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/assistant/ask", post(ask))
}
