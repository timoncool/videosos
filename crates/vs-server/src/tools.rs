//! Programs VideoSOS downloads when a feature needs them, as Dub Studio's model manager does for its tools: the
//! link tool (yt-dlp with deno) and ffmpeg (BtbN's static build, ffmpeg and ffprobe), which yt-dlp needs to put a
//! video's picture and sound together. Every file has a pinned address, size and SHA-256 (Dub Studio's manifest);
//! a download is checked as it comes and only a whole, matching file is kept. They live in `data/tools`.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;

use crate::ytdlp::UrlError;

enum Extract {
    /// The file itself.
    None,
    /// Every file of a zip, flat into the destination's folder (deno).
    Flat,
    /// Only ffmpeg and ffprobe of a build, flat into the destination's folder.
    Pick,
}

struct Spec {
    url: &'static str,
    /// Relative to the data folder; an archive is downloaded here and removed once unpacked.
    dest: &'static str,
    size: u64,
    sha256: &'static str,
    extract: Extract,
}

struct ToolSpec {
    id: &'static str,
    files: &'static [Spec],
    /// Files that are there once the tool is installed; `0` is any size.
    markers: &'static [(&'static str, u64)],
}

#[cfg(windows)]
const FFMPEG_PICK: &[&str] = &["ffmpeg.exe", "ffprobe.exe"];
#[cfg(not(windows))]
const FFMPEG_PICK: &[&str] = &["ffmpeg", "ffprobe"];

#[cfg(windows)]
const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "ytdlp",
        files: &[
            Spec { url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe", dest: "tools/yt-dlp/yt-dlp.exe", size: 17_840_399, sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a", extract: Extract::None },
            Spec { url: "https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip", dest: "tools/yt-dlp/_deno.zip", size: 42_630_221, sha256: "a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238", extract: Extract::Flat },
        ],
        markers: &[("tools/yt-dlp/yt-dlp.exe", 17_840_399), ("tools/yt-dlp/deno.exe", 97_462_048)],
    },
    ToolSpec {
        id: "ffmpeg",
        files: &[Spec {
            url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-N-126342-gf88b741dbf-win64-gpl.zip",
            dest: "tools/ffmpeg/_ffmpeg.zip",
            size: 170_732_198,
            sha256: "b4da332540eaebc6939181b59e267f163dd57407ef6596f7f3452845921d1d91",
            extract: Extract::Pick,
        }],
        markers: &[("tools/ffmpeg/ffmpeg.exe", 0), ("tools/ffmpeg/ffprobe.exe", 0)],
    },
];

#[cfg(target_os = "linux")]
const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "ytdlp",
        files: &[
            Spec { url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_linux", dest: "tools/yt-dlp/yt-dlp", size: 40_446_224, sha256: "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a", extract: Extract::None },
            Spec { url: "https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip", dest: "tools/yt-dlp/_deno.zip", size: 41_596_794, sha256: "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490", extract: Extract::Flat },
        ],
        markers: &[("tools/yt-dlp/yt-dlp", 40_446_224), ("tools/yt-dlp/deno", 95_830_104)],
    },
    ToolSpec {
        id: "ffmpeg",
        files: &[Spec {
            url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-N-126342-gf88b741dbf-linux64-gpl.tar.xz",
            dest: "tools/ffmpeg/_ffmpeg.tar.xz",
            size: 128_065_756,
            sha256: "d1cf19f669510448f18a4cffcdbd8fa9592ee7c15c92feb5b96ad7e9ccc30114",
            extract: Extract::Pick,
        }],
        markers: &[("tools/ffmpeg/ffmpeg", 0), ("tools/ffmpeg/ffprobe", 0)],
    },
];

#[cfg(target_os = "macos")]
const TOOLS: &[ToolSpec] = &[];

// ---------------------------------------------------------------- shared helpers

