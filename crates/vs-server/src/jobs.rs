//! Generation jobs. A job is written to the database before anything is sent; the provider's handle is
//! written before the job is polled; a job that was sent is never sent again — after a restart it is only
//! polled. Finished files are downloaded at once into `data/generations/<job>/` (provider links expire),
//! and every change is an event for the windows.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path as UrlPath, Query, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::Semaphore;
use vs_providers::{fal, openrouter, price, runware, FieldKind, MediaKind, MediaPayload, ModelForm, Output, Polled, Provider, ProviderError, Submitted};

use crate::catalog::{bad, Catalog};
use crate::{credentials, events, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputFile {
    pub index: usize,
    /// `image`, `video`, `audio`, `text`, `file`.
    pub kind: String,
    pub file: String,
    pub mime: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: String,
    pub project_id: Option<String>,
    pub provider: Provider,
    pub model: String,
    pub model_name: String,
    /// What its results are called: the prompt's first words, or the model.
    pub title: String,
    pub task: String,
    pub values: Value,
    /// `queued`, `sending`, `running`, `done`, `failed`, `cancelled`.
    pub status: String,
    pub progress: Option<f64>,
    pub error: Option<String>,
    /// What kind of failure it was, for the window to put into words; `error` keeps what was said.
    pub error_code: Option<String>,
    pub estimate: Option<f64>,
    pub cost: Option<f64>,
    /// `provider` when the provider reported it, `estimate` when it is the price worked out before.
    pub cost_source: Option<String>,
    pub outputs: Vec<OutputFile>,
    pub imported: Value,
    /// The results go onto the open project's timeline once imported.
    pub place: bool,
    /// Where on the timeline, in seconds, as it was when the run was asked for; none means the playhead at import.
    pub place_at: Option<f64>,
    /// The person liked its result: the best take of its request, shown first when the history is sorted so.
    pub liked: bool,
    pub origin: String,
    pub created: i64,
    pub updated: i64,
    #[serde(skip)]
    pub handle: Option<Value>,
}

pub struct Jobs {
    db: Mutex<Connection>,
    dir: PathBuf,
    workspace: PathBuf,
    http: vs_providers::http::Http,
    catalog: Arc<Catalog>,
    limits: HashMap<Provider, Arc<Semaphore>>,
    cancelled: Mutex<HashSet<String>>,
}

/// The kind of a provider's refusal, as the window words it.
fn code_of(error: &ProviderError) -> &'static str {
    match error {
        ProviderError::Refused(_) => "refused",
        ProviderError::Busy(_) => "busy",
        ProviderError::NoKey(_) => "no_key",
        ProviderError::Network(_) => "network",
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

const COLUMNS: &str = "id, project_id, provider, model, model_name, task, values_json, status, progress, error, estimate, cost, cost_source, outputs, imported, origin, created, updated, handle, place, error_code, place_at, liked";

fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<Job> {
    let parse = |text: Option<String>| text.and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let mut job = Job {
        id: row.get(0)?,
        project_id: row.get(1)?,
        provider: Provider::parse(&row.get::<_, String>(2)?).unwrap_or(Provider::Runware),
        model: row.get(3)?,
        model_name: row.get(4)?,
        title: String::new(),
        task: row.get(5)?,
        values: parse(row.get(6)?).unwrap_or(Value::Null),
        status: row.get(7)?,
        progress: row.get(8)?,
        error: row.get(9)?,
        estimate: row.get(10)?,
        cost: row.get(11)?,
        cost_source: row.get(12)?,
        outputs: parse(row.get(13)?).and_then(|value| serde_json::from_value(value).ok()).unwrap_or_default(),
        imported: parse(row.get(14)?).unwrap_or(json!([])),
        origin: row.get(15)?,
        created: row.get(16)?,
        updated: row.get(17)?,
        handle: parse(row.get(18)?),
        place: row.get::<_, i64>(19)? != 0,
        error_code: row.get(20)?,
        place_at: row.get(21)?,
        liked: row.get::<_, i64>(22)? != 0,
    };
    job.title = crate::title::result_title(&job.values, &job.model_name);
    Ok(job)
}

/// How a job's request names a file: a media item of the workspace, a file of an earlier job, a file
/// on this computer (from an agent), or a link the provider can read itself.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum MediaRef {
    Media { media: String },
    Job { job: String, #[serde(default)] index: usize },
    File { file: String },
    Link(String),
}

impl Jobs {
    pub fn open(data: &Path, workspace: &Path, http: vs_providers::http::Http, catalog: Arc<Catalog>) -> anyhow::Result<Arc<Self>> {
        let dir = data.join("generations");
        std::fs::create_dir_all(&dir)?;
        let db = Connection::open(data.join("videosos.db"))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, project_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, model_name TEXT NOT NULL,
                task TEXT NOT NULL, values_json TEXT NOT NULL, status TEXT NOT NULL, progress REAL, error TEXT,
                estimate REAL, cost REAL, cost_source TEXT, outputs TEXT, imported TEXT, origin TEXT NOT NULL,
                created INTEGER NOT NULL, updated INTEGER NOT NULL, handle TEXT, place INTEGER NOT NULL DEFAULT 0, error_code TEXT, place_at REAL, liked INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created);",
        )?;
        let columns: Vec<String> = db.prepare("PRAGMA table_info(jobs)")?.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<_>>()?;
        if !columns.iter().any(|column| column == "place") {
            db.execute_batch("ALTER TABLE jobs ADD COLUMN place INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !columns.iter().any(|column| column == "error_code") {
            db.execute_batch("ALTER TABLE jobs ADD COLUMN error_code TEXT;")?;
        }
        if !columns.iter().any(|column| column == "place_at") {
            db.execute_batch("ALTER TABLE jobs ADD COLUMN place_at REAL;")?;
        }
        if !columns.iter().any(|column| column == "liked") {
            db.execute_batch("ALTER TABLE jobs ADD COLUMN liked INTEGER NOT NULL DEFAULT 0;")?;
        }
        let limits = HashMap::from([
            (Provider::Fal, Arc::new(Semaphore::new(2))),
            (Provider::Runware, Arc::new(Semaphore::new(3))),
            (Provider::Openrouter, Arc::new(Semaphore::new(4))),
            // one model on this computer's card at a time
            (Provider::Local, Arc::new(Semaphore::new(1))),
        ]);
        Ok(Arc::new(Self { db: Mutex::new(db), dir, workspace: workspace.to_path_buf(), http, catalog, limits, cancelled: Mutex::new(HashSet::new()) }))
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.db().query_row(&format!("SELECT {COLUMNS} FROM jobs WHERE id = ?1"), params![id], row_to_job).optional().ok().flatten()
    }

    pub fn list(&self, project: Option<&str>, limit: usize) -> Vec<Job> {
        let db = self.db();
        let result = match project {
            Some(project) => db
                .prepare(&format!("SELECT {COLUMNS} FROM jobs WHERE project_id = ?1 ORDER BY created DESC LIMIT ?2"))
                .and_then(|mut statement| statement.query_map(params![project, limit as i64], row_to_job)?.collect::<rusqlite::Result<Vec<_>>>()),
            None => db
                .prepare(&format!("SELECT {COLUMNS} FROM jobs ORDER BY created DESC LIMIT ?1"))
                .and_then(|mut statement| statement.query_map(params![limit as i64], row_to_job)?.collect::<rusqlite::Result<Vec<_>>>()),
        };
        result.unwrap_or_default()
    }

    /// Reads, changes and writes the job under one hold of the database, so two updates never lose each other.
    fn update(&self, id: &str, change: impl FnOnce(&mut Job)) -> Option<Job> {
        let db = self.db();
        let mut job = db.query_row(&format!("SELECT {COLUMNS} FROM jobs WHERE id = ?1"), params![id], row_to_job).optional().ok().flatten()?;
        let before = job.updated;
        change(&mut job);
        job.updated = now_ms().max(before + 1);
        let saved = db.execute(
            "UPDATE jobs SET status=?2, progress=?3, error=?4, estimate=?5, cost=?6, cost_source=?7, outputs=?8, imported=?9, updated=?10, handle=?11, error_code=?12, liked=?13 WHERE id=?1",
            params![
                id,
                job.status,
                job.progress,
                job.error,
                job.estimate,
                job.cost,
                job.cost_source,
                serde_json::to_string(&job.outputs).unwrap_or_default(),
                job.imported.to_string(),
                job.updated,
                job.handle.as_ref().map(Value::to_string),
                job.error_code,
                i64::from(job.liked),
            ],
        );
        drop(db);
        if let Err(error) = saved {
            tracing::error!("[ERROR] job {id} was not saved: {error}");
        }
        events::send("job", serde_json::to_value(&job).unwrap_or(Value::Null));
        Some(job)
    }

    /// Likes or unlikes a job's result.
    pub fn set_liked(&self, id: &str, liked: bool) -> Option<Job> {
        self.update(id, |job| job.liked = liked)
    }

    fn insert(&self, job: &Job) -> rusqlite::Result<()> {
        self.db().execute(
            &format!("INSERT INTO jobs ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)"),
            params![
                job.id,
                job.project_id,
                job.provider.as_str(),
                job.model,
                job.model_name,
                job.task,
                job.values.to_string(),
                job.status,
                job.progress,
                job.error,
                job.estimate,
                job.cost,
                job.cost_source,
                "[]",
                "[]",
                job.origin,
                job.created,
                job.updated,
                Option::<String>::None,
                i64::from(job.place),
                job.error_code,
                job.place_at,
                i64::from(job.liked),
            ],
        )?;
        Ok(())
    }

    fn remove(&self, id: &str) {
        let _ = self.db().execute("DELETE FROM jobs WHERE id = ?1", params![id]);
        let _ = std::fs::remove_dir_all(self.dir.join(id));
    }

    pub fn file_path(&self, id: &str, index: usize) -> Option<PathBuf> {
        let job = self.get(id)?;
        let output = job.outputs.iter().find(|output| output.index == index)?;
        Some(self.dir.join(id).join(&output.file))
    }

    /// Jobs left running by the last run: sent ones are polled, unsent ones start, half-sent ones end with
    /// the reason rather than being sent a second time.
    pub fn resume(self: &Arc<Self>) {
        let pending: Vec<Job> = {
            let db = self.db();
            db.prepare(&format!("SELECT {COLUMNS} FROM jobs WHERE status IN ('queued', 'sending', 'running')"))
                .and_then(|mut statement| statement.query_map([], row_to_job)?.collect::<rusqlite::Result<Vec<_>>>())
                .unwrap_or_default()
        };
        for job in pending {
            let jobs = self.clone();
            match (job.status.as_str(), &job.handle) {
                ("queued", _) => {
                    tokio::spawn(async move { jobs.run(job.id).await });
                }
                (_, Some(_)) => {
                    tokio::spawn(async move { jobs.follow(job.id).await });
                }
                _ => {
                    self.update(&job.id, |job| {
                        job.status = "failed".into();
                        job.error = Some(t!("jobs-interrupted-sending"));
                        job.error_code = Some("interrupted".into());
                    });
                }
            }
        }
    }

    pub fn create(self: &Arc<Self>, mut request: CreateRequest, form: &ModelForm, model_name: String) -> Vec<Job> {
        request.values = with_defaults(form, request.values);
        let estimate = price::estimate(form, &request.values).map(|estimate| estimate.usd);
        let mut created = Vec::new();
        for _ in 0..request.repeat.clamp(1, 8) {
            let now = now_ms();
            let job = Job {
                id: uuid::Uuid::now_v7().simple().to_string(),
                project_id: request.project_id.clone(),
                provider: form.provider,
                model: form.id.clone(),
                model_name: model_name.clone(),
                title: crate::title::result_title(&Value::Object(request.values.clone()), &model_name),
                task: request.task.clone().unwrap_or_default(),
                values: Value::Object(request.values.clone()),
                status: "queued".into(),
                progress: None,
                error: None,
                error_code: None,
                estimate,
                cost: None,
                cost_source: None,
                outputs: Vec::new(),
                imported: json!([]),
                place: request.place,
                place_at: request.place.then_some(request.place_at).flatten(),
                liked: false,
                origin: request.origin.clone().unwrap_or_else(|| "window".into()),
                created: now,
                updated: now,
                handle: None,
            };
            if let Err(error) = self.insert(&job) {
                tracing::error!("[ERROR] job not recorded: {error}");
                continue;
            }
            events::send("job", serde_json::to_value(&job).unwrap_or(Value::Null));
            let jobs = self.clone();
            let id = job.id.clone();
            tokio::spawn(async move { jobs.run(id).await });
            created.push(job);
        }
        created
    }

    /// The job ended: it no longer needs to be remembered as cancelled.
    fn forget_cancel(&self, id: &str) -> bool {
        self.cancelled.lock().unwrap_or_else(|p| p.into_inner()).remove(id)
    }

    fn fail(&self, id: &str, code: &'static str, message: String) {
        if self.forget_cancel(id) {
            return;
        }
        tracing::warn!("[ERROR] job {id}: {message}");
        let ended = self.update(id, |job| {
            job.status = "failed".into();
            job.error = Some(message);
            job.error_code = Some(code.into());
        });
        if let Some(job) = ended {
            crate::hub::job_ended(&job);
        }
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled.lock().unwrap_or_else(|p| p.into_inner()).contains(id)
    }

    async fn run(self: Arc<Self>, id: String) {
        let Some(job) = self.get(&id) else { return };
        let permit = self.limits[&job.provider].clone().acquire_owned().await;
        if self.is_cancelled(&id) {
            return;
        }
        if job.provider == Provider::Local {
            drop(permit);
            return self.run_local(id, job).await;
        }
        let Some((key, _)) = credentials::key(job.provider) else {
            return self.fail(&id, "no_key", t!("jobs-no-key", provider = job.provider.as_str()));
        };
        let form = match self.catalog.form(job.provider, &job.model).await {
            Ok(form) => form,
            Err(error) => return self.fail(&id, "catalog", error),
        };
        let values = match self.prepare(&key, &form, job.values.as_object().cloned().unwrap_or_default()).await {
            Ok(values) => values,
            Err(error) => return self.fail(&id, "invalid", error),
        };
        // the last moment a cancel keeps the job from being sent and paid for
        if self.is_cancelled(&id) {
            return;
        }
        let what = if job.task.is_empty() { "generation".to_string() } else { job.task.clone() };
        let prompt_chars = values.values().filter_map(Value::as_str).filter(|text| !text.starts_with("data:")).map(|text| text.chars().count()).sum();
        crate::request_log::asked(&what, &job.model, prompt_chars);
        let started = std::time::Instant::now();
        let submitted = match job.provider {
            Provider::Runware => {
                let task_uuid = uuid::Uuid::new_v4().to_string();
                let task = runware::build_task(&form.id, &form, &values, &task_uuid);
                let task = match self.catalog.runware_schema(&form.id) {
                    Some(schema) => match runware::pick_valid(&schema, task, runware::default_size(&form).as_deref()) {
                        Ok(task) => task,
                        Err(error) => return self.fail(&id, "invalid", error.to_string()),
                    },
                    None => task,
                };
                let handle = json!({ "taskUUID": task_uuid, "taskType": task["taskType"], "results": task.get("numberResults").and_then(Value::as_u64).unwrap_or(1) });
                self.sending(&id, Some(handle));
                runware::submit(&self.http, &key, task).await
            }
            Provider::Fal => {
                self.sending(&id, None);
                fal::submit(&self.http, &key, &form.id, fal::build_input(&values)).await
            }
            Provider::Openrouter => {
                self.sending(&id, None);
                openrouter::submit(&self.http, &key, &form, &values).await
            }
            Provider::Local => return,
        };
        drop(permit);
        match &submitted {
            Ok(_) => crate::request_log::answered(&what, &job.model, 200, started.elapsed().as_secs_f64(), 0),
            Err(error) => crate::request_log::failed(&what, &job.model, &error.to_string()),
        }
        match submitted {
            Ok(Submitted::Done { outputs, cost }) => self.finish(&id, outputs, cost).await,
            Ok(Submitted::Pending { handle }) => {
                let cancelled = self.is_cancelled(&id);
                self.update(&id, |job| {
                    if job.status != "cancelled" {
                        job.status = "running".into();
                    }
                    job.handle = Some(handle.clone());
                });
                if cancelled {
                    // cancelled while it was being sent: fal can still stop it now that it has an address
                    if job.provider == Provider::Fal {
                        match fal::cancel(&self.http, &key, &handle).await {
                            Ok(()) => {
                                self.update(&id, |job| job.error = Some(t!("jobs-cancelled")));
                            }
                            Err(error) => tracing::warn!("job {id}: fal did not take the cancel: {error}"),
                        }
                    }
                    return;
                }
                self.follow(id).await;
            }
            // no answer to the send: Runware may have the task, and polling the same task id never pays twice
            Err(ProviderError::Network(reason)) if job.provider == Provider::Runware => {
                tracing::warn!("job {id}: no answer to the send ({reason}); polling the same task");
                self.update(&id, |job| {
                    if job.status != "cancelled" {
                        job.status = "running".into();
                    }
                });
                self.follow(id).await;
            }
            Err(ProviderError::Busy(message)) => self.fail(&id, "busy", t!("jobs-busy", reason = message)),
            Err(error) => self.fail(&id, code_of(&error), error.to_string()),
        }
    }

    /// The job is on its way to the provider; a cancel that came first stays.
    /// A run on this computer: the model is loaded (once) and run off the runtime, its steps are the job's
    /// progress, and the made file is moved into the job's folder.
    async fn run_local(self: Arc<Self>, id: String, job: Job) {
        let permit = self.limits[&Provider::Local].clone().acquire_owned().await;
        if self.is_cancelled(&id) {
            return;
        }
        let form = match crate::local::form(&job.model) {
            Ok(form) => form,
            Err(error) => return self.fail(&id, "catalog", error),
        };
        let values = match self.prepare("", &form, job.values.as_object().cloned().unwrap_or_default()).await {
            Ok(values) => values,
            Err(error) => return self.fail(&id, "invalid", error),
        };
        let data = self.dir.parent().map(Path::to_path_buf).unwrap_or_else(|| self.dir.clone());
        let studio = crate::studios::studio(&job.model).is_some();
        let ready = if studio { crate::studios::ready(&job.model) } else { crate::local::ready(&data, &job.model) };
        if let Err(reason) = ready {
            return self.fail(&id, "local_missing", reason);
        }
        self.update(&id, |job| {
            if job.status != "cancelled" {
                job.status = "running".into();
                job.progress = Some(0.0);
            }
        });
        let what = if job.task.is_empty() { "generation".to_string() } else { job.task.clone() };
        crate::request_log::asked(&what, &job.model, 0);
        let started = std::time::Instant::now();
        // the studio counts its own songs; a video made here on the card measures the card
        let measured = if !studio && crate::local::on_card(&data) { crate::local::video_seconds(&job.model, &values) } else { None };
        let preset = values.get("preset").and_then(Value::as_str).map(str::to_string);
        let out_dir = self.dir.join(&id).join("_local");
        let jobs = self.clone();
        let (model, job_id) = (job.model.clone(), id.clone());
        let made = if studio {
            // one video card: the picture or video model loaded here makes room for the studio's
            crate::local::unload();
            let cancelled = || jobs.is_cancelled(&job_id);
            crate::studios::run(&model, &values, &out_dir, &cancelled).await
        } else {
            tokio::task::spawn_blocking(move || {
            let last = Mutex::new(std::time::Instant::now());
            let progress = |fraction: f64| {
                let mut last = last.lock().unwrap_or_else(|p| p.into_inner());
                if last.elapsed() > Duration::from_millis(400) || fraction >= 0.95 {
                    *last = std::time::Instant::now();
                    jobs.update(&job_id, |job| job.progress = Some(fraction));
                }
            };
            crate::local::run(&data, &model, &values, &out_dir, &progress)
            })
            .await
            .unwrap_or_else(|panic| Err(panic.to_string()))
        };
        drop(permit);
        if self.is_cancelled(&id) {
            self.forget_cancel(&id);
            return;
        }
        match made {
            Ok(outputs) => {
                crate::request_log::answered(&what, &job.model, 200, started.elapsed().as_secs_f64(), 0);
                if let Some(seconds) = measured {
                    crate::hub::worked("video", seconds, started.elapsed());
                }
                if !studio {
                    crate::hub::used_models(&job.model, &crate::local::components(&job.model, preset.as_deref()));
                }
                self.finish(&id, outputs, Some(0.0)).await;
                let _ = std::fs::remove_dir_all(self.dir.join(&id).join("_local"));
            }
            Err(error) => {
                crate::request_log::failed(&what, &job.model, &error);
                self.fail(&id, "local_failed", error);
            }
        }
    }

    fn sending(&self, id: &str, handle: Option<Value>) {
        self.update(id, |job| {
            if job.status != "cancelled" {
                job.status = "sending".into();
            }
            if handle.is_some() {
                job.handle = handle;
            }
        });
    }

    /// Files of the request read from disk and handed to the provider the way it reads them.
    async fn prepare(&self, key: &str, form: &ModelForm, mut values: Map<String, Value>) -> Result<Map<String, Value>, String> {
        for field in &form.fields {
            let FieldKind::Media { list, max, .. } = &field.kind else { continue };
            let Some(raw) = values.remove(&field.key) else { continue };
            let refs: Vec<Value> = match raw {
                Value::Array(items) => items,
                Value::Null => Vec::new(),
                single => vec![single],
            };
            if refs.len() > *max as usize {
                return Err(t!("jobs-too-many-files", field = field.label.clone(), max = *max as i64));
            }
            let mut sent = Vec::new();
            for item in refs {
                let reference: MediaRef = serde_json::from_value(item).map_err(|e| e.to_string())?;
                let address = match reference {
                    MediaRef::Link(link) if link.starts_with("http") || link.starts_with("data:") => link,
                    other => {
                        let payload = self.read_media(other)?;
                        match form.provider {
                            Provider::Runware => runware::upload(&self.http, key, &payload).await.map_err(|e| e.to_string())?,
                            Provider::Fal => fal::upload(&self.http, key, &payload).await.map_err(|e| e.to_string())?,
                            Provider::Openrouter | Provider::Local => openrouter::upload(&payload),
                        }
                    }
                };
                sent.push(Value::String(address));
            }
            if sent.is_empty() {
                continue;
            }
            let value = if *list { Value::Array(sent) } else { sent.into_iter().next().unwrap_or(Value::Null) };
            values.insert(field.key.clone(), value);
        }
        Ok(values)
    }

    /// The file on this computer a request names the way a job's request names files.
    pub(crate) fn media_file(&self, reference: Value) -> Result<PathBuf, String> {
        let reference: MediaRef = serde_json::from_value(reference).map_err(|e| e.to_string())?;
        self.media_path(reference)
    }

    fn read_media(&self, reference: MediaRef) -> Result<MediaPayload, String> {
        let path = self.media_path(reference)?;
        let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let mime = mime_guess::from_path(&path).first_or_octet_stream().essence_str().to_string();
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
        Ok(MediaPayload { bytes, mime, name })
    }

    fn media_path(&self, reference: MediaRef) -> Result<PathBuf, String> {
        Ok(match reference {
            MediaRef::Media { media } => {
                let dir = crate::fs_api::resolve(&self.workspace, &format!("media/{media}")).map_err(|_| t!("jobs-bad-media", media = media.clone()))?;
                let skip = ["metadata.json", "thumbnail.jpg", "thumbnail.meta.json", "source.link.json"];
                let found = std::fs::read_dir(&dir).ok().and_then(|entries| {
                    entries.flatten().map(|entry| entry.path()).find(|path| path.is_file() && path.file_name().is_some_and(|name| !skip.contains(&name.to_string_lossy().as_ref())))
                });
                found.ok_or_else(|| t!("jobs-media-not-in-workspace", media = media))?
            }
            MediaRef::Job { job, index } => self.file_path(&job, index).ok_or_else(|| t!("jobs-no-such-output", job = job))?,
            MediaRef::File { file } => PathBuf::from(file),
            MediaRef::Link(other) => PathBuf::from(other),
        })
    }

    async fn follow(self: Arc<Self>, id: String) {
        let Some(job) = self.get(&id) else { return };
        let Some(handle) = job.handle.clone() else { return };
        let Some((key, _)) = credentials::key(job.provider) else {
            return self.fail(&id, "no_key", t!("jobs-no-key", provider = job.provider.as_str()));
        };
        if job.status == "sending" {
            self.update(&id, |job| job.status = "running".into());
        }
        let started = std::time::Instant::now();
        let mut wait = Duration::from_secs(3);
        let mut failures = 0;
        loop {
            if self.is_cancelled(&id) {
                return;
            }
            let polled = match job.provider {
                Provider::Runware => runware::poll(&self.http, &key, &handle).await,
                Provider::Fal => fal::poll(&self.http, &key, &handle).await,
                Provider::Openrouter => openrouter::poll(&self.http, &key, &handle).await,
                Provider::Local => return self.fail(&id, "lost_contact", t!("jobs-lost-contact", reason = "local".to_string())),
            };
            match polled {
                Ok(Polled::Done { outputs, cost }) => return self.finish(&id, outputs, cost).await,
                Ok(Polled::Failed { message }) => return self.fail(&id, "provider_failed", message),
                Ok(Polled::Waiting { progress }) => {
                    failures = 0;
                    if progress.is_some() {
                        self.update(&id, |job| job.progress = progress);
                    }
                }
                Err(error) => {
                    failures += 1;
                    tracing::warn!("job {id}: poll failed ({failures}): {error}");
                    if failures >= 40 {
                        return self.fail(&id, "lost_contact", t!("jobs-lost-contact", reason = error.to_string()));
                    }
                }
            }
            if started.elapsed() > Duration::from_secs(3 * 3600) {
                return self.fail(&id, "too_long", t!("jobs-too-long"));
            }
            tokio::time::sleep(wait).await;
            wait = (wait + Duration::from_secs(1)).min(Duration::from_secs(12));
        }
    }

    async fn finish(&self, id: &str, outputs: Vec<Output>, cost: Option<f64>) {
        let dir = self.dir.join(id);
        if let Err(error) = std::fs::create_dir_all(&dir) {
            return self.fail(id, "storage", error.to_string());
        }
        let Some(job) = self.get(id) else { return };
        let key = credentials::key(job.provider).map(|(key, _)| key);
        let tags = crate::tagging::ResultTags { title: &job.title, prompt: crate::title::prompt_of(&job.values), model: &job.model_name };
        let mut files = Vec::new();
        for (index, output) in outputs.into_iter().enumerate() {
            match self.save(&dir, index, output, key.as_deref(), &tags).await {
                Ok(file) => files.push(file),
                Err(error) => return self.fail(id, "download_failed", t!("jobs-download-failed", reason = error)),
            }
        }
        let was_cancelled = self.forget_cancel(id);
        let ended = self.update(id, |job| {
            job.status = "done".into();
            job.progress = Some(1.0);
            job.outputs = files;
            job.error = was_cancelled.then(|| t!("jobs-finished-after-cancel"));
            match cost {
                Some(cost) => {
                    job.cost = Some(cost);
                    job.cost_source = Some("provider".into());
                }
                None => {
                    job.cost = job.estimate;
                    job.cost_source = job.estimate.map(|_| "estimate".into());
                }
            }
        });
        if let Some(job) = ended {
            crate::hub::job_ended(&job);
        }
    }

    async fn save(&self, dir: &Path, index: usize, output: Output, key: Option<&str>, tags: &crate::tagging::ResultTags<'_>) -> Result<OutputFile, String> {
        use base64::Engine;
        let (bytes, mime, text) = match output {
            Output::File { path, mime } => (tokio::fs::read(&path).await.map_err(|e| format!("{}: {e}", path.display()))?, mime, None),
            Output::Text { text } => (text.clone().into_bytes(), "text/plain".to_string(), Some(text)),
            Output::Data { data_base64, mime } => (base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| e.to_string())?, mime, None),
            Output::Url { url, mime } => {
                let auth = match key {
                    Some(key) if openrouter::needs_key_to_download(&url) => Some(("Authorization", format!("Bearer {key}"))),
                    _ => None,
                };
                // the result is paid for: a dropped connection is tried again before the job counts as failed
                let mut attempt = 0u64;
                let (bytes, served) = loop {
                    match self.http.get_bytes(&url, auth.clone()).await {
                        Ok(answer) => break answer,
                        Err(error @ (ProviderError::Network(_) | ProviderError::Busy(_))) if attempt < 4 => {
                            attempt += 1;
                            tracing::warn!("download {url}: {error}; attempt {} of 5", attempt + 1);
                            tokio::time::sleep(Duration::from_secs(3 * attempt)).await;
                        }
                        Err(error) => return Err(error.to_string()),
                    }
                };
                let mime = served
                    .filter(|served| served.contains('/') && served != "application/octet-stream" && served != "binary/octet-stream")
                    .or_else(|| mime_guess::from_path(url.split('?').next().unwrap_or(&url)).first().map(|m| m.essence_str().to_string()))
                    .or_else(|| mime.filter(|m| m.contains('/')))
                    .or_else(|| sniff(&bytes).map(str::to_string))
                    .unwrap_or_else(|| "application/octet-stream".into());
                (bytes, mime, None)
            }
        };
        let mime = if mime == "application/octet-stream" { sniff(&bytes).unwrap_or("application/octet-stream").to_string() } else { mime };
        let extension = mime_guess::get_mime_extensions_str(&mime).and_then(|list| list.first().copied()).map(|ext| if ext == "jpe" { "jpg" } else { ext }).unwrap_or("bin");
        let extension = match mime.as_str() {
            "image/jpeg" => "jpg",
            "audio/mpeg" => "mp3",
            "text/plain" => "txt",
            "video/mp4" => "mp4",
            "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
            _ => extension,
        };
        let file = format!("{:02}.{extension}", index + 1);
        let path = dir.join(&file);
        tokio::fs::write(&path, &bytes).await.map_err(|e| e.to_string())?;
        let kind = mime.split('/').next().filter(|kind| matches!(*kind, "image" | "video" | "audio" | "text")).unwrap_or("file").to_string();
        let mut size = bytes.len() as u64;
        if matches!(kind.as_str(), "image" | "video" | "audio") {
            let (written, title, prompt, model, media_type) = (path.clone(), tags.title.to_string(), tags.prompt.map(str::to_string), tags.model.to_string(), mime.clone());
            let tagged = tokio::task::spawn_blocking(move || {
                crate::tagging::write(&written, &media_type, &crate::tagging::ResultTags { title: &title, prompt: prompt.as_deref(), model: &model })
            })
            .await
            .map_err(|e| e.to_string())?;
            match tagged {
                Ok(()) => size = tokio::fs::metadata(&path).await.map(|meta| meta.len()).unwrap_or(size),
                Err(error) => tracing::warn!("[ERROR] the tags of {} were not written: {error:#}", path.display()),
            }
        }
        Ok(OutputFile { index, kind, file, mime, size, text })
    }

    pub async fn cancel(&self, id: &str) -> Option<Job> {
        let job = self.get(id)?;
        if !matches!(job.status.as_str(), "queued" | "sending" | "running") {
            return Some(job);
        }
        self.cancelled.lock().unwrap_or_else(|p| p.into_inner()).insert(id.to_string());
        if job.provider == Provider::Local && job.status == "running" {
            crate::local::cancel();
            crate::studios::cancel();
        }
        // fal stops a job only while it waits in its queue; one that runs already is billed whatever is asked
        let stopped = match (job.provider, &job.handle, credentials::key(Provider::Fal)) {
            (Provider::Fal, Some(handle), Some((key, _))) => match fal::cancel(&self.http, &key, handle).await {
                Ok(()) => true,
                Err(error) => {
                    tracing::warn!("job {id}: fal did not take the cancel: {error}");
                    false
                }
            },
            _ => false,
        };
        let note = if stopped || job.status == "queued" {
            t!("jobs-cancelled")
        } else if job.provider == Provider::Fal && job.handle.is_none() {
            t!("jobs-cancelled-sending")
        } else {
            t!("jobs-cancelled-not-waiting")
        };
        self.update(id, |job| {
            job.status = "cancelled".into();
            job.error = Some(note);
        })
    }

    /// Keeps what a conversation of the window's chat cost, as a finished text job of OpenRouter started by an
    /// agent, so the spending and the agents' daily limit count it.
    pub fn record_chat(&self, project_id: Option<&str>, model: &str, asked: &str, cost: f64) {
        let now = now_ms();
        let job = Job {
            id: uuid::Uuid::now_v7().simple().to_string(),
            project_id: project_id.map(str::to_string),
            provider: Provider::Openrouter,
            model: model.to_string(),
            model_name: model.to_string(),
            title: format!("Chat: {}", asked.chars().take(60).collect::<String>()),
            task: "text".into(),
            values: json!({ "prompt": asked }),
            status: "done".into(),
            progress: None,
            error: None,
            error_code: None,
            estimate: None,
            cost: Some(cost),
            cost_source: Some("provider".into()),
            outputs: Vec::new(),
            imported: json!([]),
            place: false,
            place_at: None,
            liked: false,
            origin: "agent".into(),
            created: now,
            updated: now,
            handle: None,
        };
        match self.insert(&job) {
            Ok(()) => events::send("job", serde_json::to_value(&job).unwrap_or(Value::Null)),
            Err(error) => tracing::error!("[ERROR] the chat's cost of {cost} USD was not recorded: {error}"),
        }
    }

    pub fn agent_spent_today(&self) -> f64 {
        let today_start = chrono::Local::now().date_naive().and_hms_opt(0, 0, 0).and_then(|time| time.and_local_timezone(chrono::Local).single()).map(|time| time.timestamp_millis()).unwrap_or(0);
        self.db()
            .query_row(
                "SELECT COALESCE(SUM(COALESCE(cost, estimate, 0)), 0) FROM jobs WHERE origin = 'agent' AND created >= ?1 AND status NOT IN ('failed', 'cancelled')",
                params![today_start],
                |row| row.get(0),
            )
            .unwrap_or(0.0)
    }

    pub fn spend(&self, project: Option<&str>) -> Value {
        let db = self.db();
        let grouped = |columns: &str, shape: &dyn Fn(&rusqlite::Row) -> rusqlite::Result<Value>| -> Vec<Value> {
            let query = format!("SELECT {columns}, COALESCE(SUM(cost), 0), COUNT(*) FROM jobs WHERE status = 'done' AND (?1 IS NULL OR project_id = ?1) GROUP BY {columns} ORDER BY 2 DESC");
            db.prepare(&query)
                .and_then(|mut statement| statement.query_map(params![project], |row| shape(row))?.collect::<rusqlite::Result<Vec<_>>>())
                .unwrap_or_default()
        };
        let by_provider = grouped("provider", &|row| Ok(json!({ "provider": row.get::<_, String>(0)?, "usd": row.get::<_, f64>(1)?, "jobs": row.get::<_, i64>(2)? })));
        let by_task = grouped("task", &|row| Ok(json!({ "task": row.get::<_, String>(0)?, "usd": row.get::<_, f64>(1)?, "jobs": row.get::<_, i64>(2)? })));
        let by_model = grouped("provider, model, model_name", &|row| {
            Ok(json!({ "provider": row.get::<_, String>(0)?, "model": row.get::<_, String>(1)?, "model_name": row.get::<_, String>(2)?, "usd": row.get::<_, f64>(3)?, "jobs": row.get::<_, i64>(4)? }))
        });
        let today_start = chrono::Local::now().date_naive().and_hms_opt(0, 0, 0).and_then(|time| time.and_local_timezone(chrono::Local).single()).map(|time| time.timestamp_millis()).unwrap_or(0);
        let today: f64 = db
            .query_row("SELECT COALESCE(SUM(cost), 0) FROM jobs WHERE status = 'done' AND updated >= ?1 AND (?2 IS NULL OR project_id = ?2)", params![today_start, project], |row| row.get(0))
            .unwrap_or(0.0);
        let total: f64 = by_provider.iter().filter_map(|item| item["usd"].as_f64()).fold(0.0, |sum, usd| sum + usd);
        json!({ "total": total, "today": today, "providers": by_provider, "tasks": by_task, "models": by_model })
    }
}

