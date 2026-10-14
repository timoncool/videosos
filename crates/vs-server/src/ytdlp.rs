//! yt-dlp: a video by its link, as Dub Studio takes one. The pinned yt-dlp comes with the `ytdlp` tool (tools.rs,
//! SHA-256 from its release's SHA2-256SUMS) together with deno: YouTube hands a video over only after its own
//! JS challenges are solved, and yt-dlp solves them with its built-in yt-dlp-ejs scripts in that deno. Sites break
//! old yt-dlp versions within weeks, so while links are used a new release is looked for once a day: it is
//! downloaded beside the pinned one (tools/yt-dlp/update), checked against its release's SHA2-256SUMS and has to
//! answer `--version` before it is used. A failure at any step leaves the previous one working.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The version of yt-dlp the `ytdlp` tool brings (tools.rs).
pub const PINNED_VERSION: &str = "2026.08.19";
const DIR: &str = "tools/yt-dlp";
/// The yt-dlp file on disk and the release asset it comes from (named the same in SHA2-256SUMS).
#[cfg(windows)]
pub(crate) const EXE: &str = "yt-dlp.exe";
#[cfg(windows)]
const ASSET: &str = "yt-dlp.exe";
#[cfg(not(windows))]
pub(crate) const EXE: &str = "yt-dlp";
#[cfg(target_os = "linux")]
const ASSET: &str = "yt-dlp_linux";
#[cfg(target_os = "macos")]
const ASSET: &str = "yt-dlp_macos";
const SUFFIX: &str = std::env::consts::EXE_SUFFIX;
#[cfg(windows)]
pub(crate) const DENO: &str = "deno.exe";
#[cfg(not(windows))]
pub(crate) const DENO: &str = "deno";
const UPDATES: &str = "update";
const RECORD: &str = "update.json";
const RELEASES_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const DOWNLOAD_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/download";
const CHECK_EVERY_S: u64 = 24 * 3600;
/// A new yt-dlp is never larger than this (about 18 MB now): a guard against an endless answer.
const EXE_LIMIT: u64 = 200 * 1024 * 1024;

// ---------------------------------------------------------------- errors

/// A failure of a link: a code (the window words it in its language) and the detail, yt-dlp's line or VideoSOS's
/// own reason.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UrlError {
    pub code: &'static str,
    pub detail: String,
}

impl UrlError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        UrlError { code, detail: detail.into() }
    }

    /// What to do, in English: an agent reads this instead of yt-dlp's raw stderr.
    pub fn hint(&self) -> &'static str {
        hint(self.code)
    }

    pub fn to_json(&self) -> Value {
        json!({ "error": self.code, "detail": self.detail, "hint": self.hint() })
    }
}

impl std::fmt::Display for UrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

pub fn hint(code: &str) -> &'static str {
    match code {
        "tool_missing" => "Install the link tool first (url_tool_install).",
        "unsupported_os" => "Links are downloaded on Windows and Linux.",
        "bad_url" => "Give a full http or https link to one video.",
        "bad_quality" => "quality is one of best, 1080, 720, 480, audio.",
        "unsupported_url" => "yt-dlp does not know this site or this is not a video page: give the link of the video itself.",
        "playlist" => "This is a playlist or a channel: give the link of one video.",
        "live" => "A live stream or a premiere that has not started cannot be downloaded: try again after it ends.",
        "geo_blocked" => "The site does not show this video in your country: set a proxy of a country where it is available (Settings, Network) and try again.",
        "age_restricted" => "The video is age-restricted: pass cookies.txt exported from a browser signed in to an adult account.",
        "login_required" => "The site wants a signed-in user: pass cookies.txt exported from a browser signed in to the site.",
        "private" => "The video is private: only a signed-in account it is shared with can get it, with its cookies.txt.",
        "members_only" => "The video is for the channel's members: pass cookies.txt of a member's signed-in browser.",
        "drm" => "The video is DRM-protected: it cannot be downloaded.",
        "unavailable" => "The video is removed or unavailable: check the link.",
        "rate_limited" => "The site limits requests from this address (429): wait, or pass cookies.txt, or use another proxy.",
        "proxy" => "The proxy does not answer: check it in Settings, Network, or switch it off.",
        "network" => "The site is not reachable: check the connection or the proxy.",
        "cookies_invalid" => "cookies.txt is not a Netscape cookies file: export it again with a cookies.txt browser extension.",
        "format_unavailable" => "No format of this quality: choose another quality.",
        "no_audio" => "The video has no sound track to take: choose a video quality instead of audio.",
        "outdated" => "This yt-dlp cannot read the site any more: update it (url_tool_update) and try again.",
        "disk_space" => "Not enough free space for the video: free some and try again.",
        "busy" => "This link is already downloading: wait for it (url_fetches_list).",
        "not_found" => "No such download: url_fetches_list shows them.",
        "running" => "The download is still running: cancel it first.",
        "interrupted" => "The download stopped with VideoSOS: url_fetch_resume continues it.",
        "update_failed" => "The new yt-dlp did not pass its check; the previous one stays in use.",
        "io" => "A file of VideoSOS could not be written: check the disk.",
        _ => "yt-dlp failed; its last message is in detail.",
    }
}

pub fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------- where it lives

fn dir(data: &Path) -> PathBuf {
    data.join(DIR)
}

pub fn pinned_exe(data: &Path) -> PathBuf {
    dir(data).join(EXE)
}

pub fn deno_exe(data: &Path) -> PathBuf {
    dir(data).join(DENO)
}

fn updates_dir(data: &Path) -> PathBuf {
    dir(data).join(UPDATES)
}

fn record_path(data: &Path) -> PathBuf {
    dir(data).join(RECORD)
}