/// An HTTP client on VideoSOS's proxy route.
pub fn client(timeout: Duration) -> Result<reqwest::Client, UrlError> {
    vs_providers::net::with_proxy(reqwest::Client::builder())
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(timeout)
        .user_agent("VideoSOS")
        .build()
        .map_err(|e| UrlError::new("network", t!("ytdlp-http-client", error = e.to_string())))
}

/// Downloads `url` into `dest`, working out the SHA-256 as it comes; another hash or more than `limit` bytes is an
/// error. A connection that breaks off or goes silent, or an overloaded server, is asked again from the start, a
/// refusal is not. Returns the size; `progress` hears every chunk's running total.
pub async fn fetch_verified(client: &reqwest::Client, url: &str, dest: &Path, want: &str, limit: u64, progress: &(dyn Fn(u64) + Sync)) -> Result<u64, UrlError> {
    const ATTEMPTS: u32 = 8;
    let mut attempt = 0;
    loop {
        attempt += 1;
        match fetch_once(client, url, dest, want, limit, progress).await {
            Err((true, error)) if attempt < ATTEMPTS => {
                tracing::warn!("{url} broke off ({}), attempt {attempt} of {ATTEMPTS}", error.detail);
                tokio::time::sleep(Duration::from_secs(u64::from(attempt) * 3)).await;
            }
            done => return done.map_err(|(_, error)| error),
        }
    }
}

/// One try of `fetch_verified`; an error says whether asking again could help.
async fn fetch_once(client: &reqwest::Client, url: &str, dest: &Path, want: &str, limit: u64, progress: &(dyn Fn(u64) + Sync)) -> Result<u64, (bool, UrlError)> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncWriteExt;
    let lost = |e: &dyn std::fmt::Display| (true, UrlError::new("network", format!("{url}: {e}")));
    let disk = |e: std::io::Error| (false, UrlError::new("io", format!("{}: {e}", dest.display())));
    let mut resp = client.get(url).send().await.map_err(|e| lost(&e))?;
    let status = resp.status();
    if !status.is_success() {
        let again = !status.is_client_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS;
        return Err((again, UrlError::new("network", format!("{url} answered {status}"))));
    }
    let mut out = tokio::fs::File::create(dest).await.map_err(disk)?;
    let mut digest = Sha256::new();
    let mut size = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| lost(&e))? {
        size += chunk.len() as u64;
        if size > limit {
            return Err((false, UrlError::new("io", t!("ytdlp-too-large", url = url.to_string(), limit = limit))));
        }
        digest.update(&chunk);
        out.write_all(&chunk).await.map_err(disk)?;
        progress(size);
    }
    out.flush().await.map_err(disk)?;
    let got = hex::encode(digest.finalize());
    if got != want {
        return Err((false, UrlError::new("io", t!("ytdlp-sha-mismatch", url = url.to_string(), got = got.clone(), want = want.to_string()))));
    }
    Ok(size)
}

/// Writes a whole file or none: a crash halfway leaves the old one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let partial = path.with_extension("partial");
    std::fs::write(&partial, bytes).map_err(|e| format!("{}: {e}", partial.display()))?;
    std::fs::rename(&partial, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// A downloaded program needs its run bit on Linux and macOS.
pub fn make_runnable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    let _ = path;
    Ok(())
}

/// The free space of the disk a path is on.
pub fn free_bytes(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let path = dunce::canonicalize(path).ok()?;
    disks.list().iter().filter(|disk| path.starts_with(disk.mount_point())).max_by_key(|disk| disk.mount_point().as_os_str().len()).map(|disk| disk.available_space())
}

// ---------------------------------------------------------------- state

fn marker_ok(data: &Path, (rel, expect): &(&str, u64)) -> bool {
    std::fs::metadata(data.join(rel)).is_ok_and(|meta| meta.is_file() && (*expect == 0 || meta.len() == *expect))
}

