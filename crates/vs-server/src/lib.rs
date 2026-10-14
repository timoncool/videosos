//! VideoSOS server: one axum service on 127.0.0.1 that serves the editor window and everything behind it —
//! the workspace the editor keeps its projects in, generations through OpenRouter, fal and Runware, export
//! through ffmpeg, and the MCP server through which an agent drives the same routes the window uses.
//!
//! The desktop shell runs it on a background thread of its own process (`serve_blocking`); `vs-server`
//! runs it alone for development.

#[macro_use]
pub mod i18n;
pub mod catalog;
mod chat;
mod checkpoints;
mod assistant;
mod choices;
mod elements;
pub use vs_providers;
pub mod credentials;
pub mod events;
pub mod exports;
pub mod hw;
pub mod fs_api;
pub mod hub;
pub mod jobs;
pub mod local;
pub mod journal;
mod keys;
pub mod mcp;
pub mod process_group;
pub mod remote;
pub mod request_log;
pub mod service;
pub mod settings;
mod studios;
mod spa;
mod spend;
mod tagging;
mod title;
pub mod tools;
pub mod url_import;
pub mod ytdlp;

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::set_header::SetResponseHeaderLayer;

/// Everything a handler needs.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

pub struct Inner {
    /// The server root: `frontend/dist`, `data/`, `tools/`, `secrets/` live under it.
    pub repo_root: PathBuf,
    /// The editor's workspace folder.
    pub workspace: PathBuf,
    /// The folder the server keeps its own files in.
    pub data: PathBuf,
    pub http: vs_providers::http::Http,
    pub catalog: Arc<catalog::Catalog>,
    pub jobs: Arc<jobs::Jobs>,
    pub journal: journal::Journal,
    /// Videos downloaded by their links.
    pub fetches: url_import::Fetches,
}

impl std::ops::Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.inner
    }
}

impl AppState {
    /// Opens the data folders, the catalogue and the jobs; call inside the runtime (background work starts).
    pub fn new(repo_root: &Path) -> anyhow::Result<Self> {
        let data = repo_root.join("data");
        let workspace = data.join("workspace");
        std::fs::create_dir_all(&workspace)?;
        // copies an agent handed over for import last run: the window has taken them or never will
        let inbox = data.join("inbox");
        if inbox.is_dir()
            && let Err(error) = std::fs::remove_dir_all(&inbox)
        {
            tracing::warn!("the old import copies in {} were not removed: {error}", inbox.display());
        }
        credentials::init(repo_root);
        request_log::init(&data);
        settings::init(&data);
        choices::init(&data);
        checkpoints::init(&data);
        let http = vs_providers::http::Http::new(reqwest::Client::builder()).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let catalog = catalog::Catalog::open(&data, http.clone());
        let jobs = jobs::Jobs::open(&data, &workspace, http.clone(), catalog.clone())?;
        spend::init(jobs.clone());
        hub::start(&data, http.client.clone());
        let journal = journal::Journal::open(&data)?;
        let fetches = url_import::Fetches::open(&data);
        Ok(Self { inner: Arc::new(Inner { repo_root: repo_root.to_path_buf(), workspace, data, http, catalog, jobs, journal, fetches }) })
    }

    /// Work left from the last run and the catalogue read afresh.
    pub fn start_background(&self) {
        self.jobs.resume();
        self.catalog.refresh_all();
        studios::watch();
        local::link_from_neighbors(&self.data);
    }
}

#[derive(Deserialize)]
struct LanguageBody {
    language: String,
}

/// The window says which language it shows: the server's own messages follow it.
async fn set_language(Json(body): Json<LanguageBody>) -> Result<StatusCode, (StatusCode, String)> {
    i18n::set_language(&body.language).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    hub::set_language(&body.language);
    Ok(StatusCode::NO_CONTENT)
}

/// Where the program keeps what the person makes, for Settings, About.
async fn app_paths(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "data_dir": state.data.display().to_string(),
        "projects_dir": state.workspace.display().to_string(),
        "generations_dir": state.data.join("generations").display().to_string(),
        "exports_dir": state.data.join("exports").display().to_string(),
        "logs_dir": state.data.join("logs").display().to_string(),
    }))
}

async fn info(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "app": service::APP_ID,
        "version": service::app_version(),
        "workspace": state.workspace.display().to_string(),
        "data": state.data.display().to_string(),
        "os": std::env::consts::OS,
        "system": hub::os_label(),
    }))
}

/// Refuses a request another site sends through the person's browser (its Origin is not this program) or
/// one that reaches the server under a foreign host name (DNS rebinding): generations spend the person's
/// money, so only the window and agents on this computer may ask for them.
async fn local_only(request: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    use axum::response::IntoResponse;
    if request.extensions().get::<remote::FromNetwork>().is_some() {
        return next.run(request).await;
    }
    let headers = request.headers();
    let host_ok = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(|host| host.rsplit_once(':').map(|(name, _)| name).unwrap_or(host).to_ascii_lowercase())
        .is_none_or(|name| matches!(name.as_str(), "127.0.0.1" | "localhost" | "[::1]" | "tauri.localhost"));
    if !host_ok || !mcp::local_origin(headers) {
        return (StatusCode::FORBIDDEN, "VideoSOS answers only its own window and agents on this computer.").into_response();
    }
    next.run(request).await
}

/// The API and the window on one origin. Every answer carries the cross-origin isolation headers the
/// editor needs for SharedArrayBuffer (decoding and export workers).
pub fn app(state: AppState) -> Router {
    // counted before the MCP tools take the router: an agent's calls are VideoSOS's features too
    let api = hub::track(
        Router::new()
        .route("/health", get(service::health))
        .route("/api/info", get(info))
        .route("/api/app/paths", get(app_paths))
        .route("/api/network", get(remote::status).put(remote::change))
        .route("/api/ui-language", post(set_language))
        .route("/api/events", get(events::stream))
        .merge(fs_api::router())
        .merge(catalog::router())
        .merge(jobs::router())
        .merge(local::router())
        .merge(keys::router())
        .merge(settings::router())
        .merge(assistant::router())
        .merge(choices::router())
        .merge(checkpoints::router())
        .merge(url_import::router())
        .merge(chat::router())
        .merge(exports::router())
        .merge(hw::router())
        .merge(journal::router())
        .with_state(state.clone())
        .merge(hub::router()),
    );
    mcp::install(api.clone());
    api.merge(mcp::router().with_state(state.clone()))
        .merge(spa::router(&state.repo_root))
        .layer(axum::middleware::from_fn(local_only))
        .layer(axum::middleware::from_fn(remote::guard))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-embedder-policy"),
            HeaderValue::from_static("require-corp"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
}

/// The address the service binds: every address when access from the network is on, loopback otherwise.
pub fn bind_address(repo_root: &Path) -> [u8; 4] {
    remote::start(settings::saved_network(&repo_root.join("data")))
}

/// Serves on the listener the caller bound until the process ends.
pub fn serve_blocking(repo_root: &Path, listener: TcpListener) -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().thread_name("vs-server").build()?;
    runtime.block_on(async move {
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        service::record_port(port);
        let state = AppState::new(repo_root)?;
        state.start_background();
        let listener = tokio::net::TcpListener::from_std(listener)?;
        tracing::info!("VideoSOS {} on http://127.0.0.1:{port}/", service::app_version());
        axum::serve(listener, app(state).into_make_service_with_connect_info::<std::net::SocketAddr>()).await?;
        Ok(())
    })
}