fn dir_cache(data: &Path) -> PathBuf {
    dir(data).join("cache")
}

// ---------------------------------------------------------------- updates beside the pinned version

/// tools/yt-dlp/update.json: a checked newer version (if any) and when the releases were last looked at.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
struct UpdateRecord {
    version: Option<String>,
    file: Option<String>,
    sha256: Option<String>,
    size: Option<u64>,
    latest: Option<String>,
    checked_at: u64,
    last_error: Option<String>,
    #[serde(default)]
    last_error_code: Option<String>,
}

fn read_record(data: &Path) -> UpdateRecord {
    let path = record_path(data);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            tracing::warn!("{} is unreadable ({e}); yt-dlp updates are not taken into account", path.display());
            UpdateRecord::default()
        }),
        Err(_) => UpdateRecord::default(),
    }
}

fn write_record(data: &Path, rec: &UpdateRecord) -> Result<(), UrlError> {
    let body = serde_json::to_vec_pretty(rec).map_err(|e| UrlError::new("io", format!("update.json: {e}")))?;
    std::fs::create_dir_all(dir(data)).map_err(|e| UrlError::new("io", format!("{}: {e}", dir(data).display())))?;
    crate::tools::write_atomic(&record_path(data), &body).map_err(|e| UrlError::new("io", e))
}

/// A yt-dlp version as numbers: `2026.08.19` and `2026.08.19.1` compare in order.
fn version_key(v: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = v.trim().split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| (3..=4).contains(&p.len()))
}

fn newer(candidate: &str, than: &str) -> bool {
    match (version_key(candidate), version_key(than)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// The yt-dlp in use: the checked update while its file is whole, else the pinned one. `problem` says why an
/// update recorded as working was not taken.
struct Active {
    exe: PathBuf,
    version: String,
    updated: bool,
    problem: Option<String>,
}

fn active(data: &Path, rec: &UpdateRecord) -> Active {
    let pinned = Active { exe: pinned_exe(data), version: PINNED_VERSION.to_string(), updated: false, problem: None };
    let (Some(version), Some(file), Some(size)) = (&rec.version, &rec.file, rec.size) else { return pinned };
    // VideoSOS has since pinned a version no older than the update: it is only out of date
    if !newer(version, PINNED_VERSION) {
        return pinned;
    }
    let exe = updates_dir(data).join(file);
    let len = std::fs::metadata(&exe).map(|m| m.len()).ok();
    if len != Some(size) {
        let problem = t!("ytdlp-update-missing", version = version.clone(), path = exe.display().to_string(), pinned = PINNED_VERSION);
        return Active { problem: Some(problem), ..pinned };
    }
    Active { exe, version: version.clone(), updated: true, problem: None }
}

/// Whether an update runs right now (one per process).
fn updating() -> &'static AtomicBool {
    static U: AtomicBool = AtomicBool::new(false);
    &U
}

/// The tool's state for the window and the agent.
#[derive(Clone, Debug, Serialize)]
pub struct ToolStatus {
    pub version: String,
    pub pinned_version: String,
    pub updated: bool,
    pub latest: Option<String>,
    pub checked_at: u64,
    pub update_available: bool,
    pub updating: bool,
    pub last_error: Option<String>,
    pub last_error_code: Option<String>,
}

pub fn status(data: &Path) -> ToolStatus {
    let rec = read_record(data);
    let act = active(data, &rec);
    ToolStatus {
        update_available: rec.latest.as_deref().is_some_and(|l| newer(l, &act.version)),
        version: act.version,
        pinned_version: PINNED_VERSION.to_string(),
        updated: act.updated,
        latest: rec.latest.clone(),
        checked_at: rec.checked_at,
        updating: updating().load(Ordering::SeqCst),
        last_error_code: if act.problem.is_some() { Some("update_failed".into()) } else { rec.last_error_code.clone() },
        last_error: act.problem.or(rec.last_error),
    }
}

/// A check once a day, in the background: called where links are used (a probe, a download).
pub fn update_in_background_if_due(data: &Path) {
    let rec = read_record(data);
    if now_s().saturating_sub(rec.checked_at) < CHECK_EVERY_S || !pinned_exe(data).is_file() {
        return;
    }
    start_update(data);
}

/// Looks for an update and installs it in its own task. false when one already runs.
pub fn start_update(data: &Path) -> bool {
    if updating().swap(true, Ordering::SeqCst) {
        return false;
    }
    let data = data.to_path_buf();
    tokio::spawn(async move {
        if let Err(e) = update(&data).await {
            tracing::warn!("yt-dlp update: {e}");
        }
        updating().store(false, Ordering::SeqCst);
        crate::events::send("url_tool", json!({}));
    });
    true
}

/// A release tag fit for a file name and a URL path: digits and dots only.
fn valid_tag(tag: &str) -> bool {
    version_key(tag).is_some() && tag.bytes().all(|b| b.is_ascii_digit() || b == b'.')
}

/// The SHA-256 of `name` in a release's SHA2-256SUMS.
fn sum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.trim().split_once(char::is_whitespace)?;
        let file = file.trim().trim_start_matches('*');
        (file == name && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    })
}

/// Looks at the releases and installs a newer one beside the working one. The error stays in update.json and in
/// the status; a failed try counts as a check too, or an unreachable GitHub would be asked at every probe.
async fn update(data: &Path) -> Result<(), UrlError> {
    let mut rec = read_record(data);
    rec.checked_at = now_s();
    let res = update_with(data, &mut rec, RELEASES_API, DOWNLOAD_BASE).await;
    rec.last_error = res.as_ref().err().map(|e| e.detail.clone());
    rec.last_error_code = res.as_ref().err().map(|e| e.code.to_string());
    write_record(data, &rec)?;
    res
}

