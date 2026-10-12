//! The server alone, for development: `VIDEOSOS_ROOT` (or the repository this binary was built in) is the
//! root, `VIDEOSOS_PORT` (or 8796) the port. The desktop shell runs the same server inside its own process.

use std::path::PathBuf;
use std::time::Duration;

fn repo_root() -> PathBuf {
    if let Some(root) = std::env::var_os("VIDEOSOS_ROOT").filter(|value| !value.is_empty()) {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    if !vs_server::process_group::bind_children_to_this_process() {
        eprintln!("[ERROR] the process did not join its own job object: ffmpeg children end only with their handles");
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(at) = args.iter().position(|arg| arg == "--snapshot") {
        let dir = args.get(at + 1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("catalog"));
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
        return runtime.block_on(vs_server::catalog::write_snapshot(&dir));
    }
    let root = dunce::canonicalize(repo_root())?;
    let port = vs_server::service::listen_port().map_err(anyhow::Error::msg)?;
    match vs_server::service::claim_port(port, Duration::from_secs(5)).map_err(|busy| anyhow::anyhow!(busy.to_string()))? {
        vs_server::service::Claim::Bound(listener) => vs_server::serve_blocking(&root, listener),
        vs_server::service::Claim::AlreadyRunning(running) => {
            anyhow::bail!("VideoSOS {} already serves 127.0.0.1:{port} ({})", running.version, running.service_executable)
        }
    }
}
