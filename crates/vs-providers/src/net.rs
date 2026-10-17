//! Where the program's requests to the internet go (as in the music studios): straight out, through the proxy
//! the system is set to, or through one of the person's own - HTTP, HTTPS, SOCKS5 or SOCKS4, with a login when it
//! has one.
//!
//! Every client asks for the proxy on each request, so a change applies at once, to downloads already set up
//! too, without a restart. This machine and the local network never go through a proxy: a proxy for the internet
//! does not know the way back to 127.0.0.1.

use std::net::IpAddr;
use std::sync::RwLock;

use anyhow::{bail, Context, Result};
use hyper_util::client::proxy::matcher::Matcher;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    /// Straight to the internet, whatever Windows or the environment say.
    Off,
    /// As Windows is set (Settings - Network - Proxy), or HTTP_PROXY,
    /// HTTPS_PROXY and ALL_PROXY when those are given.
    #[default]
    System,
    /// The address the user gave.
    Custom,
}

/// The protocol of an address written without one, the way proxy sellers
/// hand them out: `host:port:user:password`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyKind {
    #[default]
    Http,
    Https,
    /// Names resolved by the proxy (socks5h): the lookups do not leave
    /// through the user's own connection, and a name blocked there resolves.
    Socks5,
    Socks4,
}

