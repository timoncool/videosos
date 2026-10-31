//! The author's studios on this computer, found by their running service and used as local models through their own
//! MCP. The music studios — YuE2 Studio, MiniMax Music3 Studio, ACE-Step Studio — are each a music model whose form is
//! their `song_create` schema; Speech Studio gives a voice-over model for each of its engines on this computer
//! (`engines_list`), voiced by `speak_text` with the engine's own voices and the studio's library. The work is kept in
//! the studio (a song in its library, a Speech project) and its audio comes to VideoSOS as a copy.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{Map, Value, json};
use vs_providers::schema_form::{Skip, fields_of_object};
use vs_providers::{Choice, Field, FieldKind, ModelEntry, ModelForm, Output, Provider, Role, Task};


#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Music,
    Speech,
}

pub struct Studio {
    pub id: &'static str,
    pub name: &'static str,
    port: u16,
    kind: Kind,
}

/// The ports each studio's desktop shell serves on (their `SERVER_PORT` / `studio.json`).
const STUDIOS: &[Studio] = &[
    Studio { id: "yue2-studio", name: "YuE2 Studio", port: 8791, kind: Kind::Music },
    Studio { id: "minimax-music3-studio", name: "MiniMax Music3 Studio", port: 8765, kind: Kind::Music },
    Studio { id: "ace-step-studio", name: "ACE-Step Studio", port: 8792, kind: Kind::Music },
    Studio { id: "speech-studio", name: "Speech Studio", port: 8797, kind: Kind::Speech },
];

/// Speech Studio's engines that are another service's models, which VideoSOS reaches itself.
const SPEECH_CLOUD: &[&str] = &["openrouter", "google", "fal", "runware"];

const PROTOCOL: &str = "2026-07-28";
const ORDER: &[&str] = &["style", "caption", "prompt", "tags", "lyrics", "title", "duration_seconds", "duration", "seed"];
/// Seconds one `speak_text` call waits for its work before VideoSOS looks whether the run was cancelled.
const SPEAK_WAIT: u64 = 5;
/// Rounds of the five-second look between two readings of Speech Studio's engines and voices.
const REFRESH_ROUNDS: u64 = 12;

/// The studios answering now: a music studio with the input schema of its `song_create`, Speech Studio with its
/// `engines` and the names of its library's `voices`.
fn online() -> &'static Mutex<Vec<(&'static str, Value)>> {
    static ONLINE: OnceLock<Mutex<Vec<(&'static str, Value)>>> = OnceLock::new();
    ONLINE.get_or_init(|| Mutex::new(Vec::new()))
}

/// The studio job running for VideoSOS now, to cancel.
fn running() -> &'static Mutex<Option<(&'static str, String)>> {
    static RUNNING: OnceLock<Mutex<Option<(&'static str, String)>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// The studio a model id names: a music studio's own id, or `speech-studio:<engine>`.
pub fn studio(id: &str) -> Option<&'static Studio> {
    let studio = id.split_once(':').map_or(id, |(studio, _)| studio);
    STUDIOS.iter().find(|candidate| candidate.id == studio)
}

fn engine_of(id: &str) -> Option<&str> {
    id.split_once(':').map(|(_, engine)| engine)
}

fn known(id: &str) -> Option<Value> {
    let studio = studio(id)?;
    online().lock().unwrap_or_else(|p| p.into_inner()).iter().find(|(found, _)| *found == studio.id).map(|(_, known)| known.clone())
}

/// What a studio answering now offers: the schema of `song_create`, or Speech Studio's engines and voices. Speech
/// Studio's lists are read again only on `refresh`; between refreshes the last ones stand while it answers.
async fn offer(client: &reqwest::Client, studio: &Studio, last: Option<&Value>, refresh: bool) -> Option<Value> {
    let tools = call(client, studio, "tools/list", None, json!({})).await.ok()?;
    let has = |name: &str| tools["tools"].as_array().and_then(|tools| tools.iter().find(|tool| tool["name"] == name)).map(|tool| tool["inputSchema"].clone());
    match studio.kind {
        Kind::Music => has("song_create"),
        Kind::Speech => {
            has("speak_text")?;
            if let (Some(last), false) = (last, refresh) {
                return Some(last.clone());
            }
            let engines = tool(client, studio, "engines_list", json!({})).await.ok()?;
            let voices = tool(client, studio, "voices_list", json!({ "brief": true })).await.ok()?;
            let Some(library) = voices["voices"].as_array() else {
                static WARNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
                if !WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    tracing::warn!("{}: voices_list answered no list of voices, only the engines' own voices are offered: {}", studio.name, voices.to_string().chars().take(200).collect::<String>());
                }
                return Some(json!({ "engines": engines["engines"], "voices": [] }));
            };
            let names: Vec<Value> = library.iter().filter_map(|voice| voice["name"].as_str()).map(|name| json!(name)).collect();
            Some(json!({ "engines": engines["engines"], "voices": names }))
        }
    }
}

