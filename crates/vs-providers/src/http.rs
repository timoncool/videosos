//! One HTTP client for every provider: a named User-Agent (Runware's documentation answers 403 without
//! one), a connect timeout, and JSON helpers that keep the status of a refused request.

use std::time::Duration;

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::model::ProviderError;

pub const USER_AGENT: &str = concat!("VideoSOS/", env!("CARGO_PKG_VERSION"), " (+https://github.com/timoncool/videosos)");

#[derive(Clone)]
pub struct Http {
    pub client: reqwest::Client,
}

pub type Auth = Option<(&'static str, String)>;

impl Http {
    pub fn new(builder: reqwest::ClientBuilder) -> Result<Self, ProviderError> {
        let client = crate::net::with_proxy(builder)
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|error| ProviderError::Network(error.to_string()))?;
        Ok(Self { client })
    }

    fn with_auth(request: reqwest::RequestBuilder, auth: Auth) -> reqwest::RequestBuilder {
        match auth {
            Some((name, value)) => request.header(name, value),
            None => request,
        }
    }

    /// A small JSON answer: a catalogue page, a model's form or price, a job's status. It has its own short
    /// deadline, so a stalled connection fails fast instead of holding the caller for the long download timeout,
    /// and a 429 or 5xx is asked again after 1, 2 and 4 seconds (or the Retry-After the provider gives), as fal
    /// and the others advise for a request that changes nothing.
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str, auth: Auth) -> Result<T, ProviderError> {
        let mut pause = Duration::from_secs(1);
        let mut attempt = 0;
        loop {
            let answer = async {
                let response = Self::with_auth(self.client.get(url), auth.clone()).timeout(Duration::from_secs(90)).send().await?;
                let status = response.status();
                let asked = retry_after(response.headers());
                Ok::<_, ProviderError>((status, asked, response.text().await?))
            }
            .await;
            let (refused, asked) = match answer {
                Ok((status, _, text)) if status.is_success() => {
                    return serde_json::from_str(&text).map_err(|error| ProviderError::Network(format!("{url}: not the expected JSON ({error})")));
                }
                Ok((status, asked, text)) => (refusal(status, &text), asked),
                Err(error) => (error, None),
            };
            if !matches!(refused, ProviderError::Busy(_) | ProviderError::Network(_)) || attempt == 3 {
                return Err(refused);
            }
            tokio::time::sleep(asked.unwrap_or(pause).min(Duration::from_secs(30))).await;
            pause *= 2;
            attempt += 1;
        }
    }

    /// POSTs JSON; the status and the body come back whatever the status, the caller reads both. A 429 means the
    /// provider took nothing, so it is sent again after 1, 2 and 4 seconds (or the Retry-After given); a 5xx is not,
    /// since the job may have been taken and paid for.
    pub async fn post_json(&self, url: &str, auth: Auth, body: &Value) -> Result<(StatusCode, Value), ProviderError> {
        let mut pause = Duration::from_secs(1);
        let mut attempt = 0;
        loop {
            let response = Self::with_auth(self.client.post(url), auth.clone()).json(body).send().await?;
            let status = response.status();
            let asked = retry_after(response.headers());
            let text = response.text().await?;
            if status == StatusCode::TOO_MANY_REQUESTS && attempt < 3 {
                tokio::time::sleep(asked.unwrap_or(pause).min(Duration::from_secs(30))).await;
                pause *= 2;
                attempt += 1;
                continue;
            }
            let value = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.chars().take(2000).collect()));
            return Ok((status, value));
        }
    }

    pub async fn get_bytes(&self, url: &str, auth: Auth) -> Result<(Vec<u8>, Option<String>), ProviderError> {
        let response = Self::with_auth(self.client.get(url), auth).send().await?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(refusal(status, &text));
        }
        let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).map(|value| value.split(';').next().unwrap_or(value).trim().to_string());
        Ok((response.bytes().await?.to_vec(), mime))
    }
}

/// The pause a refusal asks for in whole seconds, when it names one.
fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

/// A refused request as an error: 429 and 5xx are worth sending again, the rest are not.
pub fn refusal(status: StatusCode, body: &str) -> ProviderError {
    let message = provider_message(body).unwrap_or_else(|| body.chars().take(300).collect());
    let text = format!("{status}: {message}");
    if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        ProviderError::Busy(text)
    } else {
        ProviderError::Refused(text)
    }
}

/// The human part of a provider's error body: `{"error":{"message"}}`, `{"detail"}`, `{"errors":[{"message"}]}`.
pub fn provider_message(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
        return Some(message.to_string());
    }
    if let Some(message) = value.get("error").and_then(Value::as_str) {
        return Some(message.to_string());
    }
    if let Some(detail) = value.get("detail") {
        return Some(match detail {
            Value::String(text) => text.clone(),
            Value::Array(items) => items.iter().filter_map(|item| item.get("msg").and_then(Value::as_str)).collect::<Vec<_>>().join("; "),
            other => other.to_string(),
        });
    }
    value.pointer("/errors/0/message").and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A provider that refuses with 429 `busy` times, then takes the job; the answer counts the requests.
    async fn provider(busy: usize) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/submit", listener.local_addr().unwrap());
        let seen = Arc::new(AtomicUsize::new(0));
        let count = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let mut buf = vec![0u8; 8192];
                let _ = socket.read(&mut buf).await;
                let n = count.fetch_add(1, Ordering::SeqCst);
                let answer = if n < busy {
                    "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"id\":\"j1\"}".to_string()
                };
                let _ = socket.write_all(answer.as_bytes()).await;
            }
        });
        (url, seen)
    }

    #[tokio::test]
    async fn a_post_refused_with_429_is_sent_again_and_a_lasting_one_comes_back() {
        let http = Http::new(reqwest::Client::builder()).unwrap();
        let (url, seen) = provider(2).await;
        let (status, body) = http.post_json(&url, None, &serde_json::json!({})).await.unwrap();
        assert_eq!((status, body["id"].as_str(), seen.load(Ordering::SeqCst)), (StatusCode::OK, Some("j1"), 3));
        let (url, seen) = provider(10).await;
        let (status, _) = http.post_json(&url, None, &serde_json::json!({})).await.unwrap();
        assert_eq!((status, seen.load(Ordering::SeqCst)), (StatusCode::TOO_MANY_REQUESTS, 4));
    }
}