impl ProxyKind {
    fn scheme(self) -> &'static str {
        match self {
            ProxyKind::Http => "http",
            ProxyKind::Https => "https",
            ProxyKind::Socks5 => "socks5h",
            ProxyKind::Socks4 => "socks4a",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProxySettings {
    pub mode: ProxyMode,
    /// As the user wrote it.
    pub address: Option<String>,
    pub kind: ProxyKind,
}

const SCHEMES: [&str; 6] = ["http", "https", "socks5", "socks5h", "socks4", "socks4a"];

fn port(text: &str) -> bool {
    !text.is_empty() && text.len() <= 5 && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (byte as char).to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// A proxy address in any of the forms in use, as one URL:
/// `scheme://user:password@host:port`, `user:password@host:port`,
/// `host:port:user:password`, `user:password:host:port` and `host:port`.
/// The forms without a scheme take `kind`'s.
pub fn normalize(address: &str, kind: ProxyKind) -> Result<reqwest::Url> {
    let text = address.trim();
    if text.is_empty() {
        bail!("a proxy address is needed, such as 127.0.0.1:1080 or http://host:3128");
    }
    let written = if let Some((scheme, rest)) = text.split_once("://") {
        let scheme = match scheme.to_ascii_lowercase().as_str() {
            "socks" => "socks5h".to_string(),
            other => other.to_string(),
        };
        format!("{scheme}://{rest}")
    } else if text.starts_with('[') {
        format!("{}://{text}", kind.scheme())
    } else {
        // the colon forms first: a password may hold an @
        let parts: Vec<&str> = text.split(':').collect();
        match parts.as_slice() {
            [host, number, user, password] if port(number) => {
                format!("{}://{}:{}@{host}:{number}", kind.scheme(), encode(user), encode(password))
            }
            [user, password, host, number] if port(number) && !host.contains('@') => {
                format!("{}://{}:{}@{host}:{number}", kind.scheme(), encode(user), encode(password))
            }
            _ if text.contains('@') => format!("{}://{text}", kind.scheme()),
            [host, number] if port(number) => format!("{}://{host}:{number}", kind.scheme()),
            _ => bail!("{} is not a proxy address: write host:port, host:port:user:password or scheme://user:password@host:port", masked(text)),
        }
    };
    let url = reqwest::Url::parse(&written).with_context(|| format!("{} is not a proxy address", masked(text)))?;
    if !SCHEMES.contains(&url.scheme()) {
        bail!("a proxy is http, https, socks5 or socks4, not {}", url.scheme());
    }
    if url.host_str().is_none_or(str::is_empty) || url.port_or_known_default().is_none() {
        bail!("the proxy address needs a host and a port");
    }
    Ok(url)
}

impl ProxySettings {
    /// The settings with a custom address that the client can use, or why not.
    pub fn validated(self) -> Result<Self> {
        if self.mode == ProxyMode::Custom {
            normalize(self.address.as_deref().unwrap_or_default(), self.kind)?;
        }
        Ok(self)
    }

    fn custom_url(&self) -> Option<reqwest::Url> {
        normalize(self.address.as_deref()?, self.kind).ok()
    }

    /// The proxy for the window's own browser: the address alone, since
    /// Chromium takes no login for a proxy given this way, in the scheme names
    /// it knows. None unless a proxy of the user's own is chosen.
    pub fn window_proxy(&self) -> Option<reqwest::Url> {
        if self.mode != ProxyMode::Custom {
            return None;
        }
        let url = self.custom_url()?;
        let scheme = match url.scheme() {
            "socks5h" => "socks5",
            "socks4a" => "socks4",
            other => other,
        };
        reqwest::Url::parse(&format!("{scheme}://{}:{}", url.host_str()?, url.port_or_known_default()?)).ok()
    }
}

/// The address with its password replaced, for logs and messages.
pub fn masked(text: &str) -> String {
    match reqwest::Url::parse(text) {
        Ok(mut url) if url.password().is_some() => {
            let _ = url.set_password(Some("***"));
            url.to_string()
        }
        _ if text.matches(':').count() == 3 && !text.contains('@') => {
            let mut parts: Vec<&str> = text.split(':').collect();
            let secret = if port(parts[1]) { 3 } else { 1 };
            parts[secret] = "***";
            parts.join(":")
        }
        _ => text.to_string(),
    }
}

struct Route {
    settings: ProxySettings,
    /// Windows' proxy and the environment, read when the setting is made.
    system: Matcher,
}

fn route() -> &'static RwLock<Route> {
    static ROUTE: std::sync::OnceLock<RwLock<Route>> = std::sync::OnceLock::new();
    ROUTE.get_or_init(|| RwLock::new(Route { settings: ProxySettings::default(), system: Matcher::from_system() }))
}

/// Makes `settings` the route of every request from now on.
pub fn set(settings: ProxySettings) {
    let mut route = route().write().expect("proxy route");
    route.system = Matcher::from_system();
    route.settings = settings;
}

pub fn current() -> ProxySettings {
    route().read().expect("proxy route").settings.clone()
}

/// The route as a client built elsewhere takes it: the updater brings its
/// own `reqwest` and is told the proxy rather than asked per request.
pub enum Fixed {
    System,
    Direct,
    Through(reqwest::Url),
}

pub fn fixed() -> Fixed {
    let settings = current();
    match settings.mode {
        ProxyMode::System => Fixed::System,
        ProxyMode::Off => Fixed::Direct,
        ProxyMode::Custom => settings.custom_url().map_or(Fixed::Direct, Fixed::Through),
    }
}

/// This machine and the local network: an assistant server on the next
/// computer is as unknown to a proxy on the internet as 127.0.0.1 is. Names
/// without a dot count as local, as Windows' own `<local>` bypass has it.
fn is_local(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => address.is_loopback() || address.is_private() || address.is_link_local(),
        Ok(IpAddr::V6(address)) => address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local(),
        Err(_) => !host.contains('.'),
    }
}

/// The proxy for one request under `settings`, None for straight out.
fn proxy_for(settings: &ProxySettings, system: &Matcher, url: &reqwest::Url) -> Option<reqwest::Url> {
    if is_local(url) {
        return None;
    }
    match settings.mode {
        ProxyMode::Off => None,
        ProxyMode::Custom => settings.custom_url(),
        ProxyMode::System => {
            let destination: ::http::Uri = url.as_str().parse().ok()?;
            let intercept = system.intercept(&destination)?;
            let mut proxy = reqwest::Url::parse(&intercept.uri().to_string()).ok()?;
            if let Some((user, password)) = intercept.raw_auth() {
                let _ = proxy.set_username(user);
                let _ = proxy.set_password(Some(password));
            }
            Some(proxy)
        }
    }
}


/// The proxy a request to `url` goes through under the kept settings, None for straight out: for a program
/// VideoSOS runs (yt-dlp), which is told its proxy rather than routed by a client.
pub fn proxy_url_for(url: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(url).ok()?;
    let route = route().read().expect("proxy route");
    proxy_for(&route.settings, &route.system, &url)
}

/// Any client builder routed as the settings say.
pub fn with_proxy(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder.proxy(reqwest::Proxy::custom(|url| {
        let route = route().read().expect("proxy route");
        proxy_for(&route.settings, &route.system, url)
    }))
}


/// Whether the three providers answer through `settings`, before they are kept. An answer of any status counts;
/// a connection that fails does not.
pub async fn test(settings: ProxySettings) -> Result<serde_json::Value> {
    let settings = settings.validated()?;
    let system = Matcher::from_system();
    let client = reqwest::Client::builder()
        .user_agent(crate::http::USER_AGENT)
        .proxy(reqwest::Proxy::custom(move |url| proxy_for(&settings, &system, url)))
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let reach = |url: &'static str| {
        let client = client.clone();
        async move { client.get(url).send().await.map(|_| ()).map_err(|error| why(&error)) }
    };
    let (openrouter, fal, runware) = tokio::join!(
        reach("https://openrouter.ai/api/v1/models"),
        reach("https://api.fal.ai/v1/models?limit=1"),
        reach("https://runware.ai/docs/models/index.json"),
    );
    Ok(serde_json::json!({
        "openrouter": openrouter.is_ok(), "openrouter_error": openrouter.err(),
        "fal": fal.is_ok(), "fal_error": fal.err(),
        "runware": runware.is_ok(), "runware_error": runware.err(),
    }))
}

