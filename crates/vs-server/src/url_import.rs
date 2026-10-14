//! A video by its link into the open project, as Dub Studio takes one: a probe (what the video is, its
//! qualities) and a download through yt-dlp. A download runs in its own thread; the window imports the finished
//! file into the project's media library, as it imports a generation's results, and says so, and the download's
//! folder goes. The list lives in `data/fetch/fetches.json` and outlives a restart: a download cut off shows as
//! interrupted and goes on from where it stopped (yt-dlp's partial files stay in `data/fetch/<id>`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Path as AxPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ytdlp::{self, Line, Quality, UrlError};
use crate::AppState;

/// How many downloads the list keeps (older finished ones go with their folders).
const KEEP: usize = 30;
const COOKIES_LIMIT: u64 = 1024 * 1024;
/// A probe (`-J`) longer than this is a site that does not answer.
const PROBE_TIMEOUT: Duration = Duration::from_secs(180);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FetchStatus {
    Downloading,
    Completed,
    Failed,
    Cancelled,
    /// Cut off by VideoSOS closing; resuming goes on from where it stopped.
    Interrupted,
}

/// One download by a link.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Fetch {
    pub id: String,
    pub url: String,
    pub quality: Quality,
    pub cookies: bool,
    /// The project whose library takes the file.
    pub project_id: String,
    pub status: FetchStatus,
    /// probe | download | merge | extract | done
    pub phase: String,
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed_bps: u64,
    pub eta_s: Option<u64>,
    /// The finished file in the download's folder and its type, until the window imports it.
    pub file: Option<String>,
    pub mime: Option<String>,
    /// The media items the window made of it; set once, after which the folder is gone.
    pub imported: Vec<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
    pub hint: Option<String>,
    pub tool_version: Option<String>,
    pub started_at: u64,
    pub updated_at: u64,
}

/// Where cookies.txt comes from: a path on this computer (an agent) or the file's text (the window picks a file,
/// and a browser does not give its path).
#[derive(Clone, Debug)]
pub enum Cookies {
    Path(PathBuf),
    Text(String),
}

struct Inner {
    data: PathBuf,
    root: PathBuf,
    state_path: PathBuf,
    list: Mutex<Vec<Fetch>>,
    stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
    last_told: Mutex<Instant>,
}

#[derive(Clone)]
pub struct Fetches {
    inner: Arc<Inner>,
}

fn check_url(url: &str) -> Result<String, UrlError> {
    let url = url.trim();
    let parsed = reqwest::Url::parse(url).map_err(|e| UrlError::new("bad_url", t!("url-not-a-link", url = url.to_string(), error = e.to_string())))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(str::is_empty) {
        return Err(UrlError::new("bad_url", t!("url-not-http", url = url.to_string())));
    }
    Ok(parsed.to_string())
}

/// cookies.txt into `dest`: a copy, not the file itself, since yt-dlp writes its own cookies into it.
fn place_cookies(c: &Cookies, dest: &Path) -> Result<(), UrlError> {
    let text = match c {
        Cookies::Path(p) => {
            let meta = std::fs::metadata(p).map_err(|e| UrlError::new("cookies_invalid", format!("{}: {e}", p.display())))?;
            if !meta.is_file() || meta.len() > COOKIES_LIMIT {
                return Err(UrlError::new("cookies_invalid", t!("url-cookies-not-file", path = p.display().to_string())));
            }
            std::fs::read_to_string(p).map_err(|e| UrlError::new("cookies_invalid", format!("{}: {e}", p.display())))?
        }
        Cookies::Text(t) => t.clone(),
    };
    if text.trim().is_empty() || text.len() as u64 > COOKIES_LIMIT {
        return Err(UrlError::new("cookies_invalid", t!("url-cookies-empty-or-large")));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| UrlError::new("io", format!("{}: {e}", parent.display())))?;
    }
    std::fs::write(dest, text).map_err(|e| UrlError::new("io", format!("{}: {e}", dest.display())))
}

/// The file yt-dlp left in a download's folder: not a part, not its own description.
fn find_media(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.file_stem().is_some_and(|stem| stem == "source"))
        .filter(|path| !path.extension().is_some_and(|ext| matches!(ext.to_str(), Some("part" | "ytdl" | "json" | "txt" | "conf"))))
        .max_by_key(|path| std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0))
}