fn installed(data: &Path, id: &str) -> bool {
    TOOLS.iter().find(|tool| tool.id == id).is_some_and(|tool| tool.markers.iter().all(|marker| marker_ok(data, marker)))
}

/// ffmpeg and ffprobe on PATH serve as well as the downloaded ones.
fn ffmpeg_on_path() -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths).find(|dir| FFMPEG_PICK.iter().all(|name| dir.join(name).is_file()))
}

/// The folder of the ffmpeg yt-dlp is given: the downloaded one, else the one on PATH.
pub fn ffmpeg_dir(data: &Path) -> PathBuf {
    if installed(data, "ffmpeg") {
        return data.join("tools/ffmpeg");
    }
    ffmpeg_on_path().unwrap_or_else(|| data.join("tools/ffmpeg"))
}

/// Links can be downloaded: yt-dlp with deno and an ffmpeg are there.
pub fn ready(data: &Path) -> Result<(), UrlError> {
    if TOOLS.is_empty() {
        return Err(UrlError::new("unsupported_os", t!("tools-unsupported-os")));
    }
    if !installed(data, "ytdlp") || !(installed(data, "ffmpeg") || ffmpeg_on_path().is_some()) {
        return Err(UrlError::new("tool_missing", t!("ytdlp-component-missing")));
    }
    Ok(())
}

#[derive(Clone, Debug, Default, Serialize)]
struct Progress {
    installing: bool,
    /// The file being downloaded and the bytes of all files so far.
    current: Option<String>,
    downloaded: u64,
    total: u64,
    error: Option<String>,
}

fn progress() -> &'static Mutex<Progress> {
    static P: Mutex<Progress> = Mutex::new(Progress { installing: false, current: None, downloaded: 0, total: 0, error: None });
    &P
}

fn running() -> &'static AtomicBool {
    static R: AtomicBool = AtomicBool::new(false);
    &R
}

/// What the window and an agent see of the link tool: whether it is there, how much a download takes, the
/// install running now, and yt-dlp's version and update.
pub fn status(data: &Path) -> serde_json::Value {
    let missing: Vec<&ToolSpec> = TOOLS.iter().filter(|tool| !installed(data, tool.id) && !(tool.id == "ffmpeg" && ffmpeg_on_path().is_some())).collect();
    let progress = progress().lock().unwrap_or_else(|p| p.into_inner()).clone();
    json!({
        "supported": !TOOLS.is_empty(),
        "ready": ready(data).is_ok(),
        "missing": missing.iter().map(|tool| tool.id).collect::<Vec<_>>(),
        "download_bytes": missing.iter().flat_map(|tool| tool.files.iter()).map(|file| file.size).sum::<u64>(),
        "ffmpeg_from_path": !installed(data, "ffmpeg") && ffmpeg_on_path().is_some(),
        "install": progress,
        "ytdlp": crate::ytdlp::status(data),
    })
}

fn changed() {
    crate::events::send("url_tool", json!({}));
}

/// Downloads what is missing, in its own task. false when an install already runs.
pub fn start_install(data: &Path) -> bool {
    if running().swap(true, Ordering::SeqCst) {
        return false;
    }
    let data = data.to_path_buf();
    tokio::spawn(async move {
        let result = install(&data, None).await;
        {
            let mut progress = progress().lock().unwrap_or_else(|p| p.into_inner());
            progress.installing = false;
            progress.current = None;
            progress.error = result.as_ref().err().map(|e| e.detail.clone());
        }
        if let Err(e) = result {
            tracing::warn!("[ERROR] the link tool did not install: {e}");
        }
        running().store(false, Ordering::SeqCst);
        changed();
    });
    true
}

