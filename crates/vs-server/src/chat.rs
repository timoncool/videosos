//! The chat in the window, as Bulka's: an assistant on the person's OpenRouter key that works VideoSOS with the
//! very tools an agent connected over MCP has, so its changes go into the journal, its generations count
//! against the agents' daily limit and the window captions what it does. The server runs the model's loop
//! (a turn, its tool calls, their answers, the next turn) and streams the window what happens: the text as it
//! comes, each tool call and how it ended, and what the conversation cost.

use std::convert::Infallible;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use vs_providers::Provider;

use crate::AppState;

const API: &str = "https://openrouter.ai/api/v1/chat/completions";
/// Turns one message may take before the assistant has to stop and say where it got to.
const MAX_TURNS: usize = 60;
/// Models tried for a first chat, best first; the person picks any other.
const PREFERRED: &[&str] = &["anthropic/claude-haiku-5.5", "google/gemini-3.8-flash", "anthropic/claude-sonnet-5.5"];

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatBody {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

fn system_prompt(project: Option<&str>, language: Option<&str>) -> String {
    let mut prompt = String::from(
        "You are the assistant inside VideoSOS, a desktop studio that generates pictures, video, music, voices and \
         sounds through OpenRouter, fal and Runware and edits them on a multitrack timeline. You work the program \
         with its tools while the person watches the window: look before you change (timeline_get, ui_read_page), \
         say what you are about to do when it costs money, and answer briefly. Generations are paid by the \
         person's keys: ask before starting more than one or anything that costs over $0.50.\n\n",
    );
    if let Some(project) = project.filter(|project| !project.is_empty()) {
        prompt.push_str(&format!("The project open in the window is {project}: pass it as project_id where a tool takes one.\n"));
    }
    if let Some(language) = language.filter(|language| !language.is_empty()) {
        prompt.push_str(&format!("The window's language is {language}: answer in the person's language.\n"));
    }
    prompt.push('\n');
    prompt.push_str(crate::mcp::SKILL);
    prompt
}

/// false once the window is gone: the conversation stops there.
async fn send(events: &mpsc::Sender<Value>, event: Value) -> bool {
    events.send(event).await.is_ok()
}

/// One streamed turn of the model: its text, as it comes, and the tool calls it asks for.
struct Turn {
    text: String,
    calls: Vec<(String, String, String)>,
    cost: f64,
}

async fn turn(http: &reqwest::Client, key: &str, model: &str, messages: &[Value], events: &mpsc::Sender<Value>) -> Result<Turn, String> {
    // the guide and the tools are the same every step: cached, they cost a tenth from the second step on (Claude);
    // models that cache on their own ignore it
    let body = json!({ "model": model, "messages": messages, "tools": crate::mcp::chat_tools(), "stream": true, "usage": { "include": true }, "cache_control": { "type": "ephemeral" } });
    let response = http.post(API).bearer_auth(key).header("X-Title", "VideoSOS").json(&body).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(vs_providers::http::provider_message(&text).unwrap_or_else(|| format!("{status}: {text}")));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut turn = Turn { text: String::new(), calls: Vec::new(), cost: 0.0 };
    // a tool call comes in pieces by its index: its id and name first, then its arguments bit by bit
    let mut partial: Vec<(String, String, String)> = Vec::new();
    while let Some(chunk) = stream.next().await {
        buffer.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?));
        while let Some(end) = buffer.find('\n') {
            let line = buffer[..end].trim().to_string();
            buffer.drain(..=end);
            let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
            if data == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(error) = event.get("error") {
                return Err(error.get("message").and_then(Value::as_str).unwrap_or("the model failed").to_string());
            }
            if let Some(cost) = event.pointer("/usage/cost").and_then(Value::as_f64) {
                turn.cost += cost;
            }
            let Some(delta) = event.pointer("/choices/0/delta") else { continue };
            if let Some(text) = delta.get("content").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                turn.text.push_str(text);
                if !send(events, json!({ "type": "text", "text": text })).await {
                    return Err("the window left".into());
                }
            }
            for call in delta.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
                let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                while partial.len() <= index {
                    partial.push((String::new(), String::new(), String::new()));
                }
                let slot = &mut partial[index];
                if let Some(id) = call.get("id").and_then(Value::as_str) {
                    slot.0.push_str(id);
                }
                if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
                    slot.1.push_str(name);
                }
                if let Some(arguments) = call.pointer("/function/arguments").and_then(Value::as_str) {
                    slot.2.push_str(arguments);
                }
            }
        }
    }
    turn.calls = partial.into_iter().filter(|(_, name, _)| !name.is_empty()).collect();
    Ok(turn)
}

async fn conversation(state: AppState, body: ChatBody, key: String, events: mpsc::Sender<Value>) {
    let cost = converse(&state, &body, &key, &events).await;
    // the conversation is paid like a generation: it goes into the spending and the agents' daily limit
    if cost > 0.0 {
        let asked = body.messages.iter().rev().find(|message| message.role == "user").map(|message| message.content.clone()).unwrap_or_default();
        state.jobs.record_chat(body.project_id.as_deref(), &body.model, &asked, cost);
    }
}