fn mime_of(path: &Path) -> String {
    mime_guess::from_path(path).first().map(|m| m.essence_str().to_string()).unwrap_or_else(|| "application/octet-stream".into())
}

impl Fetches {
    pub fn open(data: &Path) -> Self {
        let root = data.join("fetch");
        let state_path = root.join("fetches.json");
        let mut list: Vec<Fetch> = match std::fs::read_to_string(&state_path) {
            Ok(text) => serde_json::from_str::<Value>(&text).ok().and_then(|value| serde_json::from_value(value["fetches"].clone()).ok()).unwrap_or_else(|| {
                tracing::warn!("{} is unreadable; the earlier link downloads are forgotten", state_path.display());
                Vec::new()
            }),
            Err(_) => Vec::new(),
        };
        let mut cut = false;
        for f in list.iter_mut().filter(|f| f.status == FetchStatus::Downloading) {
            f.status = FetchStatus::Interrupted;
            f.error_code = Some("interrupted".into());
            f.error = Some(t!("url-interrupted"));
            f.hint = Some(ytdlp::hint("interrupted").into());
            f.speed_bps = 0;
            f.eta_s = None;
            cut = true;
        }
        let fetches = Fetches {
            inner: Arc::new(Inner { data: data.to_path_buf(), root, state_path, list: Mutex::new(list), stops: Mutex::new(HashMap::new()), last_told: Mutex::new(Instant::now()) }),
        };
        if cut {
            fetches.save(&lock(&fetches.inner.list));
        }
        fetches
    }

    fn dir(&self, id: &str) -> PathBuf {
        self.inner.root.join(id)
    }

    fn save(&self, list: &[Fetch]) {
        let saved = std::fs::create_dir_all(&self.inner.root)
            .map_err(|e| e.to_string())
            .and_then(|()| serde_json::to_vec_pretty(&json!({ "fetches": list })).map_err(|e| e.to_string()))
            .and_then(|body| crate::tools::write_atomic(&self.inner.state_path, &body));
        if let Err(e) = saved {
            tracing::error!("[ERROR] {}: {e}", self.inner.state_path.display());
        }
    }

    fn tell(fetch: &Fetch) {
        crate::events::send("fetch", serde_json::to_value(fetch).unwrap_or(Value::Null));
    }

    pub fn list(&self) -> Vec<Fetch> {
        lock(&self.inner.list).clone()
    }

    pub fn get(&self, id: &str) -> Option<Fetch> {
        lock(&self.inner.list).iter().find(|f| f.id == id).cloned()
    }

    /// Changes a running download; the window hears of it at most a few times a second, the disk every two.
    fn update(&self, id: &str, change: impl FnOnce(&mut Fetch)) {
        let mut list = lock(&self.inner.list);
        let Some(f) = list.iter_mut().find(|f| f.id == id && f.status == FetchStatus::Downloading) else { return };
        change(f);
        f.updated_at = ytdlp::now_s();
        let fetch = f.clone();
        let mut last = lock(&self.inner.last_told);
        if last.elapsed() > Duration::from_millis(400) {
            *last = Instant::now();
            Self::tell(&fetch);
            self.save(&list);
        }
    }