/// ffmpeg alone, for local video, which encodes its frames with it; waits for the link tool's install when one runs.
pub(crate) async fn install_ffmpeg(data: &Path) -> Result<(), UrlError> {
    while running().swap(true, Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let result = install(data, Some("ffmpeg")).await;
    progress().lock().unwrap_or_else(|p| p.into_inner()).installing = false;
    running().store(false, Ordering::SeqCst);
    changed();
    result
}

async fn install(data: &Path, only: Option<&str>) -> Result<(), UrlError> {
    let missing: Vec<&ToolSpec> = TOOLS
        .iter()
        .filter(|tool| only.is_none_or(|id| tool.id == id))
        .filter(|tool| !installed(data, tool.id) && !(tool.id == "ffmpeg" && ffmpeg_on_path().is_some()))
        .collect();
    let total: u64 = missing.iter().flat_map(|tool| tool.files.iter()).map(|file| file.size).sum();
    if let Some(free) = free_bytes(data)
        && free < total.saturating_mul(3)
    {
        return Err(UrlError::new("disk_space", t!("url-disk-space", need = total * 3 / 1_000_000, free = free / 1_000_000)));
    }
    *progress().lock().unwrap_or_else(|p| p.into_inner()) = Progress { installing: true, current: None, downloaded: 0, total, error: None };
    changed();
    let client = client(Duration::from_secs(120))?;
    let mut done = 0u64;
    for file in missing.iter().flat_map(|tool| tool.files.iter()) {
        let dest = data.join(file.dest);
        let folder = dest.parent().ok_or_else(|| UrlError::new("io", t!("url-no-parent", path = dest.display().to_string())))?.to_path_buf();
        std::fs::create_dir_all(&folder).map_err(|e| UrlError::new("io", format!("{}: {e}", folder.display())))?;
        let part = dest.with_extension("part");
        progress().lock().unwrap_or_else(|p| p.into_inner()).current = Some(file.url.rsplit('/').next().unwrap_or(file.url).to_string());
        let last = Mutex::new(Instant::now());
        let tell = |bytes: u64| {
            progress().lock().unwrap_or_else(|p| p.into_inner()).downloaded = done + bytes;
            let mut last = last.lock().unwrap_or_else(|p| p.into_inner());
            if last.elapsed() > Duration::from_millis(500) {
                *last = Instant::now();
                changed();
            }
        };
        if let Err(e) = fetch_verified(&client, file.url, &part, file.sha256, file.size + 1, &tell).await {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
        done += file.size;
        let (folder_for, archive) = (folder.clone(), part.clone());
        let unpack = match file.extract {
            Extract::None => std::fs::rename(&part, &dest).map_err(|e| format!("{}: {e}", dest.display())).and_then(|()| make_runnable(&dest)),
            Extract::Flat => tokio::task::spawn_blocking(move || unzip(&archive, &folder_for, None)).await.map_err(|e| e.to_string()).and_then(|r| r),
            Extract::Pick => tokio::task::spawn_blocking(move || if file_is_zip(&archive) { unzip(&archive, &folder_for, Some(FFMPEG_PICK)) } else { untar_xz(&archive, &folder_for, FFMPEG_PICK) })
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r),
        };
        if !matches!(file.extract, Extract::None) {
            let _ = std::fs::remove_file(&part);
        }
        unpack.map_err(|e| UrlError::new("io", e))?;
    }
    for tool in &missing {
        if !installed(data, tool.id) {
            let absent: Vec<&str> = tool.markers.iter().filter(|marker| !marker_ok(data, marker)).map(|(rel, _)| *rel).collect();
            return Err(UrlError::new("io", t!("tools-incomplete", tool = tool.id, files = absent.join(", "))));
        }
    }
    Ok(())
}

fn file_is_zip(path: &Path) -> bool {
    let mut head = [0u8; 4];
    std::fs::File::open(path).and_then(|mut file| file.read_exact(&mut head)).is_ok() && head == *b"PK\x03\x04"
}

/// The files of a zip flat into `folder`: all of them, or only those named in `only`.
pub(crate) fn unzip(archive: &Path, folder: &Path, only: Option<&[&str]>) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("{}: {e}", archive.display()))?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| format!("{}: {e}", archive.display()))?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name().and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned())) else { continue };
        if only.is_some_and(|names| !names.contains(&name.as_str())) {
            continue;
        }
        let dest = folder.join(&name);
        let mut out = std::fs::File::create(&dest).map_err(|e| format!("{}: {e}", dest.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("{}: {e}", dest.display()))?;
        make_runnable(&dest)?;
    }
    Ok(())
}