/// Runs the conversation to its end and answers with what it cost.
async fn converse(state: &AppState, body: &ChatBody, key: &str, events: &mpsc::Sender<Value>) -> f64 {
    let mut messages = vec![json!({ "role": "system", "content": system_prompt(body.project_id.as_deref(), body.language.as_deref()) })];
    for message in &body.messages {
        if matches!(message.role.as_str(), "user" | "assistant") && !message.content.trim().is_empty() {
            messages.push(json!({ "role": message.role, "content": message.content }));
        }
    }
    let mut cost = 0.0;
    for _ in 0..MAX_TURNS {
        let turn = match turn(&state.http.client, key, &body.model, &messages, events).await {
            Ok(turn) => turn,
            Err(error) => {
                send(events, json!({ "type": "error", "message": error, "cost": cost })).await;
                return cost;
            }
        };
        cost += turn.cost;
        if turn.calls.is_empty() {
            send(events, json!({ "type": "done", "cost": cost })).await;
            return cost;
        }
        if !send(events, json!({ "type": "cost", "cost": cost })).await {
            return cost;
        }
        let calls: Vec<Value> = turn.calls.iter().map(|(id, name, arguments)| json!({ "id": id, "type": "function", "function": { "name": name, "arguments": arguments } })).collect();
        messages.push(json!({ "role": "assistant", "content": turn.text, "tool_calls": calls }));
        let mut pictures = Vec::new();
        for (id, name, arguments) in &turn.calls {
            let args: Value = if arguments.trim().is_empty() { Value::Object(Map::new()) } else { serde_json::from_str(arguments).unwrap_or(Value::Object(Map::new())) };
            if !send(events, json!({ "type": "tool", "id": id, "name": name, "args": args })).await {
                return cost;
            }
            let answer = crate::mcp::chat_call(state, name, &args).await;
            let (ok, text) = match &answer {
                Ok(answer) => (true, answer.text.clone()),
                Err(problem) => (false, problem.clone()),
            };
            if let Ok(crate::mcp::ChatAnswer { image: Some(image), .. }) = &answer {
                pictures.push(image.clone());
            }
            send(events, json!({ "type": "tool_done", "id": id, "ok": ok, "summary": text.chars().take(240).collect::<String>() })).await;
            messages.push(json!({ "role": "tool", "tool_call_id": id, "content": if ok { text } else { format!("Error: {text}") } }));
        }
        // a tool's picture (the window's screenshot) reaches the model as a picture of the next message
        if !pictures.is_empty() {
            let mut content = vec![json!({ "type": "text", "text": "The pictures the tools above answered with." })];
            content.extend(pictures.into_iter().map(|url| json!({ "type": "image_url", "image_url": { "url": url } })));
            messages.push(json!({ "role": "user", "content": content }));
        }
    }
    send(events, json!({ "type": "error", "message": t!("chat-too-many-turns", turns = MAX_TURNS), "cost": cost })).await;
    cost
}

async fn chat(State(state): State<AppState>, Json(body): Json<ChatBody>) -> Response {
    let Some((key, _)) = crate::credentials::key(Provider::Openrouter) else {
        return (axum::http::StatusCode::PRECONDITION_FAILED, Json(json!({ "error": t!("jobs-no-key", provider = "openrouter") }))).into_response();
    };
    if body.model.trim().is_empty() || body.messages.is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, Json(json!({ "error": t!("chat-empty") }))).into_response();
    }
    let (events, received) = mpsc::channel::<Value>(256);
    tokio::spawn(conversation(state, body, key, events));
    let stream = tokio_stream::wrappers::ReceiverStream::new(received).map(|event| Ok::<Event, Infallible>(Event::default().data(event.to_string())));
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

/// The OpenRouter models that can work the tools, newest first, and the one to start with.
async fn models(State(state): State<AppState>) -> Json<Value> {
    let mut entries: Vec<_> = state
        .catalog
        .entries()
        .into_iter()
        .filter(|entry| entry.provider == Provider::Openrouter && entry.tasks.contains(&vs_providers::Task::Text) && !entry.id.ends_with(":batch"))
        .filter(|entry| entry.source["parameters"].as_array().is_some_and(|parameters| parameters.iter().any(|parameter| parameter == "tools")))
        .collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created));
    let default = PREFERRED.iter().find(|id| entries.iter().any(|entry| entry.id == **id)).map(|id| id.to_string()).or_else(|| entries.first().map(|entry| entry.id.clone()));
    let list: Vec<Value> = entries.iter().map(|entry| json!({ "id": entry.id, "name": entry.name, "rates": entry.rates })).collect();
    Json(json!({ "models": list, "default": default }))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/chat", axum::routing::post(chat)).route("/api/chat/models", axum::routing::get(models))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_names_the_project_and_the_language_and_carries_the_skill() {
        let prompt = system_prompt(Some("abc123"), Some("ru"));
        assert!(prompt.contains("abc123") && prompt.contains("ru"));
        assert!(prompt.contains(crate::mcp::SKILL));
    }

    #[test]
    fn every_tool_is_offered_to_the_chat_as_a_function() {
        let tools = crate::mcp::chat_tools();
        assert!(tools.iter().all(|tool| tool["type"] == "function" && tool["function"]["parameters"]["type"] == "object"));
        assert!(tools.iter().any(|tool| tool["function"]["name"] == "timeline_edit"));
    }
}