    /// Starts a download in its own thread. No tool, a bad link or bad cookies are refused before it starts.
    pub fn start(&self, url: &str, quality: Quality, project_id: &str, cookies: Option<Cookies>) -> Result<Fetch, UrlError> {
        let url = check_url(url)?;
        if project_id.trim().is_empty() {
            return Err(UrlError::new("bad_url", t!("url-needs-project")));
        }
        let tool = ytdlp::tool(&self.inner.data)?;
        ytdlp::update_in_background_if_due(&self.inner.data);
        let id = format!("url{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let now = ytdlp::now_s();
        let fetch = Fetch {
            id: id.clone(),
            url,
            quality,
            cookies: cookies.is_some(),
            project_id: project_id.to_string(),
            status: FetchStatus::Downloading,
            phase: "probe".into(),
            title: None,
            duration: None,
            downloaded: 0,
            total: None,
            speed_bps: 0,
            eta_s: None,
            file: None,
            mime: None,
            imported: Vec::new(),
            error_code: None,
            error: None,
            hint: None,
            tool_version: Some(tool.version.clone()),
            started_at: now,
            updated_at: now,
        };
        // "this link is already downloading" and the insert under one lock: two quick requests are not two downloads
        {
            let mut list = lock(&self.inner.list);
            if let Some(busy) = list.iter().find(|f| f.status == FetchStatus::Downloading && f.url == fetch.url) {
                return Err(UrlError::new("busy", t!("url-already-downloading", id = busy.id.clone())));
            }
            list.insert(0, fetch.clone());
            self.evict(&mut list);
            self.save(&list);
        }
        let dir = self.dir(&id);
        let placed = std::fs::create_dir_all(&dir)
            .map_err(|e| UrlError::new("io", format!("{}: {e}", dir.display())))
            .and_then(|()| cookies.as_ref().map_or(Ok(()), |c| place_cookies(c, &dir.join("cookies.txt"))));
        if let Err(e) = placed {
            self.forget_now(&id);
            return Err(e);
        }
        Self::tell(&fetch);
        self.spawn(&id, tool)?;
        Ok(fetch)
    }

    /// Goes on with a failed or interrupted download from where it stopped.
    pub fn resume(&self, id: &str) -> Result<Fetch, UrlError> {
        let tool = ytdlp::tool(&self.inner.data)?;
        let fetch = {
            let mut list = lock(&self.inner.list);
            let f = list.iter_mut().find(|f| f.id == id).ok_or_else(|| UrlError::new("not_found", t!("url-no-fetch", id = id.to_string())))?;
            match f.status {
                FetchStatus::Downloading => return Err(UrlError::new("running", t!("url-still-downloading", id = id.to_string()))),
                FetchStatus::Completed => return Ok(f.clone()),
                FetchStatus::Cancelled => return Err(UrlError::new("not_found", t!("url-cancelled-removed", id = id.to_string()))),
                FetchStatus::Failed | FetchStatus::Interrupted => {}
            }
            f.status = FetchStatus::Downloading;
            f.phase = "probe".into();
            f.error_code = None;
            f.error = None;
            f.hint = None;
            f.tool_version = Some(tool.version.clone());
            f.updated_at = ytdlp::now_s();
            let fetch = f.clone();
            self.save(&list);
            fetch
        };
        Self::tell(&fetch);
        self.spawn(id, tool)?;
        Ok(fetch)
    }

    pub fn cancel(&self, id: &str) -> Result<Fetch, UrlError> {
        let stop = lock(&self.inner.stops).get(id).cloned();
        match stop {
            Some(stop) => stop.store(true, Ordering::SeqCst),
            None => {
                let mut list = lock(&self.inner.list);
                let f = list.iter_mut().find(|f| f.id == id).ok_or_else(|| UrlError::new("not_found", t!("url-no-fetch", id = id.to_string())))?;
                if matches!(f.status, FetchStatus::Failed | FetchStatus::Interrupted) {
                    f.status = FetchStatus::Cancelled;
                    let fetch = f.clone();
                    self.save(&list);
                    drop(list);
                    self.remove_dir(id);
                    Self::tell(&fetch);
                }
            }
        }
        self.get(id).ok_or_else(|| UrlError::new("not_found", t!("url-no-fetch", id = id.to_string())))
    }

    /// Removes a download that is not running from the list, with its folder.
    pub fn forget(&self, id: &str) -> Result<(), UrlError> {
        let f = self.get(id).ok_or_else(|| UrlError::new("not_found", t!("url-no-fetch", id = id.to_string())))?;
        if f.status == FetchStatus::Downloading {
            return Err(UrlError::new("running", t!("url-cancel-first", id = id.to_string())));
        }
        self.forget_now(id);
        crate::events::send("fetch_removed", json!({ "id": id }));
        Ok(())
    }

    fn forget_now(&self, id: &str) {
        self.remove_dir(id);
        let mut list = lock(&self.inner.list);
        list.retain(|f| f.id != id);
        self.save(&list);
    }

    fn remove_dir(&self, id: &str) {
        let dir = self.dir(id);
        if dir.is_dir()
            && let Err(e) = std::fs::remove_dir_all(&dir)
        {
            tracing::warn!("the folder of download {id}, {}, was not removed: {e}", dir.display());
        }
    }

    /// The window made media items of the file: it is recorded and its folder goes.
    pub fn imported(&self, id: &str, media: Vec<String>) -> Result<Fetch, UrlError> {
        let fetch = {
            let mut list = lock(&self.inner.list);
            let f = list.iter_mut().find(|f| f.id == id).ok_or_else(|| UrlError::new("not_found", t!("url-no-fetch", id = id.to_string())))?;
            f.imported = media;
            f.file = None;
            f.updated_at = ytdlp::now_s();
            let fetch = f.clone();
            self.save(&list);
            fetch
        };
        self.remove_dir(id);
        Self::tell(&fetch);
        Ok(fetch)
    }

    /// The finished file, for the window to import.
    pub fn file(&self, id: &str) -> Option<(PathBuf, String)> {
        let f = self.get(id)?;
        Some((self.dir(id).join(f.file?), f.mime.unwrap_or_else(|| "application/octet-stream".into())))
    }

    /// Old finished downloads leave the list with their folders; running ones always stay.
    fn evict(&self, list: &mut Vec<Fetch>) {
        while list.len() > KEEP {
            let Some(at) = list.iter().rposition(|f| f.status != FetchStatus::Downloading) else { break };
            let old = list.remove(at);
            self.remove_dir(&old.id);
        }
    }

    fn spawn(&self, id: &str, tool: ytdlp::Tool) -> Result<(), UrlError> {
        let stop = Arc::new(AtomicBool::new(false));
        lock(&self.inner.stops).insert(id.to_string(), stop.clone());
        let me = self.clone();
        let job = id.to_string();
        std::thread::Builder::new().name("url-fetch".into()).spawn(move || me.run(&job, tool, stop)).map(|_| ()).map_err(|e| {
            let error = UrlError::new("io", t!("url-thread-failed", error = e.to_string()));
            self.finish(id, Err(error.clone()), false);
            error
        })
    }

    fn run(&self, id: &str, tool: ytdlp::Tool, stop: Arc<AtomicBool>) {
        let res = self.run_steps(id, &tool, &stop);
        self.finish(id, res, stop.load(Ordering::SeqCst));
    }

    /// A download's end. A stopped one removes its folder; a failed one keeps it, for resuming to go on from.
    fn finish(&self, id: &str, res: Result<(PathBuf, String), UrlError>, stopped: bool) {
        lock(&self.inner.stops).remove(id);
        let mut list = lock(&self.inner.list);
        let Some(f) = list.iter_mut().find(|f| f.id == id) else { return };
        f.speed_bps = 0;
        f.eta_s = None;
        f.updated_at = ytdlp::now_s();
        let cancelled = stopped || res.as_ref().is_err_and(|e| e.code == "cancelled");
        let mut remove = false;
        match res {
            Ok((file, mime)) => {
                f.file = file.file_name().map(|name| name.to_string_lossy().into_owned());
                f.mime = Some(mime);
                f.downloaded = f.total.unwrap_or(f.downloaded).max(f.downloaded);
                f.phase = "done".into();
                f.status = FetchStatus::Completed;
            }
            Err(_) if cancelled => {
                f.status = FetchStatus::Cancelled;
                remove = true;
            }
            Err(e) => {
                tracing::warn!("link download {}: {} ({})", f.url, e.detail, e.code);
                f.status = FetchStatus::Failed;
                f.hint = Some(e.hint().into());
                f.error_code = Some(e.code.into());
                f.error = Some(e.detail);
            }
        }
        let fetch = f.clone();
        self.save(&list);
        drop(list);
        // the proxy password lives in the settings, not in the download's folder: proxy.conf is written again each run
        let conf = self.dir(id).join(ytdlp::PROXY_CONF);
        match std::fs::remove_file(&conf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::error!("[ERROR] {} with the proxy password was not removed: {e}", conf.display()),
        }
        if remove {
            self.remove_dir(id);
        }
        Self::tell(&fetch);
    }

    fn run_steps(&self, id: &str, tool: &ytdlp::Tool, stop: &Arc<AtomicBool>) -> Result<(PathBuf, String), UrlError> {
        let fetch = self.get(id).ok_or_else(|| UrlError::new("not_found", id.to_string()))?;
        let dir = self.dir(id);
        std::fs::create_dir_all(&dir).map_err(|e| UrlError::new("io", format!("{}: {e}", dir.display())))?;
        let cookies = dir.join("cookies.txt");
        let with_cookies = |cmd: &mut std::process::Command| {
            if fetch.cookies {
                cmd.arg("--cookies").arg(&cookies);
            }
        };
        if fetch.cookies && !cookies.is_file() {
            return Err(UrlError::new("cookies_invalid", t!("url-cookies-gone")));
        }

        // the probe: fresh format addresses (YouTube's live for hours), the title, the size
        self.update(id, |f| f.phase = "probe".into());
        let mut cmd = tool.command(&fetch.url, &dir)?;
        cmd.args(ytdlp::PROBE_ARGS).args(fetch.quality.args());
        with_cookies(&mut cmd);
        cmd.arg("--").arg(&fetch.url);
        let stop_probe = stop.clone();
        let out = ytdlp::run_captured(cmd, &move || stop_probe.load(Ordering::SeqCst), Some(PROBE_TIMEOUT))?;
        if !out.success {
            return Err(ytdlp::classify(&out.stderr));
        }
        let info: Value = serde_json::from_slice(&out.stdout).map_err(|e| UrlError::new("ytdlp_failed", t!("url-probe-not-json", error = e.to_string(), stderr = ytdlp::last_error_line(&out.stderr))))?;
        let probe = ytdlp::parse_probe(&info)?;
        let info_path = dir.join("info.json");
        std::fs::write(&info_path, &out.stdout).map_err(|e| UrlError::new("io", format!("{}: {e}", info_path.display())))?;
        let expected = probe.expected_bytes;
        // merging picture and sound keeps both parts and the result on disk
        if let (Some(need), Some(free)) = (expected, crate::tools::free_bytes(&dir))
            && free < need.saturating_mul(2)
        {
            return Err(UrlError::new("disk_space", t!("url-disk-space", need = need * 2 / 1_000_000, free = free / 1_000_000)));
        }
        self.update(id, |f| {
            f.title = Some(probe.title.clone());
            f.duration = probe.duration;
            f.total = expected;
            f.phase = "download".into();
        });

        // the download from that description: the formats are not chosen again from another page; the folder goes
        // through -P, since a % in its path would read as a field in the -o template
        let mut cmd = tool.command(&fetch.url, &dir)?;
        cmd.arg("--load-info-json").arg(&info_path).args(fetch.quality.args());
        cmd.arg("-P").arg(&dir).args(["-o", "source.%(ext)s"]);
        with_cookies(&mut cmd);
        cmd.args(["--newline", "--progress", "--progress-template", ytdlp::PROGRESS_TEMPLATE, "--progress-template", ytdlp::POSTPROCESS_TEMPLATE, "--print", ytdlp::FILE_TEMPLATE]);
        let (media, stderr) = self.download(id, cmd, expected, stop)?;
        if stop.load(Ordering::SeqCst) {
            return Err(UrlError::new("cancelled", t!("url-stopped")));
        }
        let media = match media.filter(|p| p.is_file()) {
            Some(p) => p,
            None => find_media(&dir).ok_or_else(|| UrlError::new("ytdlp_failed", t!("url-no-media-file", path = dir.display().to_string(), stderr = ytdlp::last_error_line(&stderr))))?,
        };
        // the window imports it under the video's title
        let named = dir.join(format!("{}.{}", file_name(&probe.title), media.extension().and_then(|ext| ext.to_str()).unwrap_or("mp4")));
        std::fs::rename(&media, &named).map_err(|e| UrlError::new("io", format!("{}: {e}", named.display())))?;
        let mime = mime_of(&named);
        Ok((named, mime))
    }

    /// Runs yt-dlp's download and follows its progress lines. Returns the final file and stderr.
    fn download(&self, id: &str, mut cmd: std::process::Command, expected: Option<u64>, stop: &Arc<AtomicBool>) -> Result<(Option<PathBuf>, String), UrlError> {
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| UrlError::new("io", t!("url-ytdlp-start", error = e.to_string())))?;
        let pid = child.id();
        let (tx, rx) = mpsc::channel::<(bool, String)>();
        let readers: Vec<_> = [child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>)]
            .into_iter()
            .enumerate()
            .filter_map(|(i, pipe)| {
                let tx = tx.clone();
                pipe.map(|p| {
                    ytdlp::lines_of(p, move |line| {
                        let _ = tx.send((i == 1, line.to_string()));
                    })
                })
            })
            .collect();
        drop(tx);
        let mut streams = ytdlp::Streams::default();
        let mut file: Option<PathBuf> = None;
        let mut stderr: Vec<String> = Vec::new();
        let mut killed = false;
        let mut handle = |is_err: bool, line: String, streams: &mut ytdlp::Streams| match ytdlp::parse_line(&line) {
            Line::Progress(p) => {
                let (done, total) = streams.apply(&p, expected);
                self.update(id, |f| {
                    f.downloaded = done;
                    f.total = total;
                    f.speed_bps = p.speed.map_or(0, |s| s as u64);
                    f.eta_s = p.eta;
                    f.phase = "download".into();
                });
            }
            Line::Post(state, name) if state == "started" => {
                let phase = match name.as_str() {
                    // yt-dlp's processor names drop FFmpeg and PP: FFmpegMergerPP is Merger
                    "Merger" => "merge",
                    "ExtractAudio" => "extract",
                    _ => return,
                };
                self.update(id, |f| {
                    f.phase = phase.into();
                    f.speed_bps = 0;
                    f.eta_s = None;
                });
            }
            Line::File(p) => file = Some(p),
            Line::Post(..) => {}
            Line::Other => {
                if is_err && !line.trim().is_empty() {
                    stderr.push(line);
                    if stderr.len() > 200 {
                        stderr.remove(0);
                    }
                }
            }
        };
        let status = loop {
            while let Ok((is_err, line)) = rx.try_recv() {
                handle(is_err, line, &mut streams);
            }
            match child.try_wait() {
                Ok(Some(st)) => break st,
                Ok(None) => {}
                Err(e) => {
                    ytdlp::kill_tree(pid);
                    return Err(UrlError::new("io", t!("url-ytdlp-wait", error = e.to_string())));
                }
            }
            if !killed && stop.load(Ordering::SeqCst) {
                ytdlp::kill_tree(pid);
                killed = true;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        for r in readers {
            let _ = r.join();
        }
        while let Ok((is_err, line)) = rx.try_recv() {
            handle(is_err, line, &mut streams);
        }
        let stderr = stderr.join("\n");
        if killed {
            return Err(UrlError::new("cancelled", t!("url-stopped")));
        }
        if !status.success() {
            return Err(ytdlp::classify(&stderr));
        }
        Ok((file, stderr))
    }

    /// What a link is before it is downloaded, with its preview as a picture.
    pub async fn probe(&self, url: &str, cookies: Option<Cookies>) -> Result<Value, UrlError> {
        let url = check_url(url)?;
        let tool = ytdlp::tool(&self.inner.data)?;
        ytdlp::update_in_background_if_due(&self.inner.data);
        let work = self.inner.root.join(format!("probe-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]));
        std::fs::create_dir_all(&work).map_err(|e| UrlError::new("io", format!("{}: {e}", work.display())))?;
        let cookies_path = work.join("cookies.txt");
        let result = async {
            if let Some(c) = &cookies {
                place_cookies(c, &cookies_path)?;
            }
            let mut cmd = tool.command(&url, &work)?;
            cmd.args(ytdlp::PROBE_ARGS).args(Quality::Best.args());
            if cookies.is_some() {
                cmd.arg("--cookies").arg(&cookies_path);
            }
            cmd.arg("--").arg(&url);
            let out = tokio::task::spawn_blocking(move || ytdlp::run_captured(cmd, &|| false, Some(PROBE_TIMEOUT))).await.map_err(|e| UrlError::new("io", e.to_string()))??;
            if !out.success {
                return Err(ytdlp::classify(&out.stderr));
            }
            let info: Value = serde_json::from_slice(&out.stdout).map_err(|e| UrlError::new("ytdlp_failed", t!("url-probe-not-json", error = e.to_string(), stderr = ytdlp::last_error_line(&out.stderr))))?;
            let probe = ytdlp::parse_probe(&info)?;
            let picture = match &probe.thumbnail {
                Some(thumbnail) => ytdlp::thumbnail_data(thumbnail).await.map_err(|e| tracing::warn!("the preview of {url} was not read: {e}")).ok(),
                None => None,
            };
            let mut value = serde_json::to_value(&probe).map_err(|e| UrlError::new("io", e.to_string()))?;
            value["thumbnail_data"] = json!(picture);
            Ok(value)
        }
        .await;
        if let Err(e) = std::fs::remove_dir_all(&work) {
            tracing::warn!("the probe folder {} was not removed: {e}", work.display());
        }
        result
    }
}

/// A title as a file name: without what Windows refuses in a name.
fn file_name(title: &str) -> String {
    let clean: String = title.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(120).collect();
    let clean = clean.trim_end_matches(['.', ' ']);
    if clean.is_empty() { "video".to_string() } else { clean.to_string() }
}

// ---------------------------------------------------------------- routes

fn refuse(error: UrlError) -> Response {
    let status = match error.code {
        "not_found" => StatusCode::NOT_FOUND,
        "busy" | "running" => StatusCode::CONFLICT,
        "tool_missing" | "unsupported_os" => StatusCode::PRECONDITION_FAILED,
        "io" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    };
    (status, Json(error.to_json())).into_response()
}

#[derive(Deserialize)]
struct ProbeBody {
    url: String,
    #[serde(default)]
    cookies_text: Option<String>,
    #[serde(default)]
    cookies_path: Option<String>,
}

#[derive(Deserialize)]
struct FetchBody {
    url: String,
    #[serde(default = "best")]
    quality: String,
    project_id: String,
    #[serde(default)]
    cookies_text: Option<String>,
    #[serde(default)]
    cookies_path: Option<String>,
}

fn best() -> String {
    "best".into()
}

fn cookies_of(text: Option<String>, path: Option<String>) -> Option<Cookies> {
    text.filter(|text| !text.trim().is_empty()).map(Cookies::Text).or_else(|| path.filter(|path| !path.trim().is_empty()).map(|path| Cookies::Path(PathBuf::from(path))))
}

#[derive(Deserialize)]
struct ImportedBody {
    media: Vec<String>,
}

async fn tool_status(State(state): State<AppState>) -> Json<Value> {
    Json(crate::tools::status(&state.data))
}

async fn tool_install(State(state): State<AppState>) -> Response {
    if let Err(e) = crate::tools::ready(&state.data).or_else(|e| if e.code == "tool_missing" { Ok(()) } else { Err(e) }) {
        return refuse(e);
    }
    let started = crate::tools::start_install(&state.data);
    Json(json!({ "started": started, "status": crate::tools::status(&state.data) })).into_response()
}

async fn tool_update(State(state): State<AppState>) -> Response {
    if let Err(e) = crate::tools::ready(&state.data) {
        return refuse(e);
    }
    let started = ytdlp::start_update(&state.data);
    Json(json!({ "started": started, "status": crate::tools::status(&state.data) })).into_response()
}

async fn probe(State(state): State<AppState>, Json(body): Json<ProbeBody>) -> Response {
    match state.fetches.probe(&body.url, cookies_of(body.cookies_text, body.cookies_path)).await {
        Ok(probe) => Json(probe).into_response(),
        Err(e) => refuse(e),
    }
}

async fn create(State(state): State<AppState>, Json(body): Json<FetchBody>) -> Response {
    let Some(quality) = Quality::parse(&body.quality) else { return refuse(UrlError::new("bad_quality", t!("url-bad-quality", quality = body.quality))) };
    match state.fetches.start(&body.url, quality, &body.project_id, cookies_of(body.cookies_text, body.cookies_path)) {
        Ok(fetch) => Json(fetch).into_response(),
        Err(e) => refuse(e),
    }
}

async fn list(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "fetches": state.fetches.list() }))
}