/// Looks for the studios every few seconds, for as long as the server runs; Speech Studio's engines and voices are
/// read when it appears and then once a minute.
pub fn watch() {
    tokio::spawn(async move {
        let Ok(client) = crate::tools::client(Duration::from_secs(10)) else { return };
        let mut round: u64 = 0;
        loop {
            let last = online().lock().unwrap_or_else(|p| p.into_inner()).clone();
            let mut found = Vec::new();
            for studio in STUDIOS {
                let before = last.iter().find(|(id, _)| *id == studio.id).map(|(_, offer)| offer);
                if let Some(offer) = offer(&client, studio, before, round.is_multiple_of(REFRESH_ROUNDS)).await {
                    found.push((studio.id, offer));
                }
            }
            let changed = {
                let mut online = online().lock().unwrap_or_else(|p| p.into_inner());
                let changed = *online != found;
                *online = found;
                changed
            };
            if changed {
                crate::local::changed();
            }
            round += 1;
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
    let response = request.json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })).send().await.map_err(|e| vs_providers::net::why(&e))?;
    let text = response.text().await.map_err(|e| vs_providers::net::why(&e))?;
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

/// Speech Studio's engines that run on this computer and are ready to speak.
fn speech_engines(known: &Value) -> Vec<Value> {
    known["engines"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|engine| engine["unavailable"].is_null() && engine["id"].as_str().is_some_and(|id| !SPEECH_CLOUD.contains(&id)))
        .cloned()
        .collect()
}

pub fn entries() -> Vec<ModelEntry> {
    let online = online().lock().unwrap_or_else(|p| p.into_inner());
    let mut entries = Vec::new();
    for (id, known) in online.iter() {
        let Some(studio) = STUDIOS.iter().find(|studio| studio.id == *id) else { continue };
        match studio.kind {
            Kind::Music => entries.push(entry_of(studio, studio.id.to_string(), studio.name.to_string(), t!("studio-description", studio = studio.name), Task::Music)),
            Kind::Speech => {
                for engine in speech_engines(known) {
                    let (Some(engine_id), Some(engine_name)) = (engine["id"].as_str(), engine["name"].as_str()) else { continue };
                    entries.push(entry_of(
                        studio,
                        format!("{}:{engine_id}", studio.id),
                        format!("{engine_name} · {}", studio.name),
                        t!("speech-studio-description", studio = studio.name, engine = engine_name.to_string()),
                        Task::Speech,
                    ));
                }
            }
        }
    }
    entries
}

pub fn entry(id: &str) -> Option<ModelEntry> {
    entries().into_iter().find(|entry| entry.id == id)
}

fn entry_of(studio: &Studio, id: String, name: String, description: String, task: Task) -> ModelEntry {
    ModelEntry {
        provider: Provider::Local,
        id,
        name,
        description,
        tasks: vec![task],
        created: None,
        status: "live".into(),
        price: Some(t!("local-price")),
        rates: Vec::new(),
        thumbnail: None,
        source: json!({ "studio": studio.id }),
    }
}

/// A model's form: a music studio's `song_create` as it answered last, or the voicing of a Speech Studio engine.
pub fn form(id: &str) -> Result<ModelForm, String> {
    let studio = studio(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    let known = known(id).ok_or_else(|| offline(studio))?;
    let fields = match studio.kind {
        Kind::Music => {
            let order: Vec<String> = ORDER.iter().map(|key| key.to_string()).collect();
            fields_of_object(&known, &known, "", &Skip { keys: &["playlist_id", "client_ref", "cover_of", "semantic_tokens"] }, false, Some(&order))
        }
        Kind::Speech => speech_fields(&known, id)?,
    };
    Ok(ModelForm { provider: Provider::Local, id: id.into(), fields, price: crate::local::free(), delivery: "sync".into(), source: Value::Null })
}

fn offline(studio: &Studio) -> String {
    match studio.kind {
        Kind::Music => t!("studio-offline", studio = studio.name),
        Kind::Speech => t!("speech-studio-offline", studio = studio.name),
    }
}

/// The voicing form of one engine: the text, a voice of the engine's own and, for an engine that clones, of the
/// studio's library; the language among the engine's; how it should sound.
fn speech_fields(known: &Value, id: &str) -> Result<Vec<Field>, String> {
    let engine_id = engine_of(id).unwrap_or_default();
    let engine = speech_engines(known).into_iter().find(|engine| engine["id"] == engine_id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    let field = |key: &str, label: String, kind: FieldKind, role: Option<Role>| Field { key: key.into(), label, description: None, kind, required: false, default: None, advanced: false, role };
    let mut voices: Vec<Choice> = engine["presets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|preset| Some(Choice { value: json!(preset["id"].as_str()?), label: preset["name"].as_str()?.to_string() }))
        .collect();
    if engine["clone"].as_str().is_some_and(|clone| clone != "none") {
        voices.extend(known["voices"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|name| Choice { value: json!(name), label: name.to_string() }));
    }
    let mut fields = vec![Field { required: true, ..field("text", t!("speech-field-text"), FieldKind::Textarea { max_length: None }, Some(Role::Prompt)) }];
    if !voices.is_empty() {
        let default = engine["presets"].as_array().and_then(|presets| presets.first()).map(|_| voices[0].value.clone());
        let required = engine["needs_voice"] == true;
        fields.push(Field { default, required, description: Some(t!("speech-field-voice-hint")), ..field("voice", t!("speech-field-voice"), FieldKind::Select { options: voices }, Some(Role::Voice)) });
    }
    let languages: Vec<Choice> = engine["languages"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|code| Choice { value: json!(code), label: code.to_string() }).collect();
    if !languages.is_empty() {
        let options = std::iter::once(Choice { value: json!("auto"), label: t!("speech-field-language-auto") }).chain(languages).collect();
        fields.push(Field { default: Some(json!("auto")), ..field("lang", t!("speech-field-language"), FieldKind::Select { options }, None) });
    }
    fields.push(Field { description: Some(t!("speech-field-direction-hint")), advanced: true, ..field("direction", t!("speech-field-direction"), FieldKind::Text { max_length: None }, None) });
    fields.push(Field { description: Some(t!("speech-field-seed-hint")), advanced: true, ..field("seed", t!("local-field-seed"), FieldKind::Integer { min: Some(0.0), max: Some(f64::from(u32::MAX)) }, Some(Role::Seed)) });
    Ok(fields)
}

pub fn ready(id: &str) -> Result<(), String> {
    let studio = studio(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    let known = known(id).ok_or_else(|| offline(studio))?;
    match (studio.kind, engine_of(id)) {
        (Kind::Speech, Some(engine)) if !speech_engines(&known).iter().any(|ready| ready["id"] == engine) => {
            Err(t!("speech-studio-engine-off", studio = studio.name, engine = engine.to_string()))
        }
        _ => Ok(()),
    }
}

/// Makes the work in the studio and copies its audio into `out_dir`.
pub async fn run(id: &str, values: &Map<String, Value>, out_dir: &Path, cancelled: &(dyn Fn() -> bool + Sync)) -> Result<Vec<Output>, String> {
    let studio = studio(id).ok_or_else(|| t!("local-unknown", what = id.to_string()))?;
    let arguments: Map<String, Value> = values.iter().filter(|(_, value)| !matches!(value, Value::Null) && value.as_str() != Some("")).map(|(key, value)| (key.clone(), value.clone())).collect();
    let files = match studio.kind {
        Kind::Music => make_song(studio, arguments, cancelled).await?,
        Kind::Speech => vec![speak(studio, engine_of(id).unwrap_or_default(), arguments, cancelled).await?],
    };
    std::fs::create_dir_all(out_dir).map_err(|e| format!("{}: {e}", out_dir.display()))?;
    let mut outputs = Vec::new();
    for audio in files {
        let name = audio.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "audio.flac".into());
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

/// A song made in a music studio: the audio files of its songs.
async fn make_song(studio: &'static Studio, arguments: Map<String, Value>, cancelled: &(dyn Fn() -> bool + Sync)) -> Result<Vec<PathBuf>, String> {
    let client = crate::tools::client(Duration::from_secs(60)).map_err(|e| e.detail)?;
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
    let mut audio = Vec::new();
    for song in songs.iter().collect::<std::collections::BTreeSet<_>>() {
        let files = tool(&client, studio, "library_song_files", json!({ "song_id": song })).await?;
        audio.push(files["audio"].as_str().map(PathBuf::from).ok_or_else(|| t!("studio-no-song", studio = studio.name))?);
    }
    Ok(audio)
}

/// A text voiced by a Speech Studio engine: `speak_text` asked again with the same arguments until its work is done,
/// each call waiting as long as the studio lets it.
async fn speak(studio: &'static Studio, engine: &str, mut arguments: Map<String, Value>, cancelled: &(dyn Fn() -> bool + Sync)) -> Result<PathBuf, String> {
    let client = crate::tools::client(Duration::from_secs(SPEAK_WAIT + 30)).map_err(|e| e.detail)?;
    arguments.insert("engine".into(), json!(engine));
    // the studio keeps a voicing by its arguments: without a seed of its own every run would be the same take
    if !arguments.contains_key("seed") {
        arguments.insert("seed".into(), json!(uuid::Uuid::new_v4().as_u128() as u32));
    }
    arguments.insert("format".into(), json!("flac"));
    arguments.insert("seconds".into(), json!(SPEAK_WAIT));
    let answer = loop {
        let answer = tool(&client, studio, "speak_text", Value::Object(arguments.clone())).await?;
        if answer["done"] == true {
            break answer;
        }
        if let Some(job) = answer["job"]["id"].as_str() {
            *running().lock().unwrap_or_else(|p| p.into_inner()) = Some((studio.id, job.to_string()));
        }
        if cancelled() {
            cancel();
            *running().lock().unwrap_or_else(|p| p.into_inner()) = None;
            return Err(t!("speech-studio-cancelled", studio = studio.name));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    };
    *running().lock().unwrap_or_else(|p| p.into_inner()) = None;
    answer["file"].as_str().map(PathBuf::from).ok_or_else(|| t!("speech-studio-no-file", studio = studio.name))
}

/// Cancels the studio job running for VideoSOS, if any.
pub fn cancel() {
    let Some((id, job_id)) = running().lock().unwrap_or_else(|p| p.into_inner()).clone() else { return };
    let Some(studio) = studio(id) else { return };
    tokio::spawn(async move {
        if let Ok(client) = crate::tools::client(Duration::from_secs(10)) {
            let cancel = match studio.kind {
                Kind::Music => "song_job_cancel",
                Kind::Speech => "job_cancel",
            };
            let _ = tool(&client, studio, cancel, json!({ "job_id": job_id })).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speech_studio() -> Value {
        json!({
            "engines": [
                { "id": "qwen3-tts", "name": "Qwen3-TTS", "clone": "ref_text", "languages": ["en", "ru"], "presets": [{ "id": "vivian", "name": "vivian" }], "unavailable": null },
                { "id": "supertonic", "name": "Supertonic 3", "clone": "none", "languages": ["en"], "presets": [{ "id": "F1", "name": "F1" }], "unavailable": null },
                { "id": "drama3", "name": "Drama 3", "clone": "ref_text", "languages": [], "presets": [], "unavailable": "not downloaded" },
                { "id": "openrouter", "name": "OpenRouter", "clone": "none", "languages": [], "presets": [], "unavailable": null }
            ],
            "voices": ["Anna", "Boris"]
        })
    }

    #[test]
    fn speech_engines_are_the_local_ready_ones() {
        let ids: Vec<String> = speech_engines(&speech_studio()).iter().map(|engine| engine["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, ["qwen3-tts", "supertonic"]);
        assert_eq!(studio("speech-studio:qwen3-tts").map(|studio| studio.id), Some("speech-studio"));
        assert_eq!(engine_of("speech-studio:qwen3-tts"), Some("qwen3-tts"));
    }

    #[test]
    fn a_cloning_engine_offers_the_library_and_one_that_does_not_only_its_own_voices() {
        let voices = |id: &str| -> Vec<Value> {
            let fields = speech_fields(&speech_studio(), id).unwrap();
            match &fields.iter().find(|field| field.key == "voice").unwrap().kind {
                FieldKind::Select { options } => options.iter().map(|choice| choice.value.clone()).collect(),
                other => panic!("{other:?}"),
            }
        };
        assert_eq!(voices("speech-studio:qwen3-tts"), [json!("vivian"), json!("Anna"), json!("Boris")]);
        assert_eq!(voices("speech-studio:supertonic"), [json!("F1")]);
    }
}