/// The named files of a .tar.xz flat into `folder`.
fn untar_xz(archive: &Path, folder: &Path, only: &[&str]) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    let xz = lzma_rust2::XzReader::new(std::io::BufReader::new(file), true);
    let mut tar = tar::Archive::new(xz);
    for entry in tar.entries().map_err(|e| format!("{}: {e}", archive.display()))? {
        let mut entry = entry.map_err(|e| format!("{}: {e}", archive.display()))?;
        let Some(name) = entry.path().ok().and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned())) else { continue };
        if !entry.header().entry_type().is_file() || !only.contains(&name.as_str()) {
            continue;
        }
        let dest = folder.join(&name);
        let mut out = std::fs::File::create(&dest).map_err(|e| format!("{}: {e}", dest.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("{}: {e}", dest.display()))?;
        make_runnable(&dest)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server on loopback answering each connection in turn with the next of `answers`; `None` drops the connection.
    async fn serve(answers: Vec<Option<&'static str>>) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let seen = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = seen.clone();
        tokio::spawn(async move {
            for answer in answers {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut request = [0u8; 1024];
                let _ = socket.read(&mut request).await;
                if let Some(answer) = answer {
                    let _ = socket.write_all(answer.as_bytes()).await;
                }
            }
        });
        (url, seen)
    }

    #[tokio::test]
    async fn a_broken_download_is_asked_again_and_a_refusal_is_not() {
        let dir = std::env::temp_dir().join(format!("vs-fetch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("file");
        let want = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(b"hello"));
        let client = client(Duration::from_secs(5)).unwrap();

        let (url, seen) = serve(vec![None, Some("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello")]).await;
        assert_eq!(fetch_verified(&client, &url, &dest, &want, 100, &|_| {}).await.unwrap(), 5);
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 2);

        let (url, seen) = serve(vec![Some("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), None]).await;
        let refusal = fetch_verified(&client, &url, &dest, &want, 100, &|_| {}).await.expect_err("a refusal fails");
        assert!(refusal.detail.contains("404"), "{}", refusal.detail);
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_file_is_pinned_by_size_and_hash() {
        for tool in TOOLS {
            for file in tool.files {
                assert!(file.url.starts_with("https://github.com/") && file.size > 0, "{}", file.url);
                assert!(file.sha256.len() == 64 && file.sha256.bytes().all(|b| b.is_ascii_hexdigit()), "{}", file.url);
            }
        }
    }

    #[test]
    fn the_pinned_yt_dlp_is_the_one_ytdlp_rs_knows() {
        if let Some(tool) = TOOLS.iter().find(|tool| tool.id == "ytdlp") {
            assert!(tool.files.iter().any(|file| file.url.contains(&format!("/releases/download/{}/", crate::ytdlp::PINNED_VERSION))));
            assert!(tool.markers.iter().any(|(rel, _)| rel.ends_with(crate::ytdlp::DENO)), "deno is part of the tool");
        }
    }

    #[test]
    fn a_zip_gives_only_the_files_asked_for() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("a.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for name in ["build/bin/ffmpeg.exe", "build/bin/ffprobe.exe", "build/doc/readme.txt"] {
            zip.start_file(name, options).unwrap();
            zip.write_all(name.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        assert!(file_is_zip(&archive));
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        unzip(&archive, &out, Some(&["ffmpeg.exe", "ffprobe.exe"])).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(&out).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["ffmpeg.exe", "ffprobe.exe"]);
    }
}