/// The values a run is sent with, which its price is worked out from too. OpenRouter's defaults are this
/// program's picks from the model's lists (its first voice), not the provider's, so they are sent; schema
/// defaults of fal and Runware are the provider's own. A required field left at its default is still sent.
pub fn with_defaults(form: &ModelForm, mut values: Map<String, Value>) -> Map<String, Value> {
    for field in &form.fields {
        let ours = form.provider == Provider::Openrouter || field.required;
        if let (true, Some(default)) = (ours, &field.default) {
            values.entry(field.key.clone()).or_insert_with(|| default.clone());
        }
    }
    values
}

/// The first bytes of a file say what it is when the provider did not.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    let starts = |prefix: &[u8]| bytes.starts_with(prefix);
    if starts(b"\x89PNG") {
        Some("image/png")
    } else if starts(b"\xFF\xD8\xFF") {
        Some("image/jpeg")
    } else if starts(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if starts(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") {
        Some("audio/wav")
    } else if bytes.get(4..8) == Some(b"ftyp") {
        Some("video/mp4")
    } else if starts(b"\x1A\x45\xDF\xA3") {
        Some("video/webm")
    } else if starts(b"ID3") || starts(b"\xFF\xFB") || starts(b"\xFF\xF3") {
        Some("audio/mpeg")
    } else if starts(b"fLaC") {
        Some("audio/flac")
    } else if starts(b"OggS") {
        Some("audio/ogg")
    } else if starts(b"glTF") {
        Some("model/gltf-binary")
    } else {
        None
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRequest {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub values: Map<String, Value>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default = "one")]
    pub repeat: u32,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub place: bool,
    #[serde(default)]
    pub place_at: Option<f64>,
}

