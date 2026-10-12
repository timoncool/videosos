//! Адрес сервиса и его опознание. Порт фиксированный (семейство студий: YuE2 8791, ACE 8792, MiniMax 8765,
//! Dub 8793, Dungeon Ultimate 8795, VideoSOS 8796), чтобы origin окна, а с ним localStorage, и адрес для агентов
//! не менялись между запусками. `/health` называет, чей сервис отвечает на порту: второй запуск переиспользует
//! уже работающий VideoSOS, а чужой процесс на порту превращается в понятную ошибку, а не в зависание.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::AppState;

pub const APP_ID: &str = "videosos";
pub const DEFAULT_PORT: u16 = 8796;
pub const PORT_ENV: &str = "VIDEOSOS_PORT";

static APP_VERSION: OnceLock<String> = OnceLock::new();
static LISTEN_PORT: OnceLock<u16> = OnceLock::new();

/// Версия приложения знает только оболочка (tauri.conf.json); вызывается до старта сервиса.
pub fn set_app_version(version: impl Into<String>) {
    let _ = APP_VERSION.set(version.into());
}

/// Версия оболочки, а у standalone vs-server — версия воркспейса.
pub fn app_version() -> &'static str {
    APP_VERSION.get().map(String::as_str).unwrap_or(env!("CARGO_PKG_VERSION"))
}

/// Порт сервиса: `VIDEOSOS_PORT`, иначе 8796. Неразборчивое значение — ошибка, а не молчаливый дефолт.
pub fn listen_port() -> Result<u16, String> {
    match std::env::var(PORT_ENV) {
        Ok(v) => parse_port(Some(&v)),
        Err(std::env::VarError::NotPresent) => parse_port(None),
        Err(std::env::VarError::NotUnicode(v)) => {
            Err(t!("service-bad-port", value = format!("{PORT_ENV}={v:?}")))
        }
    }
}

/// Порт задан явно: `VIDEOSOS_PORT` непуст (пустое значение — тот же дефолт, что и отсутствие).
pub fn port_is_explicit() -> bool {
    match std::env::var(PORT_ENV) {
        Ok(v) => is_explicit(Some(&v)),
        Err(std::env::VarError::NotPresent) => false,
        Err(std::env::VarError::NotUnicode(_)) => true,
    }
}

fn is_explicit(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.trim().is_empty())
}

fn parse_port(value: Option<&str>) -> Result<u16, String> {
    match value.map(str::trim) {
        None | Some("") => Ok(DEFAULT_PORT),
        Some(s) => s
            .parse::<u16>()
            .ok()
            .filter(|p| *p != 0)
            .ok_or_else(|| t!("service-bad-port", value = format!("{PORT_ENV}={s}"))),
    }
}

/// Тело `/health`.
pub fn health_json(repo_root: &Path) -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| t!("service-exe-path", error = e.to_string()))?;
    Ok(json!({
        "status": "ok",
        "app": APP_ID,
        "version": app_version(),
        "service_executable": exe.display().to_string(),
        "repo_root": repo_root.display().to_string(),
        "port": LISTEN_PORT.get(),
    }))
}

/// GET /health
pub async fn health(State(st): State<AppState>) -> Response {
    match health_json(&st.repo_root) {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

/// Что ответил сервис VideoSOS на `/health`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Running {
    pub version: String,
    pub service_executable: String,
    pub repo_root: String,
    pub port: Option<u16>,
}

/// Кто держит порт.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Occupant {
    /// Соединение не принимается.
    Nobody,
    VideoSos(Running),
    /// Порт принимает соединения, но это не VideoSOS; строка — что именно ответило.
    Other(String),
}

