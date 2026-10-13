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

    /// A small JSON answer: a catalogue page, a job's status. It has its own short deadline, so a stalled
    /// connection is retried instead of holding the caller for the long download timeout.
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str, auth: Auth) -> Result<T, ProviderError> {
        let response = Self::with_auth(self.client.get(url), auth).timeout(Duration::from_secs(90)).send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(refusal(status, &text));
        }
        serde_json::from_str(&text).map_err(|error| ProviderError::Network(format!("{url}: not the expected JSON ({error})")))
    }

    /// POSTs JSON; the status and the body come back whatever the status, the caller reads both.
    pub async fn post_json(&self, url: &str, auth: Auth, body: &Value) -> Result<(StatusCode, Value), ProviderError> {
        let response = Self::with_auth(self.client.post(url), auth).json(body).send().await?;
        let status = response.status();
        let text = response.text().await?;
        let value = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.chars().take(2000).collect()));
        Ok((status, value))
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
