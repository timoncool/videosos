//! VideoSOS as an MCP server: Streamable HTTP, stateless JSON-RPC at `/mcp`.
//!
//! Every server tool is a route of the program's own API, called inside the process through the router the
//! window uses, so an agent does exactly what the window does. Editor tools (the timeline, the media
//! library, the picture of the window) are commands for the open window, which runs them on its live
//! editor with undo, while the person watches. Every tool call that changes something is written to the
//! Activity journal and shown in the window.

use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::AppState;

static API: OnceLock<Router> = OnceLock::new();

/// The API the tools call; set once the router is built.
pub fn install(api: Router) {
    let _ = API.set(api);
}

const STUDIO: &str = "VideoSOS";
const SKILL: &str = include_str!("../../../docs/mcp-skill.md");
const SKILL_URI: &str = "videosos://skill";
const LIMIT: usize = 60_000;

enum Payload {
    None,
    Json(Value),
    Window { command: &'static str, args: Value, seconds: u64 },
    Composite(&'static str),
}

struct Call {
    method: Method,
    path: String,
    payload: Payload,
}

struct Tool {
    name: &'static str,
    description: &'static str,
    /// Whether the tool changes nothing: the journal and the window's notice skip those.
    looks: bool,
    schema: fn() -> Value,
    call: fn(&Value) -> Result<Call, String>,
}

fn get_call(path: String) -> Result<Call, String> {
    Ok(Call { method: Method::GET, path, payload: Payload::None })
}

fn send(method: Method, path: String, body: Value) -> Result<Call, String> {
    Ok(Call { method, path, payload: Payload::Json(body) })
}

fn window(command: &'static str, args: &Value, seconds: u64) -> Result<Call, String> {
    Ok(Call { method: Method::GET, path: String::new(), payload: Payload::Window { command, args: args.clone(), seconds } })
}

fn composite(kind: &'static str) -> Result<Call, String> {
    Ok(Call { method: Method::GET, path: String::new(), payload: Payload::Composite(kind) })
}

fn text(args: &Value, name: &str) -> Result<String, String> {
    args.get(name).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string).ok_or_else(|| format!("'{name}' is required"))
}

fn segment(value: &str) -> String {
    value.bytes().map(|byte| if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect()
}

fn query(pairs: &[(&str, Option<String>)]) -> String {
    let parts: Vec<String> = pairs.iter().filter_map(|(name, value)| value.as_ref().map(|value| format!("{name}={}", segment(value)))).collect();
    if parts.is_empty() { String::new() } else { format!("?{}", parts.join("&")) }
}

fn opt(args: &Value, name: &str) -> Option<String> {
    args.get(name).and_then(|value| match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required })
}

fn nothing() -> Value {
    object(json!({}), &[])
}

const TASKS: &str = "image, image_edit, video, video_edit, lip_sync, upscale, remove_background, music, speech, sound, transcribe, text";

fn tools() -> &'static [Tool] {
    static TOOLS: OnceLock<Vec<Tool>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        vec![
            Tool {
                name: "studio_status",
                description: "What VideoSOS is doing now: its version, which provider keys are set, the model catalogues, jobs running, money spent today, whether the window is open and which project it shows. Start here.",
                looks: true,
                schema: nothing,
                call: |_| composite("status"),
            },
            Tool {
                name: "models_list",
                description: "Models of OpenRouter, fal and Runware for a task, newest first, with the provider's price line. Filter by task, provider and words. Tasks: image, image_edit, video, video_edit, lip_sync, upscale, remove_background, music, speech, sound, transcribe, text.",
                looks: true,
                schema: || object(json!({
                    "task": { "type": "string", "description": TASKS },
                    "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] },
                    "query": { "type": "string", "description": "words to find in the name, id or description" },
                }), &[]),
                call: |args| get_call(format!("/api/catalog{}", query(&[("task", opt(args, "task")), ("provider", opt(args, "provider")), ("q", opt(args, "query"))]))),
            },
            Tool {
                name: "model_form",
                description: "The settings a model takes, as fields: key, type, choices, default, what it means (role) and whether it takes files (type media). Read it before generate: values are given by these keys.",
                looks: true,
                schema: || object(json!({ "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] }, "model": { "type": "string" } }), &["provider", "model"]),
                call: |args| get_call(format!("/api/catalog/form?provider={}&id={}", segment(&text(args, "provider")?), segment(&text(args, "model")?))),
            },
            Tool {
                name: "price_estimate",
                description: "The price of a run before it runs, in USD, from the model's rates and these values; null when the provider only bills after.",
                looks: true,
                schema: || object(json!({
                    "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] },
                    "model": { "type": "string" },
                    "values": { "type": "object" },
                    "repeat": { "type": "integer", "minimum": 1, "maximum": 8 },
                }), &["provider", "model"]),
                call: |args| send(Method::POST, "/api/catalog/estimate".into(), json!({ "provider": text(args, "provider")?, "id": text(args, "model")?, "values": args.get("values").cloned().unwrap_or(json!({})), "repeat": args.get("repeat").cloned().unwrap_or(json!(1)) })),
            },
            Tool {
                name: "generate",
                description: "Starts a generation (paid by the person's key). values are the model_form keys; a field of type media takes a list of files: {\"media\": \"<media id of the library>\"}, {\"job\": \"<job id>\", \"index\": 0} for an earlier result, {\"file\": \"<absolute path on this computer>\"} or an https URL. With project_id the result goes into that project's library when its window is open, and with place_on_timeline onto its timeline at the playhead. Returns the jobs; follow them with job_wait. Refused when it would pass the daily limit the person set for agents.",
                looks: false,
                schema: || object(json!({
                    "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] },
                    "model": { "type": "string" },
                    "task": { "type": "string", "description": TASKS },
                    "values": { "type": "object" },
                    "project_id": { "type": "string" },
                    "repeat": { "type": "integer", "minimum": 1, "maximum": 8, "description": "separate runs, each paid" },
                    "place_on_timeline": { "type": "boolean" },
                }), &["provider", "model", "values"]),
                call: |args| send(Method::POST, "/api/jobs".into(), json!({
                    "provider": text(args, "provider")?,
                    "model": text(args, "model")?,
                    "task": args.get("task").cloned().unwrap_or(Value::Null),
                    "values": args.get("values").cloned().unwrap_or(json!({})),
                    "project_id": args.get("project_id").cloned().unwrap_or(Value::Null),
                    "repeat": args.get("repeat").cloned().unwrap_or(json!(1)),
                    "place": args.get("place_on_timeline").cloned().unwrap_or(json!(false)),
                    "origin": "agent",
                })),
            },
            Tool {
                name: "jobs_list",
                description: "Generation jobs, newest first: status, error, cost, files. Optionally only one project's.",
                looks: true,
                schema: || object(json!({ "project_id": { "type": "string" }, "limit": { "type": "integer" } }), &[]),
                call: |args| get_call(format!("/api/jobs{}", query(&[("project", opt(args, "project_id")), ("limit", opt(args, "limit"))]))),
            },
            Tool {
                name: "job_get",
                description: "One job: status, progress, error, cost and its files (their URLs are under /api/jobs/<id>/files/<index>).",
                looks: true,
                schema: || object(json!({ "job_id": { "type": "string" } }), &["job_id"]),
                call: |args| get_call(format!("/api/jobs/{}", segment(&text(args, "job_id")?))),
            },
            Tool {
                name: "job_wait",
                description: "Waits until the job ends or `seconds` pass (at most 55), then says where it is. Call again while it runs.",
                looks: true,
                schema: || object(json!({ "job_id": { "type": "string" }, "seconds": { "type": "integer", "minimum": 1, "maximum": 55 } }), &["job_id"]),
                call: |_| composite("wait"),
            },
            Tool {
                name: "job_cancel",
                description: "Cancels a running job (fal stops it; OpenRouter and Runware cannot be stopped, so the program stops waiting and it may still be billed).",
                looks: false,
                schema: || object(json!({ "job_id": { "type": "string" } }), &["job_id"]),
                call: |args| send(Method::POST, format!("/api/jobs/{}/cancel", segment(&text(args, "job_id")?)), json!({})),
            },
            Tool {
                name: "job_retry",
                description: "Runs a finished or failed job again with the same model and settings (paid again).",
                looks: false,
                schema: || object(json!({ "job_id": { "type": "string" } }), &["job_id"]),
                call: |args| send(Method::POST, format!("/api/jobs/{}/retry", segment(&text(args, "job_id")?)), json!({})),
            },
            Tool {
                name: "job_delete",
                description: "Forgets a finished job and deletes its files (media already imported into a project stays there).",
                looks: false,
                schema: || object(json!({ "job_id": { "type": "string" } }), &["job_id"]),
                call: |args| send(Method::DELETE, format!("/api/jobs/{}", segment(&text(args, "job_id")?)), Value::Null),
            },
            Tool {
                name: "spend",
                description: "Money spent on generations: in total, today, by provider; optionally for one project.",
                looks: true,
                schema: || object(json!({ "project_id": { "type": "string" } }), &[]),
                call: |args| get_call(format!("/api/spend{}", query(&[("project", opt(args, "project_id"))]))),
            },
            Tool {
                name: "keys_status",
                description: "Which provider keys are set and where from. Keys themselves are never shown.",
                looks: true,
                schema: nothing,
                call: |_| get_call("/api/keys".into()),
            },
            Tool {
                name: "key_check",
                description: "Checks a provider key with a free call and reports the balance when the provider tells it.",
                looks: true,
                schema: || object(json!({ "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] } }), &["provider"]),
                call: |args| send(Method::POST, format!("/api/keys/{}/check", segment(&text(args, "provider")?)), json!({})),
            },
            Tool {
                name: "catalog_refresh",
                description: "Reads the model catalogues again (all providers, or one). Runs in the background; models_list shows progress.",
                looks: false,
                schema: || object(json!({ "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] } }), &[]),
                call: |args| send(Method::POST, "/api/catalog/refresh".into(), json!({ "provider": args.get("provider").cloned().unwrap_or(Value::Null) })),
            },
            Tool {
                name: "projects_list",
                description: "The projects of the workspace: id, name, size and length, last change.",
                looks: true,
                schema: nothing,
                call: |_| composite("projects"),
            },
            Tool {
                name: "project_get",
                description: "A project from disk: canvas, tracks and their clips (ids, type, start and length in frames and seconds, media, text). For the open project timeline_get reads the live editor instead.",
                looks: true,
                schema: || object(json!({ "project_id": { "type": "string" } }), &["project_id"]),
                call: |_| composite("project"),
            },
            Tool {
                name: "activity_list",
                description: "The journal of what agents did through MCP, newest last.",
                looks: true,
                schema: nothing,
                call: |_| composite("activity"),
            },
            Tool {
                name: "ui_screenshot",
                description: "A picture of the VideoSOS window as the person sees it.",
                looks: true,
                schema: || object(json!({ "max_width": { "type": "integer" } }), &[]),
                call: |args| window("screenshot", args, 30),
            },
            Tool {
                name: "ui_read_page",
                description: "Every visible control of the window, one line each, with the ref ui_click and ui_type take.",
                looks: true,
                schema: nothing,
                call: |args| window("read_page", args, 15),
            },
            Tool {
                name: "ui_click",
                description: "Clicks a control by ref (from ui_read_page) or by its label.",
                looks: false,
                schema: || object(json!({ "ref": { "type": "string" }, "text": { "type": "string" } }), &[]),
                call: |args| window("click", args, 15),
            },
            Tool {
                name: "ui_type",
                description: "Types a value into a field by ref or label, replacing what is there.",
                looks: false,
                schema: || object(json!({ "ref": { "type": "string" }, "text": { "type": "string" }, "value": { "type": "string" }, "submit": { "type": "boolean" } }), &["value"]),
                call: |args| window("type", args, 15),
            },
            Tool {
                name: "ui_press_key",
                description: "Presses a key or a combination in the window (Space plays, Ctrl+Z undoes).",
                looks: false,
                schema: || object(json!({ "key": { "type": "string" } }), &["key"]),
                call: |args| window("press_key", args, 15),
            },
            Tool {
                name: "ui_scroll",
                description: "Scrolls the window or brings a control into view.",
                looks: false,
                schema: || object(json!({ "direction": { "type": "string", "enum": ["up", "down"] }, "amount": { "type": "integer" }, "ref": { "type": "string" }, "text": { "type": "string" } }), &[]),
                call: |args| window("scroll", args, 15),
            },
            Tool {
                name: "ui_console",
                description: "The window's recent errors and warnings.",
                looks: true,
                schema: nothing,
                call: |args| window("console", args, 15),
            },
            Tool {
                name: "project_open",
                description: "Opens a project in the editor of the window (projects_list names them), or the projects list with no id.",
                looks: false,
                schema: || object(json!({ "project_id": { "type": "string" } }), &[]),
                call: |args| window("project_open", args, 30),
            },
            Tool {
                name: "editor_state",
                description: "The editor now: which project, its canvas and frame rate, the playhead, what is selected, the open sidebar tab.",
                looks: true,
                schema: nothing,
                call: |args| window("editor_state", args, 15),
            },
            Tool {
                name: "timeline_get",
                description: "The live timeline of the open project: tracks and clips with ids, start and length (frames and seconds), media and text, transitions.",
                looks: true,
                schema: nothing,
                call: |args| window("timeline_get", args, 15),
            },
            Tool {
                name: "timeline_edit",
                description: "Edits the open project's timeline with the editor's own operations, as one undoable step each. ops is a list of {op, ...}: addClip {mediaId, from, trackId?}; addText {text, from, durationInFrames, fontSize?, color?}; moveItem {id, from, trackId?}; updateItem {id, updates}; removeItems {ids}; split {id, frame}; trimStart {id, frames}; trimEnd {id, frames}; addTransition {leftClipId, rightClipId, type?, durationInFrames?}; removeTransition {id}; addTrack {kind: video|audio}; addKeyframe {itemId, property, frame, value, easing?}; addEffect {itemId, effect}; setTransform {id, transform}. Frames are of the project's frame rate. An op may name the result of an earlier one with {\"$ref\": \"<callerId>#/detail/created/0\"} when it carries callerId.",
                looks: false,
                schema: || object(json!({ "ops": { "type": "array", "items": { "type": "object" } } }), &["ops"]),
                call: |args| window("timeline_edit", args, 60),
            },
            Tool {
                name: "timeline_undo",
                description: "Undoes the last edit of the open project (the person's or an agent's).",
                looks: false,
                schema: nothing,
                call: |args| window("timeline_undo", args, 15),
            },
            Tool {
                name: "timeline_redo",
                description: "Redoes the last undone edit.",
                looks: false,
                schema: nothing,
                call: |args| window("timeline_redo", args, 15),
            },
            Tool {
                name: "media_list",
                description: "The media library of the open project: id, file name, type, length, size, tags (generated results are tagged).",
                looks: true,
                schema: nothing,
                call: |args| window("media_list", args, 15),
            },
            Tool {
                name: "media_import",
                description: "Imports a file of this computer (absolute path) or an https URL into the open project's media library; answers with the new media id.",
                looks: false,
                schema: || object(json!({ "path": { "type": "string" }, "url": { "type": "string" } }), &[]),
                call: |_| composite("import"),
            },
            Tool {
                name: "playhead_seek",
                description: "Moves the playhead to a time in seconds (or a frame).",
                looks: false,
                schema: || object(json!({ "seconds": { "type": "number" }, "frame": { "type": "integer" } }), &[]),
                call: |args| window("playhead_seek", args, 15),
            },
            Tool {
                name: "playback",
                description: "Plays or pauses the preview.",
                looks: false,
                schema: || object(json!({ "action": { "type": "string", "enum": ["play", "pause"] } }), &["action"]),
                call: |args| window("playback", args, 15),
            },
            Tool {
                name: "editor_tab",
                description: "Opens a tab of the editor's left sidebar: generate, media, text, shapes, effects, transitions, lottie, transcript, ai.",
                looks: false,
                schema: || object(json!({ "tab": { "type": "string" } }), &["tab"]),
                call: |args| window("editor_tab", args, 15),
            },
            Tool {
                name: "export_video",
                description: "Renders the open project to a video file in the exports folder (data/exports) with the editor's export: format mp4|webm|mov|mkv, quality low|medium|high|ultra, optional width and height. Waits until it is written and answers with the file's path.",
                looks: false,
                schema: || object(json!({
                    "format": { "type": "string", "enum": ["mp4", "webm", "mov", "mkv"] },
                    "quality": { "type": "string", "enum": ["low", "medium", "high", "ultra"] },
                    "width": { "type": "integer" },
                    "height": { "type": "integer" },
                    "file_name": { "type": "string" },
                }), &[]),
                call: |args| window("export_video", args, 3600),
            },
        ]
    })
}

// ---------------------------------------------------------------- the window bridge

struct Bridge {
    commands: tokio::sync::broadcast::Sender<String>,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>,
    windows: Mutex<Vec<u64>>,
    sequence: AtomicU64,
}

fn bridge() -> &'static Bridge {
    static BRIDGE: OnceLock<Bridge> = OnceLock::new();
    BRIDGE.get_or_init(|| Bridge { commands: tokio::sync::broadcast::channel(64).0, pending: Mutex::new(HashMap::new()), windows: Mutex::new(Vec::new()), sequence: AtomicU64::new(0) })
}

fn open_windows() -> std::sync::MutexGuard<'static, Vec<u64>> {
    bridge().windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct Listening(u64);

impl Drop for Listening {
    fn drop(&mut self) {
        open_windows().retain(|window| *window != self.0);
    }
}

/// Only the program's own window and agents on this computer may drive it: a web page in the person's browser
/// sends its own origin and is refused, and so is a page of another server on this computer. A development build
/// also lets the frontend's dev server (another local port) through.
pub fn local_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else { return true };
    let Ok(origin) = origin.to_str() else { return false };
    let Some((scheme, rest)) = origin.split_once("://") else { return false };
    if scheme == "tauri" {
        return true;
    }
    let authority = rest.split('/').next().unwrap_or_default();
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.ends_with(':') && !port.contains(']') => (host, port.parse::<u16>().ok()),
        _ => (authority, None),
    };
    if host == "tauri.localhost" {
        return true;
    }
    if !matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
        return false;
    }
    cfg!(debug_assertions) || port.is_some_and(|port| Some(port) == crate::service::recorded_port())
}

async fn window_events() -> Response {
    let window = bridge().sequence.fetch_add(1, Ordering::Relaxed);
    open_windows().push(window);
    let receiver = bridge().commands.subscribe();
    let hello = futures_util::stream::once(async move { Ok::<Event, Infallible>(Event::default().data(json!({ "window": window }).to_string())) });
    let commands = futures_util::stream::unfold((receiver, Listening(window)), |(mut receiver, listening)| async move {
        loop {
            match receiver.recv().await {
                Ok(command) => return Some((Ok(Event::default().data(command)), (receiver, listening))),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(futures_util::StreamExt::chain(hello, commands)).keep_alive(KeepAlive::default()).into_response()
}

#[derive(serde::Deserialize)]
struct WindowAnswer {
    id: String,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: Option<String>,
}

async fn window_result(Json(answer): Json<WindowAnswer>) -> StatusCode {
    let waiting = bridge().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&answer.id);
    match waiting {
        Some(sender) => {
            let _ = sender.send(match answer.error {
                Some(error) => Err(error),
                None => Ok(answer.result),
            });
            StatusCode::NO_CONTENT
        }
        None => StatusCode::NOT_FOUND,
    }
}

#[derive(serde::Deserialize)]
struct WindowFocus {
    window: u64,
}

async fn window_focus(Json(focus): Json<WindowFocus>) -> StatusCode {
    let mut windows = open_windows();
    let Some(place) = windows.iter().position(|open| *open == focus.window) else { return StatusCode::NOT_FOUND };
    windows.remove(place);
    windows.push(focus.window);
    StatusCode::NO_CONTENT
}

fn window_open() -> bool {
    !open_windows().is_empty()
}

async fn ask_window(command: &str, args: Value, seconds: u64) -> Result<Value, String> {
    let Some(window) = open_windows().last().copied() else {
        return Err("The VideoSOS window is not open. Open VideoSOS and call the tool again; the server tools work without it.".into());
    };
    let id = format!("w{}", bridge().sequence.fetch_add(1, Ordering::Relaxed));
    let (sender, receiver) = tokio::sync::oneshot::channel();
    bridge().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(id.clone(), sender);
    let _ = bridge().commands.send(json!({ "id": id, "window": window, "command": command, "args": args }).to_string());
    match tokio::time::timeout(Duration::from_secs(seconds), receiver).await {
        Ok(Ok(answer)) => answer,
        _ => {
            bridge().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&id);
            Err(format!("The window did not answer '{command}' within {seconds} s."))
        }
    }
}

// ---------------------------------------------------------------- the journal

#[derive(Clone, serde::Serialize)]
struct Entry {
    at: i64,
    tool: String,
    ok: bool,
    summary: String,
}

fn journal() -> std::sync::MutexGuard<'static, VecDeque<Entry>> {
    static JOURNAL: OnceLock<Mutex<VecDeque<Entry>>> = OnceLock::new();
    JOURNAL.get_or_init(|| Mutex::new(VecDeque::new())).lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn record(tool: &str, args: &Value, ok: bool, answer: &str) {
    let mut shown = args.clone();
    if let Some(object) = shown.as_object_mut() {
        object.remove("key");
    }
    let summary: String = format!("{} -> {}", shown, answer.chars().take(160).collect::<String>()).chars().take(400).collect();
    let entry = Entry { at: chrono::Utc::now().timestamp_millis(), tool: tool.to_string(), ok, summary };
    let mut entries = journal();
    entries.push_back(entry.clone());
    while entries.len() > 300 {
        entries.pop_front();
    }
    crate::events::send("agent", serde_json::to_value(entry).unwrap_or_default());
}

/// When an agent last called, for the settings page.
static LAST_CALL: Mutex<Option<(std::time::Instant, String)>> = Mutex::new(None);

fn seen(what: &str) {
    *LAST_CALL.lock().unwrap_or_else(|p| p.into_inner()) = Some((std::time::Instant::now(), what.to_string()));
}

async fn status_route() -> Json<Value> {
    let last = LAST_CALL.lock().unwrap_or_else(|p| p.into_inner()).clone();
    Json(json!({
        "window_open": window_open(),
        "agent_connected": last.as_ref().is_some_and(|(at, _)| at.elapsed() < Duration::from_secs(600)),
        "agent_last_call": last.as_ref().map(|(_, what)| what.clone()),
        "agent_seconds_ago": last.as_ref().map(|(at, _)| at.elapsed().as_secs()),
    }))
}

async fn activity_route() -> Json<Value> {
    Json(json!({ "entries": journal().iter().cloned().collect::<Vec<_>>() }))
}

// ---------------------------------------------------------------- calls

async fn call_route(call: Call) -> Result<(StatusCode, String), String> {
    let api = API.get().ok_or("VideoSOS is still starting")?.clone();
    let builder = Request::builder().method(call.method).uri(&call.path);
    let request = match call.payload {
        Payload::Json(body) if !body.is_null() => builder.header(header::CONTENT_TYPE, "application/json").body(Body::from(body.to_string())),
        _ => builder.body(Body::empty()),
    }
    .map_err(|error| error.to_string())?;
    let response = api.oneshot(request).await.map_err(|error| error.to_string())?;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024 * 1024).await.map_err(|error| error.to_string())?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if text.trim().is_empty() {
        text = if status.is_success() { "Done.".into() } else { status.to_string() };
    }
    Ok((status, text))
}

async fn fetch(path: &str) -> Value {
    match call_route(Call { method: Method::GET, path: path.into(), payload: Payload::None }).await {
        Ok((_, text)) => serde_json::from_str(&text).unwrap_or(Value::String(text)),
        Err(problem) => json!({ "error": problem }),
    }
}

async fn status_summary(state: &AppState) -> Value {
    let catalog = fetch("/api/catalog?q=__none__").await;
    let jobs: Vec<Value> = state.jobs.list(None, 50).into_iter().filter(|job| matches!(job.status.as_str(), "queued" | "sending" | "running")).map(|job| json!({ "id": job.id, "model": job.model, "status": job.status, "progress": job.progress, "project_id": job.project_id })).collect();
    let editor = if window_open() { ask_window("editor_state", json!({}), 5).await.unwrap_or_else(|error| json!({ "error": error })) } else { Value::Null };
    json!({
        "studio": STUDIO,
        "version": crate::service::app_version(),
        "keys": catalog["keys"],
        "catalogues": catalog["providers"],
        "jobs_running": jobs,
        "spend": state.jobs.spend(None),
        "agent_daily_budget_usd": crate::settings::get().agent_daily_budget_usd,
        "window_open": window_open(),
        "editor": editor,
    })
}

async fn wait_for(state: &AppState, args: &Value) -> Result<Value, String> {
    let id = text(args, "job_id")?;
    let seconds = args.get("seconds").and_then(Value::as_u64).unwrap_or(30).clamp(1, 55);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        let job = state.jobs.get(&id).ok_or_else(|| format!("No job {id}; jobs_list names them."))?;
        let ended = matches!(job.status.as_str(), "done" | "failed" | "cancelled");
        if ended || tokio::time::Instant::now() >= deadline {
            let mut value = serde_json::to_value(&job).unwrap_or_default();
            if !ended {
                value["note"] = json!("still running; call job_wait again");
            }
            return Ok(value);
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

fn projects(state: &AppState) -> Value {
    let dir = state.workspace.join("projects");
    let mut list = Vec::new();
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let path = entry.path().join("project.json");
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let Ok(project) = serde_json::from_str::<Value>(&text) else { continue };
        if project.get("deletedAt").is_some_and(|value| !value.is_null()) {
            continue;
        }
        let meta = &project["metadata"];
        let items = project["timeline"]["items"].as_array().map(Vec::len).unwrap_or(0);
        list.push(json!({
            "id": project["id"],
            "name": project["name"],
            "width": meta["width"],
            "height": meta["height"],
            "fps": meta["fps"],
            "clips": items,
            "updated_at": project["updatedAt"],
        }));
    }
    list.sort_by(|a, b| b["updated_at"].as_i64().unwrap_or(0).cmp(&a["updated_at"].as_i64().unwrap_or(0)));
    json!({ "projects": list })
}

fn project(state: &AppState, args: &Value) -> Result<Value, String> {
    let id = text(args, "project_id")?;
    let path = crate::fs_api::resolve(&state.workspace, &format!("projects/{id}/project.json")).map_err(|_| format!("not a project id: {id}"))?;
    let text = std::fs::read_to_string(&path).map_err(|_| format!("No project {id}; projects_list names them."))?;
    let project: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let fps = project["metadata"]["fps"].as_f64().unwrap_or(30.0);
    let timeline = &project["timeline"];
    let items: Vec<Value> = timeline["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| {
            let from = item["from"].as_f64().unwrap_or(0.0);
            let length = item["durationInFrames"].as_f64().unwrap_or(0.0);
            json!({
                "id": item["id"], "type": item["type"], "trackId": item["trackId"], "from": from, "durationInFrames": length,
                "start_s": (from / fps * 100.0).round() / 100.0, "length_s": (length / fps * 100.0).round() / 100.0,
                "mediaId": item["mediaId"], "label": item["label"], "text": item["text"],
            })
        })
        .collect();
    let tracks: Vec<Value> = timeline["tracks"].as_array().into_iter().flatten().map(|track| json!({ "id": track["id"], "name": track["name"], "kind": track["kind"], "order": track["order"], "muted": track["muted"], "visible": track["visible"] })).collect();
    Ok(json!({
        "id": project["id"], "name": project["name"], "canvas": project["metadata"], "tracks": tracks, "items": items,
        "transitions": timeline["transitions"],
    }))
}

async fn import_media(state: &AppState, args: &Value) -> Result<Value, String> {
    let url = if let Some(path) = opt(args, "path") {
        let source = std::path::PathBuf::from(&path);
        if !source.is_file() {
            return Err(format!("No file {path} on this computer."));
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        let name = source.file_name().map(|name| name.to_string_lossy().into_owned()).ok_or("the path has no file name")?;
        let dir = state.data.join("inbox").join(&id);
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        std::fs::copy(&source, dir.join(&name)).map_err(|error| error.to_string())?;
        format!("/api/inbox/{id}/{}", segment(&name))
    } else if let Some(url) = opt(args, "url") {
        url
    } else {
        return Err("Give path (a file on this computer) or url.".into());
    };
    ask_window("media_import", json!({ "url": url }), 300).await
}

// ---------------------------------------------------------------- protocol

const MODERN: &[&str] = &["2026-07-28"];
const LEGACY: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];
const LIST_TTL_MS: u64 = 300_000;

const INSTRUCTIONS: &str = "You drive VideoSOS, a video studio on this computer: it generates images, video, music, speech, sound effects and text through the person's own OpenRouter, fal and Runware keys, keeps the results in a project's media library and edits them on a multitrack timeline that renders to MP4. Start with studio_status. To make something: models_list for a task, model_form for its settings, price_estimate, then generate with project_id of the open project and job_wait. Results land in the project's library (media_list) and, with place_on_timeline, at the playhead; timeline_get and timeline_edit change the open project with undo while the person watches. Generations are paid: say the price before large runs. The whole guide is the resource videosos://skill (prompt 'videosos').";

fn server_info() -> Value {
    json!({ "name": "videosos", "title": STUDIO, "version": crate::service::app_version() })
}

fn rpc(id: Value, result: Value) -> Response {
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
}

fn rpc_error(status: StatusCode, id: Value, code: i64, message: String) -> Response {
    (status, Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))).into_response()
}

fn cacheable(mut result: Value) -> Value {
    result["ttlMs"] = LIST_TTL_MS.into();
    result
}

fn tool_result(id: Value, text: String, structured: Option<Value>, error: bool) -> Response {
    let mut result = json!({ "content": [{ "type": "text", "text": text }], "isError": error });
    if let Some(structured) = structured.filter(|value| value.is_object()) {
        result["structuredContent"] = structured;
    }
    rpc(id, result)
}

fn cut(mut text: String) -> String {
    if text.len() > LIMIT {
        let mut end = LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n... (cut: ask for less, e.g. models_list with a task, provider or query)");
    }
    text
}

fn tool_json(id: Value, value: Value) -> Response {
    let text = serde_json::to_string_pretty(&value).unwrap_or_default();
    if text.len() > LIMIT { tool_result(id, cut(text), None, false) } else { tool_result(id, text, Some(value), false) }
}

fn title(name: &str) -> String {
    let words = name.replace('_', " ");
    let mut letters = words.chars();
    letters.next().map(|first| first.to_uppercase().chain(letters).collect()).unwrap_or_default()
}

fn annotations(tool: &Tool) -> Value {
    json!({ "readOnlyHint": tool.looks, "destructiveHint": matches!(tool.name, "job_delete" | "timeline_edit"), "openWorldHint": tool.name == "generate" })
}

async fn handle(State(state): State<AppState>, body: axum::body::Bytes) -> Response {
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        return rpc_error(StatusCode::BAD_REQUEST, Value::Null, -32700, "Parse error".into());
    };
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return rpc_error(StatusCode::BAD_REQUEST, Value::Null, -32600, "Invalid request: one JSON-RPC request or notification per POST".into());
    };
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if message.get("id").is_none() {
        return StatusCode::ACCEPTED.into_response();
    }
    seen(method);
    match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or_default();
            let protocol = MODERN.iter().chain(LEGACY).find(|version| **version == asked).copied().unwrap_or(LEGACY[0]);
            rpc(id, json!({
                "protocolVersion": protocol,
                "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
                "serverInfo": server_info(),
                "instructions": INSTRUCTIONS,
            }))
        }
        "server/discover" => rpc(id, cacheable(json!({
            "supportedVersions": MODERN.iter().chain(LEGACY).collect::<Vec<_>>(),
            "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
            "serverInfo": server_info(),
            "instructions": INSTRUCTIONS,
        }))),
        "ping" => rpc(id, json!({})),
        "resources/list" => rpc(id, cacheable(json!({ "resources": [{ "uri": SKILL_URI, "name": "videosos skill", "title": "How to drive VideoSOS", "mimeType": "text/markdown" }] }))),
        "resources/templates/list" => rpc(id, cacheable(json!({ "resourceTemplates": [] }))),
        "resources/read" => {
            let uri = params.get("uri").and_then(Value::as_str).unwrap_or_default();
            if uri == SKILL_URI {
                rpc(id, json!({ "contents": [{ "uri": uri, "mimeType": "text/markdown", "text": SKILL }] }))
            } else {
                rpc_error(StatusCode::OK, id, -32002, format!("Resource not found: {uri}"))
            }
        }
        "prompts/list" => rpc(id, cacheable(json!({ "prompts": [{ "name": "videosos", "title": "VideoSOS skill", "description": "Load the guide to VideoSOS: the tools and recipes." }] }))),
        "prompts/get" => match params.get("name").and_then(Value::as_str) {
            Some("videosos") => rpc(id, json!({ "messages": [{ "role": "user", "content": { "type": "text", "text": SKILL } }] })),
            other => rpc_error(StatusCode::OK, id, -32602, format!("Unknown prompt: {}", other.unwrap_or_default())),
        },
        "tools/list" => {
            let list: Vec<Value> = tools().iter().map(|tool| json!({ "name": tool.name, "title": title(tool.name), "description": tool.description, "inputSchema": (tool.schema)(), "annotations": annotations(tool) })).collect();
            rpc(id, cacheable(json!({ "tools": list })))
        }
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
            seen(name);
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let Some(tool) = tools().iter().find(|tool| tool.name == name) else {
                return rpc_error(StatusCode::OK, id, -32602, format!("Unknown tool: {name}; tools/list names them all."));
            };
            let answer = run_tool(&state, tool, &args).await;
            if !tool.looks {
                let (ok, summary) = match &answer {
                    Ok(Answer::Json(value)) => (true, value.to_string()),
                    Ok(Answer::Text(text)) => (true, text.clone()),
                    Ok(Answer::Image { text, .. }) => (true, text.clone()),
                    Err(problem) => (false, problem.clone()),
                };
                record(name, &args, ok, &summary);
            }
            match answer {
                Ok(Answer::Json(value)) => tool_json(id, value),
                Ok(Answer::Text(text)) => tool_result(id, cut(text), None, false),
                Ok(Answer::Image { data, mime, text }) => rpc(id, json!({ "content": [{ "type": "image", "data": data, "mimeType": mime }, { "type": "text", "text": text }], "isError": false })),
                Err(problem) => tool_result(id, problem, None, true),
            }
        }
        _ => rpc_error(StatusCode::NOT_FOUND, id, -32601, format!("Method not found: {method}")),
    }
}

