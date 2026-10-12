//! Studio Hub in VideoSOS: anonymous statistics (only after the first-run screen showed its checkbox, off
//! under DO_NOT_TRACK or STUDIO_TELEMETRY=0) and the news feed. What is counted: finished and failed
//! generations by task and provider, and the models used — never prompts, files or keys.

use std::path::Path;
use std::sync::OnceLock;

use crate::jobs::Job;

static HUB: OnceLock<Option<studio_hub_client::Hub>> = OnceLock::new();

pub fn start(data: &Path, http: reqwest::Client) {
    HUB.get_or_init(|| {
        let os_label = format!(
            "{} {}",
            sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
            sysinfo::System::os_version().unwrap_or_default()
        )
        .to_ascii_lowercase();
        let config = studio_hub_client::HubConfig {
            app: "videosos".into(),
            version: crate::service::app_version().to_string(),
            data_dir: data.to_path_buf(),
            http,
            os_label,
            gpu: studio_hub_client::Gpu { vendor: "other".into(), vram_gb: "?".into(), backend: "cloud".into() },
            ui_lang: "en".into(),
            urls: Vec::new(),
        };
        match studio_hub_client::Hub::new(config) {
            Ok(hub) => {
                hub.spawn();
                Some(hub)
            }
            Err(error) => {
                eprintln!("[ERROR] Studio Hub is off for this run, its state file cannot be read: {error}");
                None
            }
        }
    });
}

fn hub() -> Option<&'static studio_hub_client::Hub> {
    HUB.get().and_then(Option::as_ref)
}

pub fn set_language(language: &str) {
    if let Some(hub) = hub() {
        hub.set_ui_lang(language.split('-').next().unwrap_or(language));
    }
}

/// The day's statistics, sent as the program closes; at most a few seconds.
pub fn flush_on_exit() {
    let Some(hub) = hub().cloned() else { return };
    match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime.block_on(hub.flush(std::time::Duration::from_secs(8))),
        Err(error) => eprintln!("[ERROR] the statistics were not sent at exit, no runtime: {error}"),
    }
}

pub fn router<S: Clone + Send + Sync + 'static>() -> axum::Router<S> {
    hub().map(studio_hub_client::Hub::router).unwrap_or_default()
}

/// A generation that ended: `<task>_done` or `<task>_failed`, the model as `<provider>:<model>`.
pub fn job_ended(job: &Job) {
    let Some(hub) = hub() else { return };
    let task = if job.task.is_empty() { "generation" } else { job.task.as_str() };
    match job.status.as_str() {
        "done" => {
            hub.count(&format!("{task}_done"), 1);
            hub.used_model(&format!("{}:{}", job.provider.as_str(), job.model));
        }
        "failed" => {
            hub.count(&format!("{task}_failed"), 1);
            hub.failed(task, job.error.as_deref().unwrap_or(""));
        }
        _ => {}
    }
}

pub fn count(name: &str) {
    if let Some(hub) = hub() {
        hub.count(name, 1);
    }
}