fn one() -> u32 {
    1
}

async fn create(State(state): State<AppState>, Json(mut request): Json<CreateRequest>) -> Response {
    let Some(provider) = Provider::parse(&request.provider) else { return bad(t!("catalog-unknown-provider", provider = request.provider)) };
    if provider != Provider::Local && credentials::key(provider).is_none() {
        return bad(t!("jobs-no-key", provider = provider.as_str()));
    }
    if request.place && request.project_id.as_deref().is_none_or(str::is_empty) {
        return bad(t!("jobs-place-needs-project"));
    }
    if request.place_at.is_some_and(|at| !at.is_finite() || at < 0.0) {
        return bad(t!("jobs-place-at-invalid"));
    }
    let form = match state.catalog.form(provider, &request.model).await {
        Ok(form) => form,
        Err(error) => return (StatusCode::BAD_GATEWAY, Json(json!({ "error": error }))).into_response(),
    };
    // a run asked for without its task (an agent's) takes the model's own when it has only one
    if request.task.as_deref().is_none_or(str::is_empty) {
        let tasks = state.catalog.find(provider, &request.model).map(|entry| entry.tasks).unwrap_or_default();
        match tasks.as_slice() {
            [only] => request.task = Some(only.as_str().to_string()),
            [] => {}
            several => return bad(t!("jobs-task-needed", tasks = several.iter().map(|task| task.as_str()).collect::<Vec<_>>().join(", "))),
        }
    }
    // an agent's field the model does not have would be dropped unseen: it is refused, naming the model's own
    if request.origin.as_deref() == Some("agent")
        && let Some(unknown) = request.values.keys().find(|key| !form.fields.iter().any(|field| &field.key == *key))
    {
        let known: Vec<String> = form.fields.iter().map(|field| format!("{} ({})", field.key, field.label)).collect();
        return bad(t!("jobs-field-unknown", field = unknown.clone(), fields = known.join(", ")));
    }
    let elements = match crate::choices::current() {
        Ok(choices) => crate::elements::from_choices(&choices),
        Err(error) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error }))).into_response(),
    };
    if let Err(error) = crate::elements::apply(&form.fields, &mut request.values, &elements) {
        return bad(error);
    }
    for field in form.fields.iter().filter(|field| field.required) {
        let missing = match request.values.get(&field.key) {
            None | Some(Value::Null) => true,
            Some(Value::String(text)) => text.trim().is_empty(),
            Some(Value::Array(items)) => items.is_empty(),
            _ => false,
        };
        if missing && field.default.is_none() {
            // an agent fills fields by key, the person by the label the form shows
            let named = if request.origin.as_deref() == Some("agent") { format!("{} ({})", field.label, field.key) } else { field.label.clone() };
            return bad(t!("jobs-field-required", field = named));
        }
    }
    // OpenRouter reads a video only from an https link, never from the data the server could send it
    if form.provider == Provider::Openrouter {
        for field in &form.fields {
            let FieldKind::Media { media: MediaKind::Video, .. } = field.kind else { continue };
            let items = match request.values.get(&field.key) {
                Some(Value::Array(items)) => items.clone(),
                Some(Value::Null) | None => Vec::new(),
                Some(single) => vec![single.clone()],
            };
            if items.iter().any(|item| !item.as_str().is_some_and(|link| link.starts_with("https://"))) {
                return bad(t!("jobs-openrouter-video-link", field = field.label.clone()));
            }
        }
    }
    // a text longer than the model takes is refused here, before it is sent and paid for
    for field in &form.fields {
        let (FieldKind::Text { max_length: Some(max) } | FieldKind::Textarea { max_length: Some(max) }) = field.kind else { continue };
        if let Some(Value::String(text)) = request.values.get(&field.key) {
            let count = text.chars().count() as u64;
            if count > max {
                return bad(t!("jobs-field-too-long", field = field.label.clone(), count = count, max = max));
            }
        }
    }
    let name = state.catalog.find(provider, &request.model).map(|entry| entry.name).unwrap_or_else(|| request.model.clone());
    let created = {
        let _held = crate::spend::CHECK_AND_RECORD.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(limit) = crate::spend::agent_limit_left(&request, &form) {
            return bad(limit);
        }
        state.jobs.create(request, &form, name)
    };
    Json(json!({ "jobs": created })).into_response()
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