enum Answer {
    Json(Value),
    Text(String),
    Image { data: String, mime: String, text: String },
}

async fn run_tool(state: &AppState, tool: &Tool, args: &Value) -> Result<Answer, String> {
    let call = (tool.call)(args)?;
    match call.payload {
        Payload::Composite("status") => Ok(Answer::Json(status_summary(state).await)),
        Payload::Composite("wait") => wait_for(state, args).await.map(Answer::Json),
        Payload::Composite("projects") => Ok(Answer::Json(projects(state))),
        Payload::Composite("project") => project(state, args).map(Answer::Json),
        Payload::Composite("activity") => Ok(Answer::Json(json!({ "entries": journal().iter().cloned().collect::<Vec<_>>() }))),
        Payload::Composite("import") => import_media(state, args).await.map(Answer::Json),
        Payload::Composite(other) => Err(format!("unknown composite {other}")),
        Payload::Window { command, args, seconds } => {
            let mut result = ask_window(command, args, seconds).await?;
            if command == "export_video"
                && let Some(saved) = result.get("saved").and_then(Value::as_str) {
                    let path = crate::fs_api::resolve(&state.workspace, saved).map_err(|_| format!("the window named an odd file: {saved}"))?;
                    result["path"] = json!(path.display().to_string());
                }
            if let Some(image) = result.get("image").and_then(Value::as_str) {
                return Ok(Answer::Image {
                    data: image.to_string(),
                    mime: result.get("mime").and_then(Value::as_str).unwrap_or("image/jpeg").to_string(),
                    text: result.get("text").and_then(Value::as_str).unwrap_or("The window.").to_string(),
                });
            }
            if let Some(text) = result.get("text").and_then(Value::as_str) {
                return Ok(Answer::Text(text.to_string()));
            }
            Ok(Answer::Json(result))
        }
        Payload::None | Payload::Json(_) => {
            let (status, text) = call_route(call).await?;
            let value = serde_json::from_str::<Value>(&text).ok();
            if status.is_success() {
                Ok(value.map(Answer::Json).unwrap_or(Answer::Text(text)))
            } else {
                Err(value.and_then(|value| value.get("error").and_then(Value::as_str).map(str::to_string)).unwrap_or(text))
            }
        }
    }
}

