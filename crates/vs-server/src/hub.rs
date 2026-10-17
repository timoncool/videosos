//! Studio Hub in VideoSOS, wired as `music-studios/CONTRACT.md` says every program does: anonymous statistics
//! (only after the first-run screen showed its checkbox, off under DO_NOT_TRACK or STUDIO_TELEMETRY=0) and the
//! news feed. What is counted: finished and failed generations by task and provider, the models used, every call
//! to the API by route template, model downloads ready or failed, and the seconds of video made on this computer's
//! card — never prompts, files or keys.

use std::path::Path;
use std::sync::OnceLock;

use crate::jobs::Job;

static HUB: OnceLock<Option<studio_hub_client::Hub>> = OnceLock::new();

/// The system as the report and an issue form name it: "windows 11 (26100)".
pub fn os_label() -> String {
    format!(
        "{} {}",
        sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        sysinfo::System::os_version().unwrap_or_default()
    )
    .to_ascii_lowercase()
}

pub fn start(data: &Path, http: reqwest::Client) {
    HUB.get_or_init(|| {
        let os_label = os_label();
        let config = studio_hub_client::HubConfig {
            app: "videosos".into(),
            version: crate::service::app_version().to_string(),
            data_dir: data.to_path_buf(),
            http,
            os_label,
            gpu: gpu(),
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

/// The card the local models run on: NVML names an NVIDIA one; any other card runs the Vulkan build.
fn gpu() -> studio_hub_client::Gpu {
    let snapshot = crate::hw::snapshot();
    let nvidia = !snapshot.gpu_name.is_empty();
    studio_hub_client::Gpu {
        vendor: if nvidia { "nvidia" } else { "other" }.into(),
        vram_gb: if nvidia { studio_hub_client::Gpu::vram_bucket(snapshot.total_vram) } else { "?".into() },
        backend: if nvidia { "cuda" } else { "vulkan" }.into(),
    }
}

fn hub() -> Option<&'static studio_hub_client::Hub> {
    HUB.get().and_then(Option::as_ref)
}

/// The languages the hub accepts in a report; a report with another is refused whole.
const HUB_LANGUAGES: [&str; 8] = ["en", "ru", "es", "fr", "pt", "ja", "ko", "zh"];

pub fn set_language(language: &str) {
    if let Some(hub) = hub() {
        let base = language.split('-').next().unwrap_or(language);
        hub.set_ui_lang(if HUB_LANGUAGES.contains(&base) { base } else { "en" });
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

/// Every call to VideoSOS's API counted by route template, an agent's calls included; without a hub, as it is.
pub fn track<S: Clone + Send + Sync + 'static>(router: axum::Router<S>) -> axum::Router<S> {
    match hub() {
        Some(hub) => hub.track(router),
        None => router,
    }
}

/// A local model or engine finished downloading.
pub fn setup_ready() {
    if let Some(hub) = hub() {
        hub.setup_ready();
    }
}

/// A local download failed, `code` an error code in no interface language, so one cause is one row.
pub fn setup_failed(code: &str) {
    if let Some(hub) = hub() {
        hub.setup_failed(code);
    }
}

/// The model set a local run loaded: the model's id and its weight files.
pub fn used_models(set: &str, components: &[String]) {
    if let Some(hub) = hub() {
        hub.used_models(Some(set), components, 1);
    }
}

/// Seconds of video a local model made with the engine to itself, for the speed by card class.
pub fn worked(kind: &str, result_seconds: f64, work: std::time::Duration) {
    if let Some(hub) = hub() {
        hub.worked(kind, result_seconds, work);
    }
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
