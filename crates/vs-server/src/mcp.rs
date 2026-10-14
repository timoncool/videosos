//! VideoSOS as an MCP server: Streamable HTTP, stateless JSON-RPC at `/mcp`.
//!
//! Every server tool is a route of the program's own API, called inside the process through the router the
//! window uses, so an agent does exactly what the window does. Editor tools (the timeline, the media
//! library, the picture of the window) are commands for the open window, which runs them on its live
//! editor with undo, while the person watches. Every tool call that changes something is written to the
//! Activity journal and shown in the window.

use std::collections::HashMap;
use std::convert::Infallible;
use std::path::Path;
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
pub(crate) const SKILL: &str = include_str!("../../../docs/mcp-skill.md");
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
                description: "Starts a generation (paid by the person's key). values are the model_form keys; a field of type media takes a list of files: {\"media\": \"<media id of the library>\"}, {\"job\": \"<job id>\", \"index\": 0} for an earlier result, {\"file\": \"<absolute path on this computer>\"} or an https URL. With project_id the result goes into that project's library when its window is open, and with place_on_timeline onto its timeline: at place_at_seconds, or at the playhead when it is imported; the window shows where it will land while it runs. Returns the jobs; follow them with job_wait. Refused when it would pass the daily limit the person set for agents.",
                looks: false,
                schema: || object(json!({
                    "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] },
                    "model": { "type": "string" },
                    "task": { "type": "string", "description": TASKS },
                    "values": { "type": "object" },
                    "project_id": { "type": "string" },
                    "repeat": { "type": "integer", "minimum": 1, "maximum": 8, "description": "separate runs, each paid" },
                    "place_on_timeline": { "type": "boolean" },
                    "place_at_seconds": { "type": "number", "minimum": 0, "description": "where on the timeline, with place_on_timeline" },
                }), &["provider", "model", "values"]),
                call: |args| send(Method::POST, "/api/jobs".into(), json!({
                    "provider": text(args, "provider")?,
                    "model": text(args, "model")?,
                    "task": args.get("task").cloned().unwrap_or(Value::Null),
                    "values": args.get("values").cloned().unwrap_or(json!({})),
                    "project_id": args.get("project_id").cloned().unwrap_or(Value::Null),
                    "repeat": args.get("repeat").cloned().unwrap_or(json!(1)),
                    "place": args.get("place_on_timeline").cloned().unwrap_or(json!(false)),
                    "place_at": args.get("place_at_seconds").cloned().unwrap_or(Value::Null),
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
                name: "key_set",
                description: "Keeps a provider key the person gave you, as Settings, Providers keeps it; it is never shown back. Check it with key_check.",
                looks: false,
                schema: || object(json!({ "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] }, "key": { "type": "string" } }), &["provider", "key"]),
                call: |args| send(Method::PUT, format!("/api/keys/{}", segment(&text(args, "provider")?)), json!({ "key": text(args, "key")? })),
            },
            Tool {
                name: "key_delete",
                description: "Removes a provider's key from VideoSOS; its models stop running until a key is set again.",
                looks: false,
                schema: || object(json!({ "provider": { "type": "string", "enum": ["openrouter", "fal", "runware"] } }), &["provider"]),
                call: |args| send(Method::PUT, format!("/api/keys/{}", segment(&text(args, "provider")?)), json!({ "key": null })),
            },
            Tool {
                name: "settings_get",
                description: "The person's guards for agents: the daily spending limit (agent_daily_budget_usd, null for none) and whether agents' timeline edits wait for their Accept (agent_confirm_edits). Only the person changes them, in Settings, Agents. The window's own settings are window_settings_get.",
                looks: true,
                schema: nothing,
                call: |_| get_call("/api/settings".into()),
            },
            Tool {
                name: "proxy_get",
                description: "Where requests to the providers and downloads go: mode off (straight), system (as the computer is set) or custom, the proxy kind and its address without the login and password; problem names what is wrong with it.",
                looks: true,
                schema: nothing,
                call: |_| composite("proxy"),
            },
            Tool {
                name: "proxy_set",
                description: "Sets the proxy for the providers and downloads, at once for every request, as Settings, Network does: mode off|system|custom; for custom, kind http|https|socks5|socks4 and address as the person gave it (host:port, a URL with a login, or a seller's host:port:login:password). Try it first with proxy_test.",
                looks: false,
                schema: || object(json!({ "mode": { "type": "string", "enum": ["off", "system", "custom"] }, "kind": { "type": "string", "enum": ["http", "https", "socks5", "socks4"] }, "address": { "type": "string" } }), &["mode"]),
                call: |args| send(Method::PUT, "/api/network/proxy".into(), json!({ "mode": text(args, "mode")?, "kind": opt(args, "kind").unwrap_or_else(|| "http".into()), "address": opt(args, "address") })),
            },
            Tool {
                name: "proxy_test",
                description: "Tries a proxy without keeping it: whether it answers and how the providers are reached through it. Same fields as proxy_set.",
                looks: true,
                schema: || object(json!({ "mode": { "type": "string", "enum": ["off", "system", "custom"] }, "kind": { "type": "string", "enum": ["http", "https", "socks5", "socks4"] }, "address": { "type": "string" } }), &["mode"]),
                call: |args| send(Method::POST, "/api/network/proxy/test".into(), json!({ "mode": text(args, "mode")?, "kind": opt(args, "kind").unwrap_or_else(|| "http".into()), "address": opt(args, "address") })),
            },
            Tool {
                name: "network_status",
                description: "Whether VideoSOS can be opened from another computer's browser (Settings, Network, Access from the network) and on which addresses. Only the person turns it on.",
                looks: true,
                schema: nothing,
                call: |_| get_call("/api/network".into()),
            },
            Tool {
                name: "studio_paths",
                description: "Where VideoSOS keeps its things on this computer: data, projects, generations, exports and logs.",
                looks: true,
                schema: nothing,
                call: |_| get_call("/api/app/paths".into()),
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
                description: "The Activity journal the person reads: what agents changed (verb, kind, target) and what the window told them (text, tone), newest first.",
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
                name: "url_tool_status",
                description: "Whether videos can be downloaded by their links: the link tool (yt-dlp with deno, and ffmpeg) installed or missing, how many bytes it takes, an install running, and yt-dlp's version and update.",
                looks: true,
                schema: nothing,
                call: |_| get_call("/api/url/tool".into()),
            },
            Tool {
                name: "url_tool_install",
                description: "Downloads the link tool (yt-dlp, deno and ffmpeg, pinned and checked by SHA-256; about 230 MB on Windows) in the background; url_tool_status follows it.",
                looks: false,
                schema: nothing,
                call: |_| send(Method::POST, "/api/url/tool/install".into(), json!({})),
            },
            Tool {
                name: "url_tool_update",
                description: "Looks for a newer yt-dlp now (it is also looked for once a day) and installs it beside the working one once it passes its checks.",
                looks: false,
                schema: nothing,
                call: |_| send(Method::POST, "/api/url/tool/update".into(), json!({})),
            },
            Tool {
                name: "url_probe",
                description: "What a video link is before downloading it: title, duration, uploader, the highest height, the qualities worth asking for and the expected size. cookies_path: a cookies.txt on this computer for a site that wants a signed-in user.",
                looks: true,
                schema: || object(json!({ "url": { "type": "string" }, "cookies_path": { "type": "string" } }), &["url"]),
                call: |args| send(Method::POST, "/api/url/probe".into(), args.clone()),
            },
            Tool {
                name: "url_fetch",
                description: "Downloads a video by its link (YouTube and the other sites yt-dlp knows, or a direct file) into a project's media library: the window with that project open imports it. quality: best (default), 1080, 720, 480 or audio. Returns the download; follow it with url_fetches_list.",
                looks: false,
                schema: || object(json!({ "url": { "type": "string" }, "project_id": { "type": "string" }, "quality": { "type": "string", "enum": ["best", "1080", "720", "480", "audio"] }, "cookies_path": { "type": "string" } }), &["url", "project_id"]),
                call: |args| send(Method::POST, "/api/url/fetches".into(), args.clone()),
            },
            Tool {
                name: "url_fetches_list",
                description: "The downloads by link, newest first: status, phase, bytes, speed, the error with a hint, and the media items made of a finished one.",
                looks: true,
                schema: nothing,
                call: |_| get_call("/api/url/fetches".into()),
            },
            Tool {
                name: "url_fetch_cancel",
                description: "Stops a running download by link and removes what it fetched.",
                looks: false,
                schema: || object(json!({ "fetch_id": { "type": "string" } }), &["fetch_id"]),
                call: |args| send(Method::POST, format!("/api/url/fetches/{}/cancel", segment(&text(args, "fetch_id")?)), json!({})),
            },
            Tool {
                name: "url_fetch_delete",
                description: "Forgets a finished, failed or cancelled download by link and removes its files (media already imported into a project stays there).",
                looks: false,
                schema: || object(json!({ "fetch_id": { "type": "string" } }), &["fetch_id"]),
                call: |args| send(Method::DELETE, format!("/api/url/fetches/{}", segment(&text(args, "fetch_id")?)), json!({})),
            },
            Tool {
                name: "url_fetch_resume",
                description: "Goes on with a failed or interrupted download by link from where it stopped.",
                looks: false,
                schema: || object(json!({ "fetch_id": { "type": "string" } }), &["fetch_id"]),
                call: |args| send(Method::POST, format!("/api/url/fetches/{}/resume", segment(&text(args, "fetch_id")?)), json!({})),
            },
            Tool {
                name: "ui_notify",
                description: "Shows the person a short message in the window for a few seconds - what you did, what you need from them - and keeps it in the window's journal. tone: info (default), success or error.",
                looks: false,
                schema: || object(json!({ "text": { "type": "string" }, "tone": { "type": "string", "enum": ["info", "success", "error"] } }), &["text"]),
                call: |args| window("notify", args, 15),
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
                description: "Edits the open project's timeline with the editor's own operations, as one undoable step each. ops is a list of {op, ...}: addClip {mediaId, from, trackId?, keepFrom?} (keepFrom: true lands it at from on a track free there, a new one when none is, instead of after what is in the way); addText {text, from, durationInFrames, fontSize?, color?}; moveItem {id, from, trackId?}; updateItem {id, updates}; removeItems {ids}; split {id, frame}; trimStart {id, amount} (frames; positive cuts the start off, negative brings it back); trimEnd {id, amount} (frames; negative cuts the end off, positive lengthens); addTransition {leftClipId, rightClipId, type?, durationInFrames?}; removeTransition {id}; addTrack {kind: video|audio}; addKeyframe {itemId, property, frame, value, easing?}; addEffect {itemId, effect}; setTransform {id, transform}; addShape {shape: rectangle|circle|triangle|ellipse|star|polygon|heart, from, durationInFrames, trackId?, color?}; updateTrack {id, name?, muted?, solo?, locked?, visible?, volume? (dB, -60..12)}; removeTrack {id} (an empty track); addMarker {frame, label?, color?}; updateMarker {id, frame?, label?, color?}; removeMarker {id}. Frames are of the project's frame rate. An op may name the result of an earlier one with {\"$ref\": \"<callerId>#/detail/created/0\"} when it carries callerId. Before the edit the window keeps a checkpoint of the timeline (checkpoint_list, checkpoint_restore). With dry_run the ops are rehearsed: the answer is what they would make, and the timeline is left as it was. When the person has asked to accept agents' edits (Settings, Agents), the window shows them what will change and the call waits for their answer; a declined edit answers with an error saying so.",
                looks: false,
                schema: || object(json!({ "ops": { "type": "array", "items": { "type": "object" } }, "dry_run": { "type": "boolean" } }), &["ops"]),
                // the person may be asked to accept the edit first
                call: |args| window("timeline_edit", args, 300),
            },
            Tool {
                name: "motion_render",
                description: "Makes HTML and CSS motion graphics (a title, a lower third, a counter, a badge) into a video clip with transparency, as WeftCut's Motifs: html is the body of a page of the project's size with a <style> of CSS animations (no scripts, they do not run); the clip goes into the open project's library and onto the timeline at the playhead. seconds is its length (0.5 to 30, 4 by default). Free: nothing is sent anywhere.",
                looks: false,
                schema: || object(json!({ "html": { "type": "string" }, "seconds": { "type": "number", "minimum": 0.5, "maximum": 30 }, "name": { "type": "string" } }), &["html"]),
                call: |args| window("motion_render", args, 300),
            },
            Tool {
                name: "previs_render",
                description: "Blocks a shot in 3D before a paid generation, as AIMovieStudio's previs: stand-in shapes and figures, their moves and the camera's path over the shot. Give either scene (the JSON below, written by you) or description (words; the prompt model builds the scene, a request of about two cents, changing the project's current blocking when there is one, unless fresh is true). The scene is {version: 1, title, seconds (1-30), easing: smooth|linear, sky: #rrggbb, floor: #rrggbb, objects: [{id, name, shape: box|sphere|cylinder|cone|plane|figure|seated, position: [x,y,z], rotation: [deg,deg,deg], size: [w,h,d], color: #rrggbb, opacity? (0.05-1, for glass and water), moves: [{time, position, rotation}]}], camera: [{time, position, target, lens (mm, 12-200)}]} in metres, Y up, the floor at 0; a figure is a standing person with its position at its feet, rotation [0,180,0] facing -Z; a seated is a person sitting, of the same standing size, its position the floor under its hips; shapes are solid, so nothing opaque between the camera and what it films; the camera's keys start at 0 and end at seconds. output: frame (the camera's picture at time_seconds into the library, to give a video model as its first frame or an image model as its reference), video (the whole shot through the camera as an MP4 into the library, for a video edit model's motion), or scene (only builds it and shows it in the Blocking tab). The answer carries the scene, to change and send again. Rendered in the window: nothing is sent anywhere but the description.",
                looks: false,
                schema: || object(json!({ "scene": { "type": "object" }, "description": { "type": "string" }, "fresh": { "type": "boolean" }, "output": { "type": "string", "enum": ["frame", "video", "scene"] }, "time_seconds": { "type": "number", "minimum": 0 }, "name": { "type": "string" } }), &[]),
                call: |args| window("previs_render", args, 300),
            },
            Tool {
                name: "project_create",
                description: "Makes a new project, as New project does, and opens it in the editor: name, and optionally width and height of the frame (default 1920x1080), fps (default 30) and background #rrggbb. Answers with its id.",
                looks: false,
                schema: || object(json!({ "name": { "type": "string" }, "width": { "type": "integer" }, "height": { "type": "integer" }, "fps": { "type": "number" }, "background": { "type": "string" } }), &["name"]),
                call: |args| window("project_create", args, 60),
            },
            Tool {
                name: "project_update",
                description: "Changes the open project: its name, frame width and height (even numbers), fps or background #rrggbb, as the canvas panel does (one undoable step).",
                looks: false,
                schema: || object(json!({ "name": { "type": "string" }, "width": { "type": "integer" }, "height": { "type": "integer" }, "fps": { "type": "number" }, "background": { "type": "string" } }), &[]),
                call: |args| window("project_update", args, 60),
            },
            Tool {
                name: "project_delete",
                description: "Moves a project to the trash, as the projects page does; projects_trash lists the trash and project_restore brings one back.",
                looks: false,
                schema: || object(json!({ "project_id": { "type": "string" } }), &["project_id"]),
                call: |args| window("project_delete", args, 60),
            },
            Tool {
                name: "projects_trash",
                description: "The projects in the trash, which project_restore can bring back.",
                looks: true,
                schema: nothing,
                call: |args| window("projects_trash", args, 30),
            },
            Tool {
                name: "project_restore",
                description: "Brings a project back from the trash.",
                looks: false,
                schema: || object(json!({ "project_id": { "type": "string" } }), &["project_id"]),
                call: |args| window("project_restore", args, 60),
            },
            Tool {
                name: "project_duplicate",
                description: "Copies a project with its timeline and media; answers with the copy's id.",
                looks: false,
                schema: || object(json!({ "project_id": { "type": "string" } }), &["project_id"]),
                call: |args| window("project_duplicate", args, 120),
            },
            Tool {
                name: "media_delete",
                description: "Removes media from the open project's library, as its Delete does (clips of it on the timeline go with it).",
                looks: false,
                schema: || object(json!({ "ids": { "type": "array", "items": { "type": "string" } } }), &["ids"]),
                call: |args| window("media_delete", args, 60),
            },
            Tool {
                name: "media_frame",
                description: "See what is in a picture or a video of the library: the picture, or the video's frame at at_seconds (default 0), as an image. Use it to check a generation before you use it.",
                looks: true,
                schema: || object(json!({ "media_id": { "type": "string" }, "at_seconds": { "type": "number", "minimum": 0 }, "max_width": { "type": "integer" } }), &["media_id"]),
                call: |args| window("media_frame", args, 60),
            },
            Tool {
                name: "frame_get",
                description: "See the edit: the timeline's frame at at_seconds (the playhead goes there; now when not given), as the preview shows it with every layer, as an image.",
                looks: true,
                schema: || object(json!({ "at_seconds": { "type": "number", "minimum": 0 }, "max_width": { "type": "integer" } }), &[]),
                call: |args| window("frame_get", args, 60),
            },
            Tool {
                name: "frame_save",
                description: "Saves the timeline's frame at at_seconds as a PNG into the library, as the preview's camera button does; answers with its media id (a frame to start a video from, a thumbnail).",
                looks: false,
                schema: || object(json!({ "at_seconds": { "type": "number", "minimum": 0 }, "name": { "type": "string" } }), &[]),
                call: |args| window("frame_save", args, 60),
            },
            Tool {
                name: "media_last_frame",
                description: "Puts a video's last frame into the library as a picture, as Continue from the last frame does, to start the next video on it (its first frame).",
                looks: false,
                schema: || object(json!({ "media_id": { "type": "string" } }), &["media_id"]),
                call: |args| window("media_last_frame", args, 120),
            },
            Tool {
                name: "media_cut",
                description: "Cuts a part of a video of the library into a new video (start_seconds to end_seconds), as Regenerate this part does, to send it to a video edit model and put the new take back over the clip.",
                looks: false,
                schema: || object(json!({ "media_id": { "type": "string" }, "start_seconds": { "type": "number", "minimum": 0 }, "end_seconds": { "type": "number" } }), &["media_id", "start_seconds", "end_seconds"]),
                call: |args| window("media_cut", args, 300),
            },
            Tool {
                name: "transcribe",
                description: "Transcribes the speech of a video or sound of the library on this computer (free; Whisper or Parakeet in the window): words with their times. model: parakeet-tdt-v3, whisper-tiny|base|small|large; language as a code.",
                looks: false,
                schema: || object(json!({ "media_id": { "type": "string" }, "model": { "type": "string" }, "language": { "type": "string" } }), &["media_id"]),
                call: |args| window("transcribe", args, 600),
            },
            Tool {
                name: "transcript_get",
                description: "The transcript of a media item made earlier by transcribe or the Transcript tab.",
                looks: true,
                schema: || object(json!({ "media_id": { "type": "string" } }), &["media_id"]),
                call: |args| window("transcript_get", args, 30),
            },
            Tool {
                name: "captions_add",
                description: "Puts the captions of a media item's speech on the timeline over its clips, as the clip menu's captions do (it transcribes first when needed); clip_ids limits them, replace (default true) replaces earlier ones.",
                looks: false,
                schema: || object(json!({ "media_id": { "type": "string" }, "clip_ids": { "type": "array", "items": { "type": "string" } }, "replace": { "type": "boolean" } }), &["media_id"]),
                call: |args| window("captions_add", args, 600),
            },
            Tool {
                name: "window_settings_get",
                description: "The window's own settings: language, sounds, snapping, waveforms, filmstrips, density, undo history, autosave, the default transcription model and language, caption grouping.",
                looks: true,
                schema: nothing,
                call: |args| window("window_settings_get", args, 15),
            },
            Tool {
                name: "window_settings_set",
                description: "Changes the window's own settings (the names window_settings_get gives, with values of the same type), language (a code it lists), sounds_enabled, sounds_volume (0..1). Keys and the person's guards for agents are not among them.",
                looks: false,
                schema: || json!({ "type": "object" }),
                call: |args| window("window_settings_set", args, 15),
            },
            Tool {
                name: "ui_open_settings",
                description: "Opens the Settings window at a section, to show the person something there: providers, agents, general, timeline, ai, storage, network, privacy, about.",
                looks: false,
                schema: || object(json!({ "section": { "type": "string" } }), &[]),
                call: |args| window("ui_open_settings", args, 15),
            },
            Tool {
                name: "ui_navigate",
                description: "Opens a page of the window: projects, new_project, docs (the help) or changelog. project_open opens a project.",
                looks: false,
                schema: || object(json!({ "page": { "type": "string", "enum": ["projects", "new_project", "docs", "changelog"] } }), &["page"]),
                call: |args| window("ui_navigate", args, 15),
            },
            Tool {
                name: "elements_list",
                description: "The elements: characters, objects and places kept under a name with their pictures. Naming one as @name in a generate prompt sends its pictures to the model's references.",
                looks: true,
                schema: nothing,
                call: |args| window("elements_list", args, 15),
            },
            Tool {
                name: "element_save",
                description: "Keeps an element: a one-word name and pictures of the library (media ids), to name as @name in prompts so the same face or thing comes back shot after shot.",
                looks: false,
                schema: || object(json!({ "name": { "type": "string" }, "media_ids": { "type": "array", "items": { "type": "string" } } }), &["name", "media_ids"]),
                call: |args| window("element_save", args, 15),
            },
            Tool {
                name: "element_delete",
                description: "Forgets an element.",
                looks: false,
                schema: || object(json!({ "name": { "type": "string" } }), &["name"]),
                call: |args| window("element_delete", args, 15),
            },
            Tool {
                name: "presets_list",
                description: "The prompt presets kept under a name and the values of the {{variables}} prompts use.",
                looks: true,
                schema: nothing,
                call: |args| window("presets_list", args, 15),
            },
            Tool {
                name: "preset_save",
                description: "Keeps a prompt under a name, for the person and you to put into any form.",
                looks: false,
                schema: || object(json!({ "name": { "type": "string" }, "text": { "type": "string" } }), &["name", "text"]),
                call: |args| window("preset_save", args, 15),
            },
            Tool {
                name: "preset_delete",
                description: "Forgets a prompt preset.",
                looks: false,
                schema: || object(json!({ "name": { "type": "string" } }), &["name"]),
                call: |args| window("preset_delete", args, 15),
            },
            Tool {
                name: "variables_set",
                description: "Sets what {{variables}} of the window's prompts are filled with: values {name: text}.",
                looks: false,
                schema: || object(json!({ "values": { "type": "object" } }), &["values"]),
                call: |args| window("variables_set", args, 15),
            },
            Tool {
                name: "storyboard_get",
                description: "The open project's storyboard as the Storyboard tab shows it: the script and its shots with the jobs of their frames and clips, and the picture and video models it uses.",
                looks: true,
                schema: nothing,
                call: |args| window("storyboard_get", args, 15),
            },
            Tool {
                name: "storyboard_set",
                description: "Writes the open project's storyboard so the person sees your plan in the Storyboard tab: script, and shots [{prompt, seconds, image_job?, video_job?}] (the jobs of the frame and the clip you generated for it).",
                looks: false,
                schema: || object(json!({ "script": { "type": "string" }, "shots": { "type": "array", "items": { "type": "object" } } }), &[]),
                call: |args| window("storyboard_set", args, 15),
            },
            Tool {
                name: "canvas_get",
                description: "The open project's node canvas (nodes: prompt, media, generate; edges into prompt or media) and the workflow templates canvas_template puts on it.",
                looks: true,
                schema: nothing,
                call: |args| window("canvas_get", args, 15),
            },
            Tool {
                name: "canvas_set",
                description: "Writes the open project's node canvas: graph {nodes, edges} in canvas_get's form (a workflow file's graph); with add it goes beside what is there.",
                looks: false,
                schema: || object(json!({ "graph": { "type": "object" }, "add": { "type": "boolean" } }), &["graph"]),
                call: |args| window("canvas_set", args, 15),
            },
            Tool {
                name: "canvas_template",
                description: "Puts a workflow template on the open project's canvas beside what is there, with the models chosen in the panel and prompts in the window's language; canvas_get lists the templates.",
                looks: false,
                schema: || object(json!({ "template": { "type": "string" } }), &["template"]),
                call: |args| window("canvas_template", args, 15),
            },
            Tool {
                name: "blocking_get",
                description: "The open project's 3D blocking as the Blocking tab holds it: the words and the scene (previs_render builds and changes it).",
                looks: true,
                schema: nothing,
                call: |args| window("blocking_get", args, 15),
            },
            Tool {
                name: "export_fcpxml",
                description: "Writes the open project's timeline as FCPXML for Final Cut, DaVinci Resolve or Premiere into the exports folder; answers with the file's path and the items it could not carry.",
                looks: false,
                schema: nothing,
                call: |args| window("export_fcpxml", args, 120),
            },
            Tool {
                name: "checkpoint_list",
                description: "The checkpoints of a project's timeline, newest first: the timeline as it was before each agent's edit, before each going back, and where one was made on purpose.",
                looks: true,
                schema: || object(json!({ "project_id": { "type": "string" } }), &["project_id"]),
                call: |args| {
                    let project = text(args, "project_id")?;
                    if !project.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                        return Err(format!("{project} is not a project id"));
                    }
                    send(Method::GET, format!("/api/checkpoints/{project}"), Value::Null)
                },
            },
            Tool {
                name: "checkpoint_create",
                description: "Keeps the open project's timeline as a checkpoint to come back to, with a label.",
                looks: false,
                schema: || object(json!({ "label": { "type": "string" } }), &[]),
                call: |args| window("checkpoint_create", args, 30),
            },
            Tool {
                name: "checkpoint_restore",
                description: "Brings the open project's timeline back to a checkpoint (checkpoint_list). The timeline as it was is kept as a checkpoint first, and the step can be undone.",
                looks: false,
                schema: || object(json!({ "id": { "type": "string" } }), &["id"]),
                call: |args| window("checkpoint_restore", args, 30),
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
                description: "Opens a tab of the editor's left sidebar: generate, storyboard, blocking, media, text, graphics, shapes, effects, transitions, lottie, transcript, ai, chat.",
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

/// A command waiting for its answer, with the window it went to.
type Waiting = (u64, tokio::sync::oneshot::Sender<Result<Value, String>>);

struct Bridge {
    commands: tokio::sync::broadcast::Sender<String>,
    pending: Mutex<HashMap<String, Waiting>>,
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
        // a window that went away answers nothing: its commands fail now, not at their timeout
        let mut pending = bridge().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let gone: Vec<String> = pending.iter().filter(|(_, (window, _))| *window == self.0).map(|(id, _)| id.clone()).collect();
        for id in gone {
            if let Some((_, sender)) = pending.remove(&id) {
                let _ = sender.send(Err("The VideoSOS window closed before it answered. Call the tool again: it goes to another open window, or says that none is open.".into()));
            }
        }
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
        Some((_, sender)) => {
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
    bridge().pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(id.clone(), (window, sender));
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

/// What an agent's change goes into the journal as: what was done and to what kind of thing, for the window to put
/// into words of its language. A generation is written as started, since what it makes is not there yet.
const JOURNAL: &[(&str, &str, &str)] = &[
    ("generate", "started", "generation"),
    ("job_retry", "started", "generation"),
    ("job_cancel", "cancelled", "generation"),
    ("job_delete", "deleted", "generation"),
    ("timeline_edit", "updated", "timeline"),
    ("timeline_undo", "undone", "timeline"),
    ("timeline_redo", "redone", "timeline"),
    ("checkpoint_create", "created", "checkpoint"),
    ("motion_render", "imported", "media"),
    ("project_create", "created", "project"),
    ("project_update", "updated", "project"),
    ("project_delete", "deleted", "project"),
    ("project_restore", "restored", "project"),
    ("project_duplicate", "created", "project"),
    ("media_delete", "deleted", "media"),
    ("frame_save", "imported", "media"),
    ("media_last_frame", "imported", "media"),
    ("media_cut", "imported", "media"),
    ("transcribe", "created", "transcript"),
    ("captions_add", "created", "captions"),
    ("window_settings_set", "updated", "settings"),
    ("element_save", "created", "element"),
    ("element_delete", "deleted", "element"),
    ("preset_save", "created", "preset"),
    ("preset_delete", "deleted", "preset"),
    ("variables_set", "updated", "preset"),
    ("storyboard_set", "updated", "storyboard"),
    ("canvas_set", "updated", "canvas"),
    ("canvas_template", "created", "canvas"),
    ("export_fcpxml", "exported", "fcpxml"),
    ("key_set", "updated", "key"),
    ("key_delete", "deleted", "key"),
    ("proxy_set", "updated", "proxy"),
    ("url_fetch_delete", "deleted", "download"),
    ("previs_render", "created", "blocking"),
    ("checkpoint_restore", "restored", "timeline"),
    ("media_import", "imported", "media"),
    ("export_video", "exported", "video"),
    ("url_fetch", "started", "download"),
    ("url_fetch_cancel", "cancelled", "download"),
    ("url_fetch_resume", "started", "download"),
];

/// Tools that change something yet leave no line: the window's own controls and the service's upkeep.
#[cfg(test)]
const UNJOURNALED: &[&str] = &["catalog_refresh", "ui_open_settings", "ui_navigate", "ui_click", "ui_type", "ui_press_key", "ui_scroll", "ui_notify", "url_tool_install", "url_tool_update", "project_open", "playhead_seek", "playback", "editor_tab"];

fn journal_facts(name: &str) -> Option<(&'static str, &'static str)> {
    JOURNAL.iter().find(|(tool, _, _)| *tool == name).map(|(_, verb, kind)| (*verb, *kind))
}

/// The name a job had before the call, for a change that takes it away.
fn job_name_before(state: &AppState, name: &str, args: &Value) -> String {
    if !matches!(name, "job_cancel" | "job_delete") {
        return String::new();
    }
    args.get("job_id").and_then(Value::as_str).and_then(|id| state.jobs.get(id)).map(|job| job.model_name).unwrap_or_default()
}

/// The name a journal line gives what a change touched: the job's model, the file imported or written.
fn change_target(kind: &str, args: &Value, before: &str, answer: &Value) -> String {
    let file_name = |path: &str| Path::new(path).file_name().map_or_else(|| path.to_string(), |name| name.to_string_lossy().into_owned());
    let named = match kind {
        "generation" if !before.is_empty() => Some(before.to_string()),
        "generation" => {
            let jobs = answer.get("jobs").unwrap_or(answer);
            let first = jobs.as_array().and_then(|jobs| jobs.first()).unwrap_or(jobs);
            first.get("model_name").and_then(Value::as_str).or_else(|| args.get("model").and_then(Value::as_str)).map(str::to_string)
        }
        "media" => args.get("path").or_else(|| args.get("url")).and_then(Value::as_str).map(file_name).or_else(|| answer.get("name").and_then(Value::as_str).map(str::to_string)),
        "video" => answer.get("path").and_then(Value::as_str).map(file_name),
        "download" => answer.get("title").and_then(Value::as_str).or_else(|| answer.get("url").and_then(Value::as_str)).or_else(|| args.get("url").and_then(Value::as_str)).map(str::to_string),
        _ => None,
    };
    named.map(|name| name.trim().chars().take(80).collect()).unwrap_or_default()
}

/// Writes an agent's change into the journal, where the person reads it.
fn journal_change(state: &AppState, name: &str, args: &Value, before: &str, answer: &Value) {
    let Some((verb, kind)) = journal_facts(name) else { return };
    // a rehearsal changes nothing
    if name == "timeline_edit" && args.get("dry_run").and_then(Value::as_bool) == Some(true) {
        return;
    }
    let line = crate::journal::Line {
        id: 0,
        at: 0,
        source: "agent".into(),
        tone: String::new(),
        verb: verb.into(),
        kind: kind.into(),
        target: change_target(kind, args, before, answer),
        text: String::new(),
    };
    if let Err(error) = state.journal.note(&line) {
        tracing::error!("the journal did not take an agent's change to {name}: {error}");
    }
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
    let (url, copy) = if let Some(path) = opt(args, "path") {
        let source = std::path::PathBuf::from(&path);
        if !source.is_file() {
            return Err(format!("No file {path} on this computer."));
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        let name = source.file_name().map(|name| name.to_string_lossy().into_owned()).ok_or("the path has no file name")?;
        let dir = state.data.join("inbox").join(&id);
        tokio::fs::create_dir_all(&dir).await.map_err(|error| error.to_string())?;
        tokio::fs::copy(&source, dir.join(&name)).await.map_err(|error| error.to_string())?;
        (format!("/api/inbox/{id}/{}", segment(&name)), Some(dir))
    } else if let Some(url) = opt(args, "url") {
        (url, None)
    } else {
        return Err("Give path (a file on this computer) or url.".into());
    };
    let answer = ask_window("media_import", json!({ "url": url }), 300).await;
    // the window has read the copy into the workspace, or given up on it: either way it is not needed again
    if let Some(dir) = copy
        && let Err(error) = tokio::fs::remove_dir_all(&dir).await
    {
        tracing::warn!("the import copy {} was not removed: {error}", dir.display());
    }
    answer
}

// ---------------------------------------------------------------- protocol

const MODERN: &[&str] = &["2026-07-28"];
const LEGACY: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];
const LIST_TTL_MS: u64 = 300_000;

const INSTRUCTIONS: &str = "You drive VideoSOS, a video studio on this computer: it generates images, video, music, speech, sound effects and text through the person's own OpenRouter, fal and Runware keys, keeps the results in a project's media library and edits them on a multitrack timeline that renders to MP4. Start with studio_status. To make something: models_list for a task, model_form for its settings, price_estimate, then generate with project_id of the open project and job_wait. Results land in the project's library (media_list) and, with place_on_timeline, at the playhead; timeline_get and timeline_edit change the open project with undo while the person watches. Generations are paid: say the price before large runs. The whole guide is the resource videosos://skill (prompt 'videosos').";

/// The proxy as an agent may read it: the login and password the person typed stay with VideoSOS.
fn proxy_without_login() -> Value {
    let settings = vs_providers::net::current();
    let problem = settings.clone().validated().err().map(|error| format!("{error:#}"));
    let mut value = serde_json::to_value(&settings).unwrap_or_default();
    value["address"] = json!(settings.address.as_deref().map(host_and_port));
    value["problem"] = json!(problem);
    value
}

/// `host:port` of a proxy address in any of the forms the person may type.
fn host_and_port(address: &str) -> String {
    let rest = address.split_once("://").map_or(address, |(_, rest)| rest);
    let rest = rest.rsplit_once('@').map_or(rest, |(_, host)| host);
    let rest = rest.trim_end_matches('/');
    let mut parts = rest.split(':');
    match (parts.next(), parts.next()) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        _ => rest.to_string(),
    }
}

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
            let before = job_name_before(&state, name, &args);
            let answer = run_tool(&state, tool, &args).await;
            match &answer {
                Ok(Answer::Json(value)) => journal_change(&state, name, &args, &before, value),
                Ok(Answer::Text(text)) => journal_change(&state, name, &args, &before, &serde_json::from_str(text).unwrap_or(Value::Null)),
                Ok(Answer::Image { .. }) | Err(_) => {}
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

/// The tools for the chat in the window, as OpenAI-style functions: the same ones an agent over MCP has.
pub(crate) fn chat_tools() -> Vec<Value> {
    tools().iter().map(|tool| json!({ "type": "function", "function": { "name": tool.name, "description": tool.description, "parameters": (tool.schema)() } })).collect()
}

/// What the chat's model reads back from a tool, and a picture when the tool answered with one.
pub(crate) struct ChatAnswer {
    pub text: String,
    pub image: Option<String>,
}

/// Runs a tool for the chat in the window as `tools/call` runs one for an agent, journal line included.
pub(crate) async fn chat_call(state: &AppState, name: &str, args: &Value) -> Result<ChatAnswer, String> {
    let tool = tools().iter().find(|tool| tool.name == name).ok_or_else(|| format!("Unknown tool: {name}"))?;
    seen(name);
    let before = job_name_before(state, name, args);
    let answer = run_tool(state, tool, args).await?;
    match &answer {
        Answer::Json(value) => journal_change(state, name, args, &before, value),
        Answer::Text(text) => journal_change(state, name, args, &before, &serde_json::from_str(text).unwrap_or(Value::Null)),
        Answer::Image { .. } => {}
    }
    Ok(match answer {
        Answer::Json(value) => ChatAnswer { text: cut(serde_json::to_string(&value).unwrap_or_default()), image: None },
        Answer::Text(text) => ChatAnswer { text: cut(text), image: None },
        Answer::Image { data, mime, text } => ChatAnswer { text, image: Some(format!("data:{mime};base64,{data}")) },
    })
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
        Payload::Composite("proxy") => Ok(Answer::Json(proxy_without_login())),
        Payload::Composite("activity") => state.journal.read(crate::journal::KEPT).map(|lines| Answer::Json(json!({ "lines": lines }))).map_err(|error| error.to_string()),
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
        .route("/api/inbox/{id}/{name}", get(inbox))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_proxy_is_read_without_its_login() {
        assert_eq!(host_and_port("socks5://user:secret@10.0.0.2:1080"), "10.0.0.2:1080");
        assert_eq!(host_and_port("proxy.example:8000:login:password"), "proxy.example:8000");
        assert_eq!(host_and_port("http://proxy.example:3128/"), "proxy.example:3128");
        assert_eq!(host_and_port("127.0.0.1:9000"), "127.0.0.1:9000");
    }

    #[tokio::test]
    async fn a_command_to_a_window_that_closed_fails_at_once() {
        let window = bridge().sequence.fetch_add(1, Ordering::Relaxed);
        open_windows().push(window);
        let listening = Listening(window);
        let asked = tokio::spawn(ask_window("read_page", json!({}), 300));
        while !bridge().pending.lock().unwrap().values().any(|(to, _)| *to == window) {
            tokio::task::yield_now().await;
        }
        drop(listening);
        let answer = tokio::time::timeout(Duration::from_secs(5), asked).await.expect("an answer before the timeout").unwrap();
        assert!(answer.unwrap_err().contains("closed"));
    }

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
    fn every_change_an_agent_can_make_is_journaled() {
        for tool in tools().iter().filter(|tool| !tool.looks) {
            assert!(
                journal_facts(tool.name).is_some() || UNJOURNALED.contains(&tool.name),
                "{} changes something: give it a journal line or name it among the window's controls",
                tool.name
            );
        }
        for (name, _, _) in JOURNAL {
            assert!(tools().iter().any(|tool| tool.name == *name), "the journal names a tool that is gone: {name}");
        }
    }

    #[test]
    fn a_change_is_named_by_what_it_touched() {
        assert_eq!(change_target("generation", &json!({ "model": "m" }), "", &json!({ "jobs": [{ "model_name": "Kling 2.1" }] })), "Kling 2.1");
        assert_eq!(change_target("generation", &json!({ "model": "openai/sora" }), "", &Value::Null), "openai/sora");
        assert_eq!(change_target("generation", &json!({}), "Veo 3", &Value::Null), "Veo 3");
        assert_eq!(change_target("media", &json!({ "path": "C:/clips/sea shore.mp4" }), "", &Value::Null), "sea shore.mp4");
        assert_eq!(change_target("video", &json!({}), "", &json!({ "path": "/data/exports/cut.mp4" })), "cut.mp4");
        assert_eq!(change_target("timeline", &json!({ "ops": [] }), "", &Value::Null), "");
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