/// `api`: the latest release (GitHub API); `releases`: where a release's files are downloaded by tag.
async fn update_with(data: &Path, rec: &mut UpdateRecord, api: &str, releases: &str) -> Result<(), UrlError> {
    if !pinned_exe(data).is_file() {
        return Err(UrlError::new("tool_missing", t!("url-ytdlp-missing")));
    }
    let client = crate::tools::client(Duration::from_secs(300))?;
    let latest: Value = client
        .get(api)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "VideoSOS")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| UrlError::new("network", format!("{api}: {e}")))?
        .json()
        .await
        .map_err(|e| UrlError::new("network", format!("{api}: {e}")))?;
    let tag = latest["tag_name"].as_str().unwrap_or_default().to_string();
    if !valid_tag(&tag) {
        return Err(UrlError::new("update_failed", t!("ytdlp-tag-not-version", tag = tag.clone())));
    }
    rec.latest = Some(tag.clone());
    if rec.version.as_deref().is_some_and(|v| !newer(v, PINNED_VERSION)) {
        drop_stale_update(data, rec);
    }
    let current = active(data, rec);
    if !newer(&tag, &current.version) {
        return Ok(());
    }
    let sums_url = format!("{releases}/{tag}/SHA2-256SUMS");
    let sums = client
        .get(&sums_url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| UrlError::new("network", format!("{sums_url}: {e}")))?
        .text()
        .await
        .map_err(|e| UrlError::new("network", format!("{sums_url}: {e}")))?;
    let want = sum_for(&sums, ASSET).ok_or_else(|| UrlError::new("update_failed", t!("ytdlp-no-checksum", url = sums_url.clone(), file = ASSET)))?;
    let dir = updates_dir(data);
    std::fs::create_dir_all(&dir).map_err(|e| UrlError::new("io", format!("{}: {e}", dir.display())))?;
    let file = format!("yt-dlp-{tag}{SUFFIX}");
    let dest = dir.join(&file);
    let part = dir.join(format!("{file}.part"));
    let exe_url = format!("{releases}/{tag}/{ASSET}");
    let size = match crate::tools::fetch_verified(&client, &exe_url, &part, &want, EXE_LIMIT, &|_| {}).await {
        Ok(size) => size,
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(UrlError::new(if e.code == "network" { "network" } else { "update_failed" }, e.detail));
        }
    };
    std::fs::rename(&part, &dest).map_err(|e| UrlError::new("io", format!("{}: {e}", dest.display())))?;
    crate::tools::make_runnable(&dest).map_err(|e| UrlError::new("io", e))?;
    let probe = dest.clone();
    let said = tokio::task::spawn_blocking(move || run_version(&probe)).await.map_err(|e| UrlError::new("io", e.to_string()))?;
    if said.as_deref() != Ok(tag.as_str()) {
        let _ = std::fs::remove_file(&dest);
        let why = match said {
            Ok(v) => t!("ytdlp-new-says", tag = tag.clone(), said = v, current = current.version.clone()),
            Err(e) => t!("ytdlp-new-failed", tag = tag.clone(), error = e, current = current.version.clone()),
        };
        return Err(UrlError::new("update_failed", why));
    }
    rec.version = Some(tag);
    rec.file = Some(file.clone());
    rec.sha256 = Some(want);
    rec.size = Some(size);
    for old in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = old.file_name().to_string_lossy().into_owned();
        if name != file
            && let Err(e) = std::fs::remove_file(old.path())
        {
            tracing::warn!("the old yt-dlp update {} was not removed (held by a running download?): {e}", old.path().display());
        }
    }
    Ok(())
}

/// An update no newer than the pinned version leaves the record and the disk.
fn drop_stale_update(data: &Path, rec: &mut UpdateRecord) {
    if let Some(file) = rec.file.take() {
        let path = updates_dir(data).join(file);
        if path.is_file()
            && let Err(e) = std::fs::remove_file(&path)
        {
            tracing::warn!("the outdated yt-dlp update {} was not removed: {e}", path.display());
        }
    }
    rec.version = None;
    rec.sha256 = None;
    rec.size = None;
}