async fn get_one(State(state): State<AppState>, AxPath(id): AxPath<String>) -> Response {
    match state.fetches.get(&id) {
        Some(fetch) => Json(fetch).into_response(),
        None => refuse(UrlError::new("not_found", t!("url-no-fetch", id = id))),
    }
}

async fn cancel(State(state): State<AppState>, AxPath(id): AxPath<String>) -> Response {
    state.fetches.cancel(&id).map(|fetch| Json(fetch).into_response()).unwrap_or_else(refuse)
}

async fn resume(State(state): State<AppState>, AxPath(id): AxPath<String>) -> Response {
    state.fetches.resume(&id).map(|fetch| Json(fetch).into_response()).unwrap_or_else(refuse)
}

async fn forget(State(state): State<AppState>, AxPath(id): AxPath<String>) -> Response {
    state.fetches.forget(&id).map(|()| StatusCode::NO_CONTENT.into_response()).unwrap_or_else(refuse)
}

async fn imported(State(state): State<AppState>, AxPath(id): AxPath<String>, Json(body): Json<ImportedBody>) -> Response {
    state.fetches.imported(&id, body.media).map(|fetch| Json(fetch).into_response()).unwrap_or_else(refuse)
}

async fn file(State(state): State<AppState>, AxPath(id): AxPath<String>) -> Response {
    let Some((path, mime)) = state.fetches.file(&id) else { return refuse(UrlError::new("not_found", t!("url-no-fetch", id = id))) };
    match tokio::fs::File::open(&path).await {
        Ok(file) => ([(header::CONTENT_TYPE, mime)], Body::from_stream(tokio_util::io::ReaderStream::new(file))).into_response(),
        Err(e) => refuse(UrlError::new("not_found", format!("{}: {e}", path.display()))),
    }
}

