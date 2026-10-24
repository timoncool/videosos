//! The journal: what agents changed and what the window told the person, newest first. An agent's change is kept as
//! facts (what was done, to what kind of thing, its name) for the window to put into words of its language; a message
//! the window showed is kept in the words it was shown in.

use std::path::Path;
use std::sync::Mutex;

use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppState;

/// How many of the latest lines are kept, and read.
pub const KEPT: i64 = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Line {
    #[serde(default)]
    pub id: i64,
    /// Seconds since 1970.
    #[serde(default)]
    pub at: i64,
    /// `agent` for a change an agent made, `studio` for a message the window showed.
    pub source: String,
    #[serde(default)]
    pub tone: String,
    #[serde(default)]
    pub verb: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub text: String,
}

pub struct Journal {
    db: Mutex<Connection>,
}

impl Journal {
    pub fn open(data: &Path) -> anyhow::Result<Self> {
        let db = Connection::open(data.join("videosos.db"))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, source TEXT NOT NULL, tone TEXT NOT NULL DEFAULT '',
                verb TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '');",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Writes a line, keeping the latest ones: an older line goes as a new one comes.
    pub fn note(&self, line: &Line) -> anyhow::Result<Line> {
        let at = chrono::Utc::now().timestamp();
        let id = {
            let db = self.db();
            db.execute(
                "INSERT INTO journal (at, source, tone, verb, kind, target, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![at, line.source, line.tone, line.verb, line.kind, line.target, line.text],
            )?;
            let id = db.last_insert_rowid();
            db.execute("DELETE FROM journal WHERE id <= ?1", params![id - KEPT])?;
            id
        };
        changed();
        Ok(Line { id, at, ..line.clone() })
    }

    pub fn read(&self, limit: i64) -> anyhow::Result<Vec<Line>> {
        let db = self.db();
        let mut statement = db.prepare("SELECT id, at, source, tone, verb, kind, target, text FROM journal ORDER BY id DESC LIMIT ?1")?;
        let lines = statement
            .query_map(params![limit], |row| {
                Ok(Line { id: row.get(0)?, at: row.get(1)?, source: row.get(2)?, tone: row.get(3)?, verb: row.get(4)?, kind: row.get(5)?, target: row.get(6)?, text: row.get(7)? })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(lines)
    }

    fn clear(&self) -> anyhow::Result<()> {
        self.db().execute("DELETE FROM journal", [])?;
        changed();
        Ok(())
    }

    fn remove(&self, id: i64) -> anyhow::Result<bool> {
        let gone = self.db().execute("DELETE FROM journal WHERE id = ?1", params![id])? > 0;
        if gone {
            changed();
        }
        Ok(gone)
    }
}

fn changed() {
    crate::events::send("journal", Value::Null);
}

fn failed(error: anyhow::Error) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

async fn read_route(State(state): State<AppState>) -> Result<Json<Vec<Line>>, (StatusCode, String)> {
    state.journal.read(KEPT).map(Json).map_err(failed)
}

async fn write_route(State(state): State<AppState>, Json(line): Json<Line>) -> Result<Json<Line>, (StatusCode, String)> {
    let complete = match line.source.as_str() {
        "agent" => !line.verb.is_empty() && !line.kind.is_empty(),
        "studio" => !line.text.trim().is_empty(),
        _ => false,
    };
    if !complete {
        return Err((StatusCode::BAD_REQUEST, "a journal line is an agent's change (verb and kind) or a window's message (text)".into()));
    }
    state.journal.note(&line).map(Json).map_err(failed)
}

async fn clear_route(State(state): State<AppState>) -> Result<StatusCode, (StatusCode, String)> {
    state.journal.clear().map_err(failed)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_route(State(state): State<AppState>, UrlPath(id): UrlPath<i64>) -> Result<StatusCode, (StatusCode, String)> {
    if !state.journal.remove(id).map_err(failed)? {
        return Err((StatusCode::NOT_FOUND, "no such journal line".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new().route("/api/journal", get(read_route).post(write_route).delete(clear_route)).route("/api/journal/{id}", delete(remove_route))
}