async fn list(State(state): State<AppState>, Query(query): Query<ListQuery>) -> Json<Value> {
    let jobs = state.jobs.list(query.project.as_deref().filter(|p| !p.is_empty()), query.limit.unwrap_or(200).min(1000));
    Json(json!({ "jobs": jobs }))
}

async fn one_job(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match state.jobs.get(&id) {
        Some(job) => Json(job).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": t!("jobs-not-found", job = id) }))).into_response(),
    }
}

async fn cancel(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match state.jobs.cancel(&id).await {
        Some(job) => Json(job).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": t!("jobs-not-found", job = id) }))).into_response(),
    }
}

async fn delete_job(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(job) = state.jobs.get(&id) else { return StatusCode::NO_CONTENT.into_response() };
    if matches!(job.status.as_str(), "queued" | "sending" | "running") {
        return bad(t!("jobs-still-running"));
    }
    state.jobs.remove(&id);
    events::send("job_removed", json!({ "id": id }));
    StatusCode::NO_CONTENT.into_response()
}

async fn retry(State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(job) = state.jobs.get(&id) else { return (StatusCode::NOT_FOUND, Json(json!({ "error": t!("jobs-not-found", job = id) }))).into_response() };
    let request = CreateRequest {
        provider: job.provider.as_str().into(),
        model: job.model.clone(),
        task: Some(job.task.clone()),
        values: job.values.as_object().cloned().unwrap_or_default(),
        project_id: job.project_id.clone(),
        repeat: 1,
        origin: Some(job.origin.clone()),
        place: job.place,
        place_at: job.place_at,
    };
    create(State(state), Json(request)).await
}

