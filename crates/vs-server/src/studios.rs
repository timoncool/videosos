//! The author's music studios on this computer — YuE2 Studio, MiniMax Music3 Studio, ACE-Step Studio — found by
//! their running service and used as local music models through their own MCP: the form is their `song_create`
//! schema, a song is made and kept in the studio's library, and its audio comes to VideoSOS as a copy.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{Map, Value, json};
use vs_providers::schema_form::{Skip, fields_of_object};
use vs_providers::{ModelEntry, ModelForm, Output, PriceRule, Provider, Task};


pub struct Studio {
    pub id: &'static str,
    pub name: &'static str,
    port: u16,
}

/// The ports each studio's desktop shell serves on (their `SERVER_PORT` / `studio.json`).
const STUDIOS: &[Studio] = &[
    Studio { id: "yue2-studio", name: "YuE2 Studio", port: 8791 },
    Studio { id: "minimax-music3-studio", name: "MiniMax Music3 Studio", port: 8765 },
    Studio { id: "ace-step-studio", name: "ACE-Step Studio", port: 8792 },
];

const PROTOCOL: &str = "2026-07-28";
const ORDER: &[&str] = &["style", "caption", "prompt", "tags", "lyrics", "title", "duration_seconds", "duration", "seed"];

/// The studios answering now, each with the input schema of its `song_create`.
fn online() -> &'static Mutex<Vec<(&'static str, Value)>> {
    static ONLINE: OnceLock<Mutex<Vec<(&'static str, Value)>>> = OnceLock::new();
    ONLINE.get_or_init(|| Mutex::new(Vec::new()))
}

/// The studio job running for VideoSOS now, to cancel.
fn running() -> &'static Mutex<Option<(&'static str, String)>> {
    static RUNNING: OnceLock<Mutex<Option<(&'static str, String)>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(None))
}

pub fn studio(id: &str) -> Option<&'static Studio> {
    STUDIOS.iter().find(|studio| studio.id == id)
}

fn schema_of(id: &str) -> Option<Value> {
    online().lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(studio, _)| *studio == id).map(|(_, schema)| schema.clone())
}