/// The error with the causes under it: "error sending request" alone does
/// not say that the proxy turned the login down or could not be reached.
fn why(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut cause = std::error::Error::source(error);
    while let Some(inner) = cause {
        let line = inner.to_string();
        if !text.contains(&line) {
            text.push_str(": ");
            text.push_str(&line);
        }
        cause = inner.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> reqwest::Url {
        reqwest::Url::parse(text).unwrap()
    }

    fn custom(address: &str, kind: ProxyKind) -> ProxySettings {
        ProxySettings { mode: ProxyMode::Custom, address: Some(address.into()), kind }
    }

    #[test]
    fn every_usual_way_of_writing_a_proxy_is_read() {
        let read = |text: &str, kind| normalize(text, kind).unwrap().to_string();
        assert_eq!(read("127.0.0.1:1080", ProxyKind::Socks5), "socks5h://127.0.0.1:1080");
        assert_eq!(read("proxy.example:3128", ProxyKind::Http), "http://proxy.example:3128/");
        assert_eq!(read("1.2.3.4:8000:user:p@ss", ProxyKind::Http), "http://user:p%40ss@1.2.3.4:8000/");
        assert_eq!(read("user:pass:1.2.3.4:8000", ProxyKind::Socks5), "socks5h://user:pass@1.2.3.4:8000");
        assert_eq!(read("user:pass@1.2.3.4:8000", ProxyKind::Https), "https://user:pass@1.2.3.4:8000/");
        assert_eq!(read("SOCKS5://u:p@h:1080", ProxyKind::Http), "socks5://u:p@h:1080");
        assert_eq!(read("socks://h:1080", ProxyKind::Http), "socks5h://h:1080");
        assert_eq!(read("socks4://h:1080", ProxyKind::Http), "socks4://h:1080");
        assert_eq!(read("[::1]:1080", ProxyKind::Socks5), "socks5h://[::1]:1080");
        for bad in ["", "proxy", "ftp://h:21", "h:port", "a:b:c"] {
            assert!(normalize(bad, ProxyKind::Http).is_err(), "{bad}");
        }
    }

    #[test]
    fn this_machine_and_the_local_network_are_never_proxied() {
        let settings = custom("socks5h://user:pass@10.0.0.2:1080", ProxyKind::Http);
        let system = Matcher::from_system();
        for local in [
            "http://127.0.0.1:8796/health",
            "http://localhost:1234/v1/models",
            "http://[::1]:8791/",
            "http://192.168.1.20:11434/v1",
            "http://10.0.0.5:1234/v1",
            "http://gpu-box:11434/v1",
        ] {
            assert_eq!(proxy_for(&settings, &system, &url(local)), None, "{local}");
        }
        let through = proxy_for(&settings, &system, &url("https://openrouter.ai/x")).unwrap();
        assert_eq!((through.scheme(), through.username(), through.password()), ("socks5h", "user", Some("pass")));
        let off = ProxySettings { mode: ProxyMode::Off, ..ProxySettings::default() };
        assert_eq!(proxy_for(&off, &system, &url("https://openrouter.ai/x")), None);
    }

    #[test]
    fn the_window_gets_the_proxy_without_its_login() {
        let window = |settings: ProxySettings| settings.window_proxy().map(|url| url.to_string());
        assert_eq!(window(custom("1.2.3.4:1080:u:p", ProxyKind::Socks5)).as_deref(), Some("socks5://1.2.3.4:1080"));
        assert_eq!(window(custom("http://u:p@proxy:3128", ProxyKind::Http)).as_deref(), Some("http://proxy:3128/"));
        assert_eq!(window(ProxySettings::default()), None);
    }

    #[test]
    fn a_password_never_reaches_a_log() {
        assert_eq!(masked("socks5://me:secret@host:1080"), "socks5://me:***@host:1080");
        assert_eq!(masked("1.2.3.4:8000:user:secret"), "1.2.3.4:8000:user:***");
        assert_eq!(masked("user:secret:1.2.3.4:8000"), "user:***:1.2.3.4:8000");
    }
}
