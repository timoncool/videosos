//! The person's settings the server acts on: the spending limit for agents, the statistics choice.
//! Kept in `data/settings.json`; the window reads and writes them through `/api/settings`.

use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use axum::extract::State;
use axum::http::StatusCode;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Settings {
    /// What agents may spend per day through MCP, in USD; none means no limit.
    pub agent_daily_budget_usd: Option<f64>,
    /// An agent's timeline edit waits for the person to accept it, as OpenChatCut proposes its edits.
    pub agent_confirm_edits: bool,
    /// Access from another computer's browser, changed only through `/api/network`.
    pub network: Option<crate::remote::NetworkAccess>,
    /// Where requests to the providers go; changed only through `/api/network/proxy`.
    pub proxy: vs_providers::net::ProxySettings,
}

/// The network setting as kept on disk, read before the service binds its address.
pub fn saved_network(data: &std::path::Path) -> Option<crate::remote::NetworkAccess> {
    let text = std::fs::read_to_string(data.join("settings.json")).ok()?;
    serde_json::from_str::<Settings>(&text).ok()?.network
}

/// The proxy as kept on disk, for the window's own browser, which takes it when it starts.
pub fn saved_proxy(data: &std::path::Path) -> vs_providers::net::ProxySettings {
    std::fs::read_to_string(data.join("settings.json")).ok().and_then(|text| serde_json::from_str::<Settings>(&text).ok()).map(|settings| settings.proxy).unwrap_or_default()
}

/// Changes the kept settings and saves them.
pub fn update(change: impl FnOnce(&mut Settings)) -> Result<(), String> {
    let mut settings = get();
    change(&mut settings);
    save(&settings)
}

static PATH: OnceLock<PathBuf> = OnceLock::new();
static CURRENT: RwLock<Option<Settings>> = RwLock::new(None);

pub fn init(data: &std::path::Path) {
    let path = data.join("settings.json");
    let loaded: Settings = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    let _ = PATH.set(path);
    vs_providers::net::set(loaded.proxy.clone());
    *CURRENT.write().unwrap_or_else(|p| p.into_inner()) = Some(loaded);
}

pub fn get() -> Settings {
    CURRENT.read().unwrap_or_else(|p| p.into_inner()).clone().unwrap_or_default()
}

fn save(settings: &Settings) -> Result<(), String> {
    let path = PATH.get().ok_or("settings are not open")?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let partial = path.with_extension("partial");
    std::fs::write(&partial, text).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, path).map_err(|e| e.to_string())?;
    *CURRENT.write().unwrap_or_else(|p| p.into_inner()) = Some(settings.clone());
    Ok(())
}

async fn read(State(_): State<AppState>) -> Json<Settings> {
    Json(Settings { network: None, proxy: Default::default(), ..get() })
}

/// A window sends the settings it changes; the others stay as kept.
async fn write(State(_): State<AppState>, Json(change): Json<serde_json::Value>) -> Result<Json<Settings>, (StatusCode, String)> {
    let serde_json::Value::Object(change) = change else { return Err((StatusCode::BAD_REQUEST, "the settings are an object".to_string())) };
    let mut merged = serde_json::to_value(get()).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for (key, value) in change {
        merged[key] = value;
    }
    let mut settings: Settings = serde_json::from_value(merged).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    if settings.agent_daily_budget_usd.is_some_and(|budget| !(0.0..=10_000.0).contains(&budget)) {
        return Err((StatusCode::BAD_REQUEST, t!("settings-bad-budget")));
    }
    let kept = get();
    settings.network = kept.network;
    settings.proxy = kept.proxy;
    save(&settings).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    settings.network = None;
    crate::events::send("settings", serde_json::to_value(&settings).unwrap_or_default());
    Ok(Json(settings))
}

/// The proxy settings, and why the saved address cannot be used when it cannot: requests then go straight out,
/// and Settings says so.
async fn read_proxy() -> Json<serde_json::Value> {
    let settings = vs_providers::net::current();
    let mut value = serde_json::to_value(&settings).unwrap_or_default();
    value["problem"] = serde_json::json!(settings.validated().err().map(|error| format!("{error:#}")));
    Json(value)
}

/// Takes effect at once for every request to the providers.
async fn update_proxy(Json(proxy): Json<vs_providers::net::ProxySettings>) -> Result<Json<vs_providers::net::ProxySettings>, (StatusCode, String)> {
    let proxy = proxy.validated().map_err(|error| (StatusCode::BAD_REQUEST, format!("{error:#}")))?;
    vs_providers::net::set(proxy.clone());
    update(|settings| settings.proxy = proxy.clone()).map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, t!("settings-proxy-not-saved", error = error)))?;
    Ok(Json(proxy))
}

async fn test_proxy(Json(proxy): Json<vs_providers::net::ProxySettings>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    vs_providers::net::test(proxy).await.map(Json).map_err(|error| (StatusCode::BAD_REQUEST, format!("{error:#}")))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/settings", axum::routing::get(read).put(write))
        .route("/api/network/proxy", axum::routing::get(read_proxy).put(update_proxy))
        .route("/api/network/proxy/test", axum::routing::post(test_proxy))
}