/// Looks for the studios every few seconds, for as long as the server runs.
pub fn watch() {
    tokio::spawn(async move {
        let Ok(client) = crate::tools::client(Duration::from_secs(3)) else { return };
        loop {
            let mut found = Vec::new();
            for studio in STUDIOS {
                if let Ok(tools) = call(&client, studio, "tools/list", None, json!({})).await
                    && let Some(schema) = tools["tools"].as_array().and_then(|tools| tools.iter().find(|tool| tool["name"] == "song_create")).map(|tool| tool["inputSchema"].clone())
                {
                    found.push((studio.id, schema));
                }
            }
            let changed = {
                let mut online = online().lock().unwrap_or_else(|p| p.into_inner());
                let before: Vec<&str> = online.iter().map(|(id, _)| *id).collect();
                let now: Vec<&str> = found.iter().map(|(id, _)| *id).collect();
                *online = found;
                before != now
            };
            if changed {
                crate::local::changed();
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

/// One JSON-RPC request to a studio's MCP, as the studios' stateless revision asks it.
async fn call(client: &reqwest::Client, studio: &Studio, method: &str, name: Option<&str>, params: Value) -> Result<Value, String> {
    let mut request = client
        .post(format!("http://127.0.0.1:{}/mcp", studio.port))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", PROTOCOL)
        .header("Mcp-Method", method);
    if let Some(name) = name {
        request = request.header("Mcp-Name", name);
    }
    let response = request.json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })).send().await.map_err(|e| e.to_string())?;
    let text = response.text().await.map_err(|e| e.to_string())?;
    let body = text.lines().find_map(|line| line.strip_prefix("data:")).map(str::trim).unwrap_or(text.trim());
    let answer: Value = serde_json::from_str(body).map_err(|e| format!("{}: {e}", studio.name))?;
    if let Some(error) = answer.get("error") {
        return Err(format!("{}: {}", studio.name, error["message"].as_str().unwrap_or("error")));
    }
    Ok(answer["result"].clone())
}

/// A studio tool's answer: its structured content, or the text when it gave none.
async fn tool(client: &reqwest::Client, studio: &Studio, name: &str, arguments: Value) -> Result<Value, String> {
    let result = call(client, studio, "tools/call", Some(name), json!({ "name": name, "arguments": arguments })).await?;
    let text = result["content"][0]["text"].as_str().unwrap_or_default().to_string();
    if result["isError"].as_bool() == Some(true) {
        return Err(format!("{}: {text}", studio.name));
    }
    Ok(match result.get("structuredContent") {
        Some(structured) if !structured.is_null() => structured.clone(),
        _ => serde_json::from_str(&text).unwrap_or(Value::String(text)),
    })
}

/// Every studio VideoSOS looks for, and whether it answers now.
pub fn status() -> Vec<Value> {
    let online = online().lock().unwrap_or_else(|p| p.into_inner());
    STUDIOS.iter().map(|studio| json!({ "id": studio.id, "name": studio.name, "running": online.iter().any(|(id, _)| *id == studio.id) })).collect()
}

pub fn entries() -> Vec<ModelEntry> {
    let online = online().lock().unwrap_or_else(|p| p.into_inner());
    STUDIOS.iter().filter(|studio| online.iter().any(|(id, _)| *id == studio.id)).map(entry_of).collect()
}

pub fn entry(id: &str) -> Option<ModelEntry> {
    entries().into_iter().find(|entry| entry.id == id)
}

fn entry_of(studio: &Studio) -> ModelEntry {
    ModelEntry {
        provider: Provider::Local,
        id: studio.id.into(),
        name: studio.name.into(),
        description: t!("studio-description", studio = studio.name),
        tasks: vec![Task::Music],
        created: None,
        status: "live".into(),
        price: Some(t!("local-price")),
        rates: Vec::new(),
        thumbnail: None,
        source: json!({ "studio": true }),
    }
}

/// The form of a studio's `song_create`, as it answered last.
pub fn form(id: &str) -> Result<ModelForm, String> {
    let studio = studio(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    let schema = schema_of(id).ok_or_else(|| t!("studio-offline", studio = studio.name))?;
    let order: Vec<String> = ORDER.iter().map(|key| key.to_string()).collect();
    let fields = fields_of_object(&schema, &schema, "", &Skip { keys: &["playlist_id", "client_ref", "cover_of", "semantic_tokens"] }, false, Some(&order));
    Ok(ModelForm { provider: Provider::Local, id: studio.id.into(), fields, price: PriceRule::default(), delivery: "sync".into(), source: Value::Null })
}

pub fn ready(id: &str) -> Result<(), String> {
    let studio = studio(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    schema_of(id).map(|_| ()).ok_or_else(|| t!("studio-offline", studio = studio.name))
}

/// Makes a song in the studio and copies its audio into `out_dir`.
pub async fn run(id: &str, values: &Map<String, Value>, out_dir: &Path, cancelled: &(dyn Fn() -> bool + Sync)) -> Result<Vec<Output>, String> {
    let studio = studio(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    let client = crate::tools::client(Duration::from_secs(60)).map_err(|e| e.detail)?;
    let arguments: Map<String, Value> = values.iter().filter(|(_, value)| !matches!(value, Value::Null) && value.as_str() != Some("")).map(|(key, value)| (key.clone(), value.clone())).collect();
    let job = tool(&client, studio, "song_create", Value::Object(arguments)).await?;
    let job_id = job["id"].as_str().or_else(|| job["job_id"].as_str()).ok_or_else(|| t!("studio-no-job", studio = studio.name))?.to_string();
    *running().lock().unwrap_or_else(|p| p.into_inner()) = Some((studio.id, job_id.clone()));
    let finished = loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if cancelled() {
            break Err(t!("studio-cancelled", studio = studio.name));
        }
        let job = tool(&client, studio, "song_job_get", json!({ "job_id": job_id, "response_format": "detailed" })).await?;
        match job["status"].as_str() {
            Some("completed") => break Ok(job),
            Some("failed") | Some("cancelled") => break Err(format!("{}: {}", studio.name, job["message"].as_str().unwrap_or_default())),
            _ => {}
        }
    };
    *running().lock().unwrap_or_else(|p| p.into_inner()) = None;
    let job = finished?;
    let songs: Vec<String> = job["songs"].as_array().into_iter().flatten().chain(job.get("song")).filter_map(|song| song["id"].as_str().map(str::to_string)).collect();
    if songs.is_empty() {
        return Err(t!("studio-no-song", studio = studio.name));
    }
    std::fs::create_dir_all(out_dir).map_err(|e| format!("{}: {e}", out_dir.display()))?;
    let mut outputs = Vec::new();
    for song in songs.iter().collect::<std::collections::BTreeSet<_>>() {
        let files = tool(&client, studio, "library_song_files", json!({ "song_id": song })).await?;
        let audio = files["audio"].as_str().map(PathBuf::from).ok_or_else(|| t!("studio-no-song", studio = studio.name))?;
        let name = audio.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| format!("{song}.flac"));
        let copy = out_dir.join(&name);
        std::fs::copy(&audio, &copy).map_err(|e| format!("{}: {e}", audio.display()))?;
        let mime = match audio.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase).as_deref() {
            Some("mp3") => "audio/mpeg",
            Some("wav") => "audio/wav",
            Some("ogg") => "audio/ogg",
            _ => "audio/flac",
        };
        outputs.push(Output::File { path: copy, mime: mime.into() });
    }
    Ok(outputs)
}

/// Cancels the studio job running for VideoSOS, if any.
pub fn cancel() {
    let Some((id, job_id)) = running().lock().unwrap_or_else(|p| p.into_inner()).clone() else { return };
    let Some(studio) = studio(id) else { return };
    tokio::spawn(async move {
        if let Ok(client) = crate::tools::client(Duration::from_secs(10)) {
            let _ = tool(&client, studio, "song_job_cancel", json!({ "job_id": job_id })).await;
        }
    });
}
