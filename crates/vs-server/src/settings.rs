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
}

static PATH: OnceLock<PathBuf> = OnceLock::new();
static CURRENT: RwLock<Option<Settings>> = RwLock::new(None);

pub fn init(data: &std::path::Path) {
    let path = data.join("settings.json");
    let loaded = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    let _ = PATH.set(path);
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
    Json(get())
}

async fn write(State(_): State<AppState>, Json(settings): Json<Settings>) -> Result<Json<Settings>, (StatusCode, String)> {
    if settings.agent_daily_budget_usd.is_some_and(|budget| !(0.0..=10_000.0).contains(&budget)) {
        return Err((StatusCode::BAD_REQUEST, t!("settings-bad-budget")));
    }
    save(&settings).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    crate::events::send("settings", serde_json::to_value(&settings).unwrap_or_default());
    Ok(Json(settings))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/settings", axum::routing::get(read).put(write))
}