/// Спросить `GET /health` на 127.0.0.1:port. Прокси и переменные окружения не участвуют: запрос
/// идёт голым HTTP/1.1 по loopback.
pub fn probe(port: u16, timeout: Duration) -> Occupant {
    let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let mut stream = match TcpStream::connect_timeout(&addr.into(), timeout) {
        Ok(s) => s,
        Err(_) => return Occupant::Nobody,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    if let Err(e) = stream.write_all(request.as_bytes()) {
        return Occupant::Other(t!("service-request-not-sent", error = e.to_string()));
    }
    let mut raw = Vec::new();
    if let Err(e) = stream.read_to_end(&mut raw)
        && raw.is_empty() {
            return Occupant::Other(t!("service-no-health-answer", error = e.to_string()));
        }
    classify_response(&raw)
}

fn classify_response(raw: &[u8]) -> Occupant {
    let text = String::from_utf8_lossy(raw);
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return Occupant::Other(t!("service-not-http"));
    };
    let status_line = head.lines().next().unwrap_or_default();
    let mut parts = status_line.split_whitespace();
    let (proto, code) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    if !proto.starts_with("HTTP/") {
        return Occupant::Other(t!("service-not-http"));
    }
    if code != "200" {
        return Occupant::Other(t!("service-health-status", code = code.to_string()));
    }
    let chunked = head.lines().skip(1).any(|l| {
        l.split_once(':').is_some_and(|(k, v)| {
            k.trim().eq_ignore_ascii_case("transfer-encoding") && v.trim().eq_ignore_ascii_case("chunked")
        })
    });
    if chunked {
        return Occupant::Other(t!("service-health-not-videosos"));
    }
    let Ok(v) = serde_json::from_str::<Value>(body.trim()) else {
        return Occupant::Other(t!("service-health-not-json"));
    };
    match v.get("app").and_then(Value::as_str) {
        Some(APP_ID) => match serde_json::from_value::<Running>(v) {
            Ok(r) => Occupant::VideoSos(r),
            Err(e) => Occupant::Other(t!("service-health-no-fields", app = APP_ID, error = e.to_string())),
        },
        Some(other) => Occupant::Other(t!("service-other-app", app = other.to_string())),
        None => Occupant::Other(t!("service-health-no-app")),
    }
}

/// Итог захвата порта.
#[derive(Debug)]
pub enum Claim {
    /// Порт наш: сервис поднимается на этом слушателе.
    Bound(TcpListener),
    /// На порту уже работает VideoSOS: второй сервис не нужен.
    AlreadyRunning(Running),
}

/// Порт так и не освободился.
#[derive(Debug)]
pub struct PortBusy {
    pub port: u16,
    pub occupant: Occupant,
    pub error: std::io::Error,
    pub waited: Duration,
}

impl std::fmt::Display for PortBusy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let who = match &self.occupant {
            Occupant::Nobody => t!("service-port-reserved", command = "netsh interface ipv4 show excludedportrange protocol=tcp"),
            Occupant::VideoSos(r) => t!("service-port-videosos", version = r.version.clone(), executable = r.service_executable.clone()),
            Occupant::Other(what) => t!("service-port-other", what = what.clone()),
        };
        f.write_str(&t!(
            "service-port-busy",
            port = self.port,
            seconds = self.waited.as_secs(),
            who = who,
            error = self.error.to_string(),
            env = PORT_ENV,
            other_port = self.port.checked_add(10).unwrap_or(self.port - 10)
        ))
    }
}

impl std::error::Error for PortBusy {}

fn bind_loopback(port: u16) -> std::io::Result<TcpListener> {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
}