fn run_version(exe: &Path) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.arg("--version");
    let out = run_captured(cmd, &|| false, Some(Duration::from_secs(120))).map_err(|e| e.detail)?;
    if !out.success {
        return Err(t!("ytdlp-exit-code", code = format!("{:?}", out.code), stderr = last_error_line(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ---------------------------------------------------------------- running it

/// A yt-dlp ready to run: the working exe, deno and ffmpeg.
pub struct Tool {
    exe: PathBuf,
    deno: PathBuf,
    ffmpeg: PathBuf,
    cache: PathBuf,
    pub version: String,
}

pub fn tool(data: &Path) -> Result<Tool, UrlError> {
    crate::tools::ready(data)?;
    let act = active(data, &read_record(data));
    if let Some(problem) = &act.problem {
        tracing::warn!("{problem}");
    }
    Ok(Tool { exe: act.exe, deno: deno_exe(data), ffmpeg: crate::tools::ffmpeg_dir(data), cache: dir_cache(data), version: act.version })
}

impl Tool {
    /// yt-dlp for one link: no config of others, our deno and ffmpeg, VideoSOS's proxy route for this link and
    /// UTF-8 output. Only `--encoding` sets the encoding: the PyInstaller exe ignores PYTHONIOENCODING/PYTHONUTF8
    /// and writes the system code page into a pipe. `work` is this call's folder: a proxy with a password goes
    /// there as a file (proxy_args).
    pub fn command(&self, url: &str, work: &Path) -> Result<Command, UrlError> {
        let mut cmd = Command::new(&self.exe);
        cmd.args(base_args(&self.deno, &self.ffmpeg, &self.cache)).args(proxy_args(vs_providers::net::proxy_url_for(url), work)?).stdin(Stdio::null());
        Ok(cmd)
    }
}

fn base_args(deno: &Path, ffmpeg: &Path, cache: &Path) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = ["--ignore-config", "--encoding", "utf-8", "--no-playlist", "--no-js-runtimes", "--js-runtimes"].map(Into::into).to_vec();
    args.push(format!("deno:{}", deno.display()).into());
    args.extend(["--ffmpeg-location".into(), ffmpeg.as_os_str().to_os_string(), "--cache-dir".into(), cache.as_os_str().to_os_string()]);
    args
}

/// A link's probe (`-J`): the entries of a list are not read, so a playlist or a channel comes back as a playlist
/// at once and is refused, not read video by video until the timeout. One video is not affected.
pub const PROBE_ARGS: [&str; 2] = ["-J", "--flat-playlist"];

/// The yt-dlp config file with this call's proxy.
pub(crate) const PROXY_CONF: &str = "proxy.conf";

/// The proxy of a link by VideoSOS's route: none is `--proxy ""`, straight past the Windows proxy; one without a
/// login is an argument; one with a login and password goes in `work/proxy.conf` through `--config-locations`
/// (`--ignore-config` does not switch it off): any program sees a process's command line, the file is in the
/// person's own download folder.
fn proxy_args(route: Option<reqwest::Url>, work: &Path) -> Result<Vec<std::ffi::OsString>, UrlError> {
    let Some(proxy) = route else {
        return Ok(vec!["--proxy".into(), "".into()]);
    };
    if proxy.password().is_none() && proxy.username().is_empty() {
        return Ok(vec!["--proxy".into(), proxy.to_string().into()]);
    }
    std::fs::create_dir_all(work).map_err(|e| UrlError::new("io", format!("{}: {e}", work.display())))?;
    let conf = work.join(PROXY_CONF);
    let quoted = proxy.as_str().replace('\\', "\\\\").replace('"', "\\\"");
    std::fs::write(&conf, format!("--proxy \"{quoted}\"\n")).map_err(|e| UrlError::new("io", format!("{}: {e}", conf.display())))?;
    Ok(vec!["--config-locations".into(), conf.into_os_string()])
}

/// How a process ended: its code, all of stdout, stderr as text.
pub struct Captured {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

/// Runs and waits, reading both streams; a stop (`stop`) or the timeout ends the whole process tree.
pub fn run_captured(mut cmd: Command, stop: &dyn Fn() -> bool, timeout: Option<Duration>) -> Result<Captured, UrlError> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| UrlError::new("io", t!("ytdlp-start", program = format!("{:?}", cmd.get_program()), error = e.to_string())))?;
    let pid = child.id();
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    });
    let err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let started = Instant::now();
    let mut killed: Option<&'static str> = None;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {}
            Err(e) => {
                kill_tree(pid);
                return Err(UrlError::new("io", t!("url-ytdlp-wait", error = e.to_string())));
            }
        }
        if killed.is_none() {
            if stop() {
                kill_tree(pid);
                killed = Some("cancelled");
            } else if timeout.is_some_and(|t| started.elapsed() > t) {
                kill_tree(pid);
                killed = Some("timeout");
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    match killed {
        Some("cancelled") => Err(UrlError::new("cancelled", t!("url-stopped"))),
        Some(_) => Err(UrlError::new("network", t!("ytdlp-timeout", seconds = timeout.unwrap_or_default().as_secs(), stderr = last_error_line(&stderr)))),
        None => Ok(Captured { success: status.success(), code: status.code(), stdout, stderr }),
    }
}

/// Ends a process with all its descendants: yt-dlp.exe is a PyInstaller loader that starts a child of its own,
/// which starts ffmpeg and deno. The descendants go first: the loader, once its child is gone, removes its
/// %TEMP%\_MEI* unpacking and exits; it is ended itself only if it has not within a couple of seconds.
pub fn kill_tree(pid: u32) {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let root = Pid::from_u32(pid);
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut family = vec![root];
    let mut i = 0;
    while i < family.len() {
        let parent = family[i];
        for (child, p) in sys.processes() {
            if p.parent() == Some(parent) && !family.contains(child) {
                family.push(*child);
            }
        }
        i += 1;
    }
    for p in family.iter().skip(1).rev() {
        if let Some(proc_) = sys.process(*p) {
            proc_.kill();
        }
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        sys.refresh_processes(ProcessesToUpdate::Some(&[root]), true);
        if sys.process(root).is_none() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if let Some(proc_) = sys.process(root) {
        proc_.kill();
    }
}

/// Reads a stream's lines as they come (yt-dlp prints its progress line by line with --newline).
pub fn lines_of(pipe: impl Read + Send + 'static, mut each: impl FnMut(&str) + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut raw = Vec::new();
        loop {
            raw.clear();
            match reader.read_until(b'\n', &mut raw) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&raw);
                    each(line.trim_end_matches(['\r', '\n']));
                }
            }
        }
    })
}

// ---------------------------------------------------------------- quality

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quality {
    #[serde(rename = "best")]
    Best,
    #[serde(rename = "1080")]
    H1080,
    #[serde(rename = "720")]
    H720,
    #[serde(rename = "480")]
    H480,
    #[serde(rename = "audio")]
    Audio,
}