/// Files an agent handed to the window for import, served once to it.
async fn inbox(State(state): State<AppState>, axum::extract::Path((id, name)): axum::extract::Path<(String, String)>, request: Request<Body>) -> Response {
    let path = match crate::fs_api::resolve(&state.data, &format!("inbox/{id}/{name}")) {
        Ok(path) => path,
        Err(error) => return error.into_response(),
    };
    match crate::fs_api::serve_file(&path, request).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mcp", post(handle))
        .route("/mcp/window", get(window_events))
        .route("/mcp/window/result", post(window_result))
        .route("/mcp/window/focus", post(window_focus))
        .route("/api/agent/status", get(status_route))
        .route("/api/activity", get(activity_route))
        .route("/api/inbox/{id}/{name}", get(inbox))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_names_are_unique_and_schemas_are_objects() {
        let mut names = std::collections::HashSet::new();
        for tool in tools() {
            assert!(names.insert(tool.name), "duplicate tool {}", tool.name);
            assert_eq!((tool.schema)()["type"], "object", "{}", tool.name);
            assert!(!tool.description.is_empty());
        }
    }

    #[test]
    fn only_local_pages_drive_the_program() {
        let mut headers = HeaderMap::new();
        assert!(local_origin(&headers));
        crate::service::record_port(8796);
        headers.insert(header::ORIGIN, "http://127.0.0.1:8796".parse().unwrap());
        assert!(local_origin(&headers));
        headers.insert(header::ORIGIN, "tauri://localhost".parse().unwrap());
        assert!(local_origin(&headers));
        headers.insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        assert!(!local_origin(&headers));
    }
}