async fn file(State(state): State<AppState>, UrlPath((id, index)): UrlPath<(String, usize)>, request: Request) -> Response {
    match state.jobs.file_path(&id, index) {
        Some(path) => match crate::fs_api::serve_file(&path, request).await {
            Ok(response) => response,
            Err(error) => error.into_response(),
        },
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": t!("jobs-no-such-output", job = id) }))).into_response(),
    }
}

#[derive(Deserialize)]
pub struct ImportedBody {
    #[serde(default)]
    media_ids: Vec<String>,
}

async fn imported(State(state): State<AppState>, UrlPath(id): UrlPath<String>, Json(body): Json<ImportedBody>) -> Response {
    match state.jobs.update(&id, |job| job.imported = json!(body.media_ids)) {
        Some(job) => Json(job).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": t!("jobs-not-found", job = id) }))).into_response(),
    }
}

#[derive(Deserialize)]
pub struct LikedBody {
    liked: bool,
}

async fn liked(State(state): State<AppState>, UrlPath(id): UrlPath<String>, Json(body): Json<LikedBody>) -> Response {
    match state.jobs.set_liked(&id, body.liked) {
        Some(job) => Json(job).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": t!("jobs-not-found", job = id) }))).into_response(),
    }
}

#[derive(Deserialize)]
pub struct SpendQuery {
    #[serde(default)]
    project: Option<String>,
}

async fn spend(State(state): State<AppState>, Query(query): Query<SpendQuery>) -> Json<Value> {
    Json(state.jobs.spend(query.project.as_deref().filter(|p| !p.is_empty())))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/jobs", get(list).post(create))
        .route("/api/jobs/{id}", get(one_job).delete(delete_job))
        .route("/api/jobs/{id}/cancel", post(cancel))
        .route("/api/jobs/{id}/retry", post(retry))
        .route("/api/jobs/{id}/imported", post(imported))
        .route("/api/jobs/{id}/liked", post(liked))
        .route("/api/jobs/{id}/files/{index}", get(file))
        .route("/api/spend", get(spend))
}