impl Quality {
    pub const ALL: [Quality; 5] = [Quality::Best, Quality::H1080, Quality::H720, Quality::H480, Quality::Audio];

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|q| q.as_str() == text.trim())
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Quality::Best => "best",
            Quality::H1080 => "1080",
            Quality::H720 => "720",
            Quality::H480 => "480",
            Quality::Audio => "audio",
        }
    }

    fn height(self) -> Option<u32> {
        match self {
            Quality::H1080 => Some(1080),
            Quality::H720 => Some(720),
            Quality::H480 => Some(480),
            _ => None,
        }
    }

    /// yt-dlp's format choice. A height ceiling with `?` also takes formats of unknown height (direct files);
    /// nothing under the ceiling takes the lowest there is (yt-dlp README's recipe), not silently the best.
    pub fn selector(self) -> String {
        match (self, self.height()) {
            (Quality::Audio, _) => "ba/b".to_string(),
            (_, Some(h)) => format!("bv*[height<=?{h}]+ba/b[height<=?{h}]/wv*+ba/w"),
            _ => "bv*+ba/b".to_string(),
        }
    }

    /// The choice and assembly: a video is merged into mp4, a sound is taken out of its container as it is.
    pub fn args(self) -> Vec<String> {
        let mut args = vec!["-f".to_string(), self.selector()];
        if self == Quality::Audio {
            args.push("-x".into());
        } else {
            args.extend(["--merge-output-format".to_string(), "mp4".to_string()]);
        }
        args
    }
}

// ---------------------------------------------------------------- the probe (-J)

/// What is known of a link before it is downloaded.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Probe {
    pub url: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub extractor: Option<String>,
    /// The highest video height among the formats (null when the site does not say, as for a direct file).
    pub max_height: Option<u64>,
    pub has_video: bool,
    pub has_audio: bool,
    /// The qualities worth offering.
    pub qualities: Vec<&'static str>,
    /// How many bytes the choice takes (the formats' sum, when the site names them).
    pub expected_bytes: Option<u64>,
}

fn num(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_f64().filter(|x| x.is_finite() && *x >= 0.0).map(|x| x.round() as u64))
}

fn format_bytes(f: &Value) -> Option<u64> {
    num(&f["filesize"]).or_else(|| num(&f["filesize_approx"]))
}

/// Bytes to download: the formats' sum when each is named, else the entry's own size.
pub fn expected_bytes(info: &Value) -> Option<u64> {
    if let Some(parts) = info["requested_formats"].as_array().filter(|p| !p.is_empty()) {
        return parts.iter().map(format_bytes).sum();
    }
    format_bytes(info)
}

/// Reads `yt-dlp -J`'s answer. A playlist, a channel and a live stream are refused with their code.
pub fn parse_probe(info: &Value) -> Result<Probe, UrlError> {
    match info["_type"].as_str() {
        Some("playlist") | Some("multi_video") => {
            let n = info["entries"].as_array().map_or(0, Vec::len);
            return Err(UrlError::new("playlist", t!("ytdlp-playlist", count = n)));
        }
        Some("url") | Some("url_transparent") => {
            return Err(UrlError::new("unsupported_url", t!("ytdlp-redirect-only")));
        }
        _ => {}
    }
    if info["is_live"] == true || matches!(info["live_status"].as_str(), Some("is_live") | Some("is_upcoming")) {
        return Err(UrlError::new("live", t!("ytdlp-live", status = info["live_status"].as_str().unwrap_or("is_live").to_string())));
    }
    let formats = info["formats"].as_array().cloned().unwrap_or_default();
    // a null codec is one the site did not name (a direct file): such a format may carry both picture and sound;
    // the *_ext fields do not help, yt-dlp writes audio_ext "none" for a direct mp4 that has sound
    let known = |f: &Value, key: &str| f[key].as_str().map(|c| c != "none");
    let has_video = formats.is_empty() || formats.iter().any(|f| known(f, "vcodec") != Some(false));
    let has_audio = formats.is_empty() || formats.iter().any(|f| known(f, "acodec") != Some(false));
    let max_height = formats.iter().filter(|f| known(f, "vcodec") != Some(false)).filter_map(|f| num(&f["height"])).max();
    let mut qualities = Vec::new();
    if has_video {
        qualities.push("best");
        for q in [Quality::H1080, Quality::H720, Quality::H480] {
            if max_height.is_some_and(|m| m > u64::from(q.height().unwrap_or(0))) {
                qualities.push(q.as_str());
            }
        }
    }
    if has_audio {
        qualities.push("audio");
    }
    let title = info["title"].as_str().or_else(|| info["fulltitle"].as_str()).unwrap_or_default().trim().to_string();
    Ok(Probe {
        url: info["webpage_url"].as_str().or_else(|| info["original_url"].as_str()).unwrap_or_default().to_string(),
        title: if title.is_empty() { info["id"].as_str().unwrap_or("video").to_string() } else { title },
        duration: info["duration"].as_f64(),
        thumbnail: pick_thumbnail(info),
        uploader: info["uploader"].as_str().or_else(|| info["channel"].as_str()).map(str::to_string),
        extractor: info["extractor_key"].as_str().or_else(|| info["extractor"].as_str()).map(str::to_string),
        max_height,
        has_video,
        has_audio,
        qualities,
        expected_bytes: expected_bytes(info),
    })
}

/// The preview closest to 480 px wide (a card needs no more, and maxres weighs hundreds of KB), else the main one.
fn pick_thumbnail(info: &Value) -> Option<String> {
    let listed = info["thumbnails"].as_array().into_iter().flatten().filter_map(|t| Some((t["url"].as_str()?, num(&t["width"])?)));
    listed
        .min_by_key(|(_, w)| w.abs_diff(480))
        .map(|(u, _)| u.to_string())
        .or_else(|| info["thumbnail"].as_str().map(str::to_string))
        .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
}