const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// Занять порт сервиса. Если на нём уже отвечает VideoSOS — вернуть её. Если порт держит кто-то
/// ещё, повторять до `patience`: закрытая только что студия отпускает порт не сразу.
pub fn claim_port(port: u16, patience: Duration) -> Result<Claim, PortBusy> {
    let started = Instant::now();
    loop {
        // Сначала bind, потом вопрос: connect на закрытый порт loopback в Windows ждёт повторов SYN.
        let error = match bind_loopback(port) {
            Ok(l) => return Ok(Claim::Bound(l)),
            Err(e) => e,
        };
        let occupant = probe(port, PROBE_TIMEOUT);
        if let Occupant::VideoSos(r) = occupant {
            return Ok(Claim::AlreadyRunning(r));
        }
        if started.elapsed() >= patience {
            return Err(PortBusy { port, occupant, error, waited: started.elapsed() });
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

/// Ждать, пока на порту ответит VideoSOS.
pub fn wait_until_serving(port: u16, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if matches!(probe(port, PROBE_TIMEOUT), Occupant::VideoSos(_)) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    false
}

pub(crate) fn record_port(port: u16) {
    let _ = LISTEN_PORT.set(port);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    #[test]
    fn port_comes_from_the_variable_or_defaults_to_8796() {
        assert_eq!(parse_port(None), Ok(8796));
        assert_eq!(parse_port(Some("")), Ok(8796));
        assert_eq!(parse_port(Some(" 18801 ")), Ok(18801));
        for bad in ["0", "abc", "70000", "-1", "8796x"] {
            let e = parse_port(Some(bad)).expect_err(bad);
            assert!(e.contains(PORT_ENV) && e.contains(bad), "{e}");
        }
    }

    #[test]
    fn only_a_non_empty_variable_is_an_explicit_port() {
        assert!(!is_explicit(None));
        assert!(!is_explicit(Some("")));
        assert!(!is_explicit(Some("  ")));
        assert!(is_explicit(Some("8796")));
        assert!(is_explicit(Some(" 18801 ")));
        assert!(is_explicit(Some("abc")));
    }

    /// Сервер на свободном порту, отвечающий на каждое соединение `reply` (None — молчит).
    fn fake_server(reply: Option<String>) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let Ok(mut s) = s else { continue };
                let reply = reply.clone();
                std::thread::spawn(move || {
                    let mut r = std::io::BufReader::new(s.try_clone().unwrap());
                    let mut line = String::new();
                    while r.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
                        line.clear();
                    }
                    match reply {
                        Some(body) => {
                            let _ = s.write_all(body.as_bytes());
                        }
                        None => std::thread::sleep(Duration::from_secs(5)),
                    }
                });
            }
        });
        port
    }

    fn http(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn vs_body(version: &str) -> String {
        json!({"status":"ok","app":"videosos","version":version,
               "service_executable":"C:\\VideoSOS\\VideoSOS.exe","repo_root":"C:\\VideoSOS","port":8796})
        .to_string()
    }

    fn free_port() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    }

    #[test]
    fn probe_tells_videosos_from_others_and_from_nobody() {
        let ours = fake_server(Some(http("200 OK", &vs_body("3.2.0"))));
        match probe(ours, PROBE_TIMEOUT) {
            Occupant::VideoSos(r) => {
                assert_eq!(r.version, "3.2.0");
                assert_eq!(r.port, Some(8796));
            }
            o => panic!("ожидалась VideoSOS: {o:?}"),
        }

        let other_app = fake_server(Some(http("200 OK", r#"{"status":"ok","app":"yue2-studio"}"#)));
        assert!(matches!(probe(other_app, PROBE_TIMEOUT), Occupant::Other(w) if w.contains("yue2-studio")));

        let not_found = fake_server(Some(http("404 Not Found", "")));
        assert!(matches!(probe(not_found, PROBE_TIMEOUT), Occupant::Other(w) if w.contains("404")));

        let not_json = fake_server(Some(http("200 OK", "<html></html>")));
        assert!(matches!(probe(not_json, PROBE_TIMEOUT), Occupant::Other(_)));

        let not_http = fake_server(Some("SSH-2.0-OpenSSH_9.9\r\n".into()));
        assert!(matches!(probe(not_http, PROBE_TIMEOUT), Occupant::Other(_)));

        let silent = fake_server(None);
        assert!(matches!(probe(silent, Duration::from_millis(300)), Occupant::Other(_)));

        assert_eq!(probe(free_port(), PROBE_TIMEOUT), Occupant::Nobody);
    }

    #[test]
    fn claim_reuses_a_running_videosos() {
        let port = fake_server(Some(http("200 OK", &vs_body("3.2.0"))));
        match claim_port(port, Duration::from_secs(5)) {
            Ok(Claim::AlreadyRunning(r)) => assert_eq!(r.version, "3.2.0"),
            other => panic!("ожидалось переиспользование: {other:?}"),
        }
    }

    #[test]
    fn claim_binds_a_free_port() {
        let port = free_port();
        match claim_port(port, Duration::from_secs(5)) {
            Ok(Claim::Bound(l)) => assert_eq!(l.local_addr().unwrap().port(), port),
            other => panic!("ожидался свой слушатель: {other:?}"),
        }
    }

    #[test]
    fn claim_gives_up_on_a_foreign_occupant_with_a_hint() {
        let port = fake_server(Some(http("404 Not Found", "")));
        let started = Instant::now();
        let busy = match claim_port(port, Duration::from_millis(900)) {
            Err(b) => b,
            Ok(c) => panic!("чужой порт не должен отдаваться: {c:?}"),
        };
        assert!(started.elapsed() >= Duration::from_millis(900));
        assert!(matches!(busy.occupant, Occupant::Other(_)));
        let text = busy.to_string();
        assert!(text.contains(&port.to_string()) && text.contains(PORT_ENV), "{text}");
    }

    #[test]
    fn claim_waits_for_a_port_that_is_released() {
        let holder = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = holder.local_addr().unwrap().port();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            drop(holder);
        });
        match claim_port(port, Duration::from_secs(10)) {
            Ok(Claim::Bound(l)) => assert_eq!(l.local_addr().unwrap().port(), port),
            other => panic!("порт должен был освободиться: {other:?}"),
        }
    }

    #[test]
    fn health_body_is_what_probe_recognises() {
        let root = Path::new("C:\\data\\videosos");
        let body = health_json(root).unwrap();
        assert_eq!(body["app"], APP_ID);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["repo_root"], root.display().to_string());
        assert!(body["service_executable"].as_str().is_some_and(|s| !s.is_empty()));
        let port = fake_server(Some(http("200 OK", &body.to_string())));
        assert!(matches!(probe(port, PROBE_TIMEOUT), Occupant::VideoSos(r) if r.version == app_version()));
    }
}