pub fn router() -> Router<AppState> {
    use axum::routing::{get, post};
    Router::new()
        .route("/api/url/tool", get(tool_status))
        .route("/api/url/tool/install", post(tool_install))
        .route("/api/url/tool/update", post(tool_update))
        .route("/api/url/probe", post(probe))
        .route("/api/url/fetches", get(list).post(create))
        .route("/api/url/fetches/{id}", get(get_one).delete(forget))
        .route("/api/url/fetches/{id}/cancel", post(cancel))
        .route("/api/url/fetches/{id}/resume", post(resume))
        .route("/api/url/fetches/{id}/imported", post(imported))
        .route("/api/url/fetches/{id}/file", get(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_links_pass() {
        assert!(check_url("https://www.youtube.com/watch?v=abc").is_ok());
        assert_eq!(check_url("ftp://x/y").unwrap_err().code, "bad_url");
        assert_eq!(check_url("not a link").unwrap_err().code, "bad_url");
    }

    #[test]
    fn a_title_becomes_a_file_name() {
        assert_eq!(file_name("Кот: «закат»? / 4K"), "Кот «закат» 4K");
        assert_eq!(file_name("..."), "video");
    }

    #[test]
    fn a_download_cut_off_by_a_restart_is_interrupted_and_kept() {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().join("fetch");
        std::fs::create_dir_all(&root).unwrap();
        let fetch = Fetch {
            id: "url1".into(),
            url: "https://example.com/v".into(),
            quality: Quality::Best,
            cookies: false,
            project_id: "p".into(),
            status: FetchStatus::Downloading,
            phase: "download".into(),
            title: None,
            duration: None,
            downloaded: 10,
            total: Some(100),
            speed_bps: 5,
            eta_s: Some(3),
            file: None,
            mime: None,
            imported: Vec::new(),
            error_code: None,
            error: None,
            hint: None,
            tool_version: None,
            started_at: 1,
            updated_at: 1,
        };
        std::fs::write(root.join("fetches.json"), serde_json::to_vec(&json!({ "fetches": [fetch] })).unwrap()).unwrap();
        let fetches = Fetches::open(data.path());
        let got = fetches.get("url1").unwrap();
        assert_eq!((got.status, got.error_code.as_deref(), got.speed_bps), (FetchStatus::Interrupted, Some("interrupted"), 0));
        assert_eq!(Fetches::open(data.path()).get("url1").unwrap().status, FetchStatus::Interrupted, "and it is saved so");
    }
}