/// The preview as a data: picture through VideoSOS's proxy route: the window does not go out to the internet itself.
pub async fn thumbnail_data(url: &str) -> Result<String, String> {
    use base64::Engine;
    let client = crate::tools::client(Duration::from_secs(20)).map_err(|e| e.detail)?;
    let resp = client.get(url).send().await.and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?;
    let mime = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or_default().trim().to_string())
        .unwrap_or_default();
    if !mime.starts_with("image/") {
        return Err(t!("ytdlp-thumbnail-not-image", mime = mime.to_string()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(t!("ytdlp-thumbnail-too-large"));
    }
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

// ---------------------------------------------------------------- progress lines

/// The templates of the lines yt-dlp prints while downloading (`--progress-template`, `--print`).
pub const PROGRESS_TEMPLATE: &str = "download:VSPROG %(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s";
pub const POSTPROCESS_TEMPLATE: &str = "postprocess:VSPP %(progress.status)s|%(progress.postprocessor)s";
pub const FILE_TEMPLATE: &str = "after_move:VSFILE %(filepath)s";

#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub status: String,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
    pub format_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Line {
    Progress(Progress),
    /// Post-processing: (started|finished, the processor: Merger, ExtractAudio, MoveFiles...).
    Post(String, String),
    File(PathBuf),
    Other,
}

fn field(v: &str) -> Option<&str> {
    let v = v.trim();
    (!v.is_empty() && v != "NA" && v != "None").then_some(v)
}

pub fn parse_line(line: &str) -> Line {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("VSPROG ") {
        let f: Vec<&str> = rest.split('|').collect();
        let get = |i: usize| f.get(i).copied().and_then(field);
        let int = |i: usize| get(i).and_then(|v| v.parse::<f64>().ok()).filter(|x| x.is_finite() && *x >= 0.0).map(|x| x.round() as u64);
        return Line::Progress(Progress {
            status: get(0).unwrap_or("downloading").to_string(),
            downloaded: int(1),
            total: int(2).or_else(|| int(3)),
            speed: get(4).and_then(|v| v.parse::<f64>().ok()).filter(|x| x.is_finite() && *x >= 0.0),
            eta: int(5),
            format_id: get(6).map(str::to_string),
        });
    }
    if let Some(rest) = line.strip_prefix("VSPP ") {
        let (status, name) = rest.split_once('|').unwrap_or((rest, ""));
        return Line::Post(status.trim().to_string(), name.trim().to_string());
    }
    if let Some(path) = line.strip_prefix("VSFILE ") {
        return Line::File(PathBuf::from(path.trim()));
    }
    Line::Other
}

// ---------------------------------------------------------------- yt-dlp's errors in words

/// The last `ERROR:` line (or the last non-empty one), without the prefix and the FAQ links.
pub fn last_error_line(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let line = lines.iter().rev().find(|l| l.starts_with("ERROR:")).or(lines.last()).copied().unwrap_or_default();
    let line = line.trim_start_matches("ERROR:").trim();
    line.split(" See  https://").next().unwrap_or(line).chars().take(600).collect()
}

/// The error code by yt-dlp's words. The order matters: a proxy before the network, a cookies file before "sign in".
pub fn classify(stderr: &str) -> UrlError {
    let detail = last_error_line(stderr);
    let text = if detail.is_empty() { stderr.to_lowercase() } else { detail.to_lowercase() };
    let has = |needles: &[&str]| needles.iter().any(|n| text.contains(n));
    let code = if has(&["does not look like a netscape format cookies file", "failed to load cookies"]) {
        "cookies_invalid"
    } else if has(&["no space left on device", "errno 28", "not enough space"]) {
        "disk_space"
    } else if has(&["unable to connect to proxy", "proxyerror", "proxy error", "tunnel connection failed"]) {
        "proxy"
    } else if has(&["javascript runtime", "js runtime", "challenge solving failed", "signature extraction failed", "nsig", "n challenge"]) {
        "outdated"
    } else if has(&["drm protected", "drm-protected", "is drm"]) {
        "drm"
    } else if has(&["not available in your country", "not made this video available in your country", "geo restrict", "geo-restrict", "not available from your location", "blocked it in your country", "not available in your region"]) {
        "geo_blocked"
    } else if has(&["confirm your age", "age-restricted", "age restricted", "inappropriate for some users", "age verification"]) {
        "age_restricted"
    } else if has(&["private video", "video is private", "this video has been made private"]) {
        "private"
    } else if has(&["members-only", "members only", "join this channel", "available to this channel's members"]) {
        "members_only"
    } else if has(&["http error 429", "too many requests"]) {
        "rate_limited"
    } else if has(&["sign in to confirm", "use --cookies", "--cookies-from-browser", "login required", "logged-in", "logged in", "requires authentication", "account credentials", "--username"]) {
        "login_required"
    } else if has(&["live event will begin", "premieres in", "this live event", "is not live yet"]) {
        "live"
    } else if has(&["unsupported url"]) {
        "unsupported_url"
    } else if has(&["requested format is not available"]) {
        "format_unavailable"
    } else if has(&["unable to obtain file audio codec"]) {
        "no_audio"
    } else if has(&["video unavailable", "has been removed", "no longer available", "http error 404", "not found", "does not exist", "been terminated"]) {
        "unavailable"
    } else if has(&["timed out", "getaddrinfo", "connection refused", "connection reset", "transporterror", "failed to resolve", "name resolution", "winerror 100", "ssl:", "network is unreachable", "remote end closed"]) {
        "network"
    } else if has(&["unable to extract", "please report this issue"]) {
        "outdated"
    } else if has(&["unable to download"]) {
        "network"
    } else {
        "ytdlp_failed"
    };
    UrlError::new(code, if detail.is_empty() { t!("ytdlp-failed-silently") } else { detail })
}

/// Progress over several streams (picture and sound are downloaded in turn, each with its own counter).
#[derive(Clone, Debug, Default)]
pub struct Streams {
    /// (format_id, downloaded, total) in the order they came.
    parts: Vec<(String, u64, u64)>,
}

impl Streams {
    /// Takes a progress line in; returns (downloaded in all, all bytes when known).
    pub fn apply(&mut self, p: &Progress, expected: Option<u64>) -> (u64, Option<u64>) {
        let id = p.format_id.clone().unwrap_or_default();
        let at = match self.parts.iter().position(|(f, _, _)| *f == id) {
            Some(i) => i,
            None => {
                self.parts.push((id, 0, 0));
                self.parts.len() - 1
            }
        };
        let part = &mut self.parts[at];
        if let Some(d) = p.downloaded {
            part.1 = d;
        }
        if let Some(t) = p.total {
            part.2 = t;
        }
        if p.status == "finished" {
            part.2 = part.2.max(part.1);
            part.1 = part.2;
        }
        let done: u64 = self.parts.iter().map(|(_, d, _)| *d).sum();
        let seen: u64 = self.parts.iter().map(|(_, d, t)| (*t).max(*d)).sum();
        let total = expected.map(|e| e.max(seen)).or((seen > 0).then_some(seen));
        (done, total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_is_read() {
        let info = json!({
            "id": "abc", "title": "Клип", "duration": 125.5, "webpage_url": "https://www.youtube.com/watch?v=abc",
            "uploader": "Chan", "extractor_key": "Youtube",
            "thumbnail": "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
            "thumbnails": [{ "url": "https://i.ytimg.com/vi/abc/default.jpg", "width": 120 }, { "url": "https://i.ytimg.com/vi/abc/hq.jpg", "width": 480 }, { "url": "https://i.ytimg.com/vi/abc/max.jpg", "width": 1280 }],
            "formats": [
                { "format_id": "140", "vcodec": "none", "acodec": "mp4a.40.2", "filesize": 2000 },
                { "format_id": "137", "vcodec": "avc1", "acodec": "none", "height": 1080, "filesize": 9000 },
                { "format_id": "136", "vcodec": "avc1", "acodec": "none", "height": 720 },
            ],
            "requested_formats": [{ "format_id": "137", "filesize": 9000 }, { "format_id": "140", "filesize_approx": 2000.4 }],
        });
        let p = parse_probe(&info).unwrap();
        assert_eq!(p.title, "Клип");
        assert_eq!(p.max_height, Some(1080));
        assert_eq!(p.qualities, vec!["best", "720", "480", "audio"], "1080 = best when the video tops at 1080");
        assert_eq!(p.expected_bytes, Some(11_000));
        assert_eq!(p.thumbnail.as_deref(), Some("https://i.ytimg.com/vi/abc/hq.jpg"));
    }

    #[test]
    fn a_direct_file_without_heights_offers_best_and_audio() {
        let info = json!({ "id": "clip", "title": "clip", "formats": [{ "format_id": "mp4", "ext": "mp4", "vcodec": null, "acodec": null, "video_ext": "mp4", "audio_ext": "none" }], "filesize_approx": 991017 });
        let p = parse_probe(&info).unwrap();
        assert_eq!((p.max_height, p.qualities.clone()), (None, vec!["best", "audio"]));
        assert_eq!(p.expected_bytes, Some(991_017));
    }

    #[test]
    fn a_playlist_and_a_live_stream_are_refused() {
        assert_eq!(parse_probe(&json!({ "_type": "playlist", "entries": [{}, {}] })).unwrap_err().code, "playlist");
        assert_eq!(parse_probe(&json!({ "title": "x", "live_status": "is_live" })).unwrap_err().code, "live");
        assert_eq!(parse_probe(&json!({ "title": "x", "live_status": "is_upcoming" })).unwrap_err().code, "live");
        assert!(parse_probe(&json!({ "title": "x", "live_status": "was_live", "formats": [] })).is_ok());
    }

    #[test]
    fn a_quality_picks_its_formats() {
        assert_eq!(Quality::Best.selector(), "bv*+ba/b");
        assert_eq!(Quality::H720.selector(), "bv*[height<=?720]+ba/b[height<=?720]/wv*+ba/w");
        assert_eq!(Quality::Audio.args(), vec!["-f", "ba/b", "-x"]);
        assert_eq!(Quality::parse(" 480 "), Some(Quality::H480));
        assert_eq!(Quality::parse("4k"), None);
        for q in Quality::ALL {
            assert_eq!(Quality::parse(q.as_str()), Some(q));
            assert_eq!(serde_json::to_value(q).unwrap(), json!(q.as_str()));
        }
    }

    #[test]
    fn progress_lines_are_read_as_yt_dlp_prints_them() {
        let l = parse_line("VSPROG downloading|15360|991017|NA|6146203.915283343|0|mp4");
        assert_eq!(l, Line::Progress(Progress { status: "downloading".into(), downloaded: Some(15360), total: Some(991017), speed: Some(6146203.915283343), eta: Some(0), format_id: Some("mp4".into()) }));
        let l = parse_line("VSPROG downloading|1024|NA|50000.7|NA|NA|137");
        assert!(matches!(l, Line::Progress(Progress { total: Some(50001), speed: None, eta: None, .. })));
        assert_eq!(parse_line("VSPP started|Merger"), Line::Post("started".into(), "Merger".into()));
        assert_eq!(parse_line("VSFILE D:\\w\\fetch\\url1\\source.mp4\r"), Line::File(PathBuf::from("D:\\w\\fetch\\url1\\source.mp4")));
        assert_eq!(parse_line("[download] Destination: x"), Line::Other);
    }

    #[test]
    fn video_and_audio_streams_add_up() {
        let mut s = Streams::default();
        let p = |d: u64, t: u64, f: &str, status: &str| Progress { status: status.into(), downloaded: Some(d), total: Some(t), speed: None, eta: None, format_id: Some(f.into()) };
        assert_eq!(s.apply(&p(500, 9000, "137", "downloading"), Some(11_000)), (500, Some(11_000)));
        assert_eq!(s.apply(&p(9000, 9000, "137", "finished"), Some(11_000)), (9000, Some(11_000)));
        assert_eq!(s.apply(&p(1000, 2100, "140", "downloading"), Some(11_000)), (10_000, Some(11_100)), "a stream larger than the site said grows the total");
    }

    #[test]
    fn yt_dlp_errors_become_codes() {
        let code = |s: &str| classify(s).code;
        assert_eq!(code("WARNING: x\nERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ"), "login_required");
        assert_eq!(code("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users."), "age_restricted");
        assert_eq!(code("ERROR: [youtube] abc: The uploader has not made this video available in your country"), "geo_blocked");
        assert_eq!(code("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video"), "private");
        assert_eq!(code("ERROR: [Netflix] 1: This video is DRM protected"), "drm");
        assert_eq!(code("ERROR: [youtube] abc: Unable to download API page: HTTP Error 429: Too Many Requests"), "rate_limited");
        assert_eq!(code("ERROR: Unsupported URL: https://example.com/"), "unsupported_url");
        assert_eq!(code("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader"), "unavailable");
        assert_eq!(code("ERROR: [generic] x: Unable to download webpage: ('Unable to connect to proxy', NewConnectionError(...))"), "proxy");
        assert_eq!(code("ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing"), "outdated");
        assert_eq!(code("ERROR: something new"), "ytdlp_failed");
        let e = classify("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how");
        assert_eq!(e.detail, "[youtube] abc: Sign in to confirm you’re not a bot. Use --cookies.", "the FAQ links are cut");
    }

    #[test]
    fn a_release_is_checked_against_its_sums() {
        let sums = "1fa6  yt-dlp\n66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a  yt-dlp.exe\n";
        assert_eq!(sum_for(sums, "yt-dlp.exe").as_deref(), Some("66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a"));
        assert_eq!(sum_for(sums, "yt-dlp"), None, "a line without a full hash is not trusted");
        assert!(valid_tag("2026.08.19") && valid_tag("2026.08.19.1"));
        assert!(!valid_tag("2026.08.19/../x") && !valid_tag("latest") && !valid_tag(""));
        assert!(newer("2026.09.01", "2026.08.19") && newer("2026.08.19.1", "2026.08.19"));
        assert!(!newer("2026.08.19", "2026.08.19") && !newer("junk", "2026.08.19"));
    }

    #[test]
    fn the_command_line_reads_no_other_config_and_keeps_the_proxy_password_off_it() {
        let args: Vec<String> = base_args(Path::new("D:/t/deno.exe"), Path::new("D:/t/ffmpeg"), Path::new("D:/t/cache")).into_iter().map(|a| a.to_string_lossy().into_owned()).collect();
        let at = |a: &str| args.iter().position(|x| x == a).unwrap_or(usize::MAX);
        assert!(at("--ignore-config") < args.len() && at("--no-playlist") < args.len());
        assert!(at("--no-js-runtimes") < at("--js-runtimes"), "our deno only: {args:?}");
        assert_eq!(args[at("--js-runtimes") + 1], "deno:D:/t/deno.exe");

        let work = tempfile::tempdir().unwrap();
        let text = |v: Vec<std::ffi::OsString>| v.into_iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(text(proxy_args(None, work.path()).unwrap()), ["--proxy", ""]);
        let plain = reqwest::Url::parse("http://10.0.0.1:3128").unwrap();
        assert_eq!(text(proxy_args(Some(plain), work.path()).unwrap()), ["--proxy", "http://10.0.0.1:3128/"]);
        let secret = reqwest::Url::parse("socks5://user:p%22w@10.0.0.1:1080").unwrap();
        let got = text(proxy_args(Some(secret), work.path()).unwrap());
        assert_eq!(got[0], "--config-locations");
        assert!(!got.iter().any(|a| a.contains("p%22w")), "the password is not on the command line: {got:?}");
    }

    #[test]
    fn a_verified_update_takes_over_and_a_broken_one_does_not() {
        let root = tempfile::tempdir().unwrap();
        let a = active(root.path(), &UpdateRecord::default());
        assert_eq!((a.version.as_str(), a.updated, a.problem.is_none()), (PINNED_VERSION, false, true));
        std::fs::create_dir_all(updates_dir(root.path())).unwrap();
        std::fs::write(updates_dir(root.path()).join("yt-dlp-2026.09.30.exe"), b"exe!").unwrap();
        let rec = UpdateRecord { version: Some("2026.09.30".into()), file: Some("yt-dlp-2026.09.30.exe".into()), size: Some(4), ..Default::default() };
        let a = active(root.path(), &rec);
        assert_eq!((a.version.as_str(), a.updated), ("2026.09.30", true));
        write_record(root.path(), &rec).unwrap();
        assert_eq!(read_record(root.path()), rec, "the record survives a restart");
        let torn = UpdateRecord { size: Some(5), ..rec.clone() };
        let a = active(root.path(), &torn);
        assert_eq!((a.version.as_str(), a.updated), (PINNED_VERSION, false), "a file of another size is not used");
        assert!(a.problem.is_some(), "and the status says why");
    }
}
