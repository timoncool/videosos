//! Routes for the providers' keys: whether each is set, store or clear one, and check one against the
//! provider with a free call (OpenRouter `/key`, Runware account details, fal's price list and, for an admin key,
//! its billing).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use vs_providers::{fal, openrouter, runware, Provider};

use crate::credentials;
use crate::AppState;

async fn states() -> Response {
    Json(json!({ "keys": credentials::states() })).into_response()
}

#[derive(Deserialize)]
struct KeyBody {
    #[serde(default)]
    key: Option<String>,
}

async fn store(Path(provider): Path<String>, Json(body): Json<KeyBody>) -> Response {
    let Some(provider) = Provider::parse(&provider) else { return (StatusCode::NOT_FOUND, Json(json!({ "error": t!("catalog-unknown-provider", provider = provider) }))).into_response() };
    match credentials::store(provider, body.key.as_deref()) {
        Ok(()) => {
            crate::events::send("keys", json!({ "provider": provider }));
            Json(json!({ "keys": credentials::states() })).into_response()
        }
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

async fn check(State(state): State<AppState>, Path(provider): Path<String>) -> Response {
    let Some(provider) = Provider::parse(&provider) else { return (StatusCode::NOT_FOUND, Json(json!({ "error": t!("catalog-unknown-provider", provider = provider) }))).into_response() };
    let Some((key, _)) = credentials::key(provider) else {
        return Json(json!({ "ok": false, "error": vs_providers::ProviderError::NoKey(provider.as_str()).to_string() })).into_response();
    };
    let checked = match provider {
        Provider::Openrouter => openrouter::key_money(&state.http, &key).await.map(|(balance, spent)| json!({ "ok": true, "balance": balance, "spent": spent })),
        Provider::Runware => runware::balance(&state.http, &key).await.map(|balance| json!({ "ok": true, "balance": balance })),
        Provider::Fal => match fal::price(&state.http, &key, "fal-ai/flux/schnell").await {
            Ok(_) => fal::balance(&state.http, &key).await.map(|balance| json!({ "ok": true, "balance": balance, "balance_admin_only": balance.is_none() })),
            Err(error) => Err(error),
        },
    };
    match checked {
        Ok(answer) => Json(answer).into_response(),
        Err(error) => Json(json!({ "ok": false, "error": error.to_string() })).into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/keys", get(states))
        .route("/api/keys/{provider}", put(store))
        .route("/api/keys/{provider}/check", post(check))
}
