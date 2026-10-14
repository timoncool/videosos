//! The model catalogue of the three providers. It opens at once from the last copy on disk (or the copy
//! shipped with the program), then each provider is read again in the background; a provider that cannot
//! be reached keeps its last list and says why. Forms are read on first use and kept on disk.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use vs_providers::{fal, openrouter, price, runware, ModelEntry, ModelForm, Provider, Task};

use crate::credentials;
use crate::AppState;

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct ProviderCatalog {
    pub entries: Vec<ModelEntry>,
    /// Unix milliseconds of the last successful read.
    pub updated: Option<i64>,
    #[serde(skip_deserializing)]
    pub refreshing: bool,
    #[serde(skip_deserializing)]
    pub error: Option<String>,
}

pub struct Catalog {
    dir: PathBuf,
    providers: RwLock<HashMap<Provider, ProviderCatalog>>,
    http: vs_providers::http::Http,
}

/// The copies shipped with the program, so the first start has models before any network answers.
fn shipped(provider: Provider) -> &'static str {
    match provider {
        Provider::Openrouter => include_str!("../catalog/openrouter.json"),
        Provider::Fal => include_str!("../catalog/fal.json"),
        Provider::Runware => include_str!("../catalog/runware.json"),
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Catalog {
    pub fn open(data: &std::path::Path, http: vs_providers::http::Http) -> Arc<Self> {
        let dir = data.join("catalog");
        let _ = std::fs::create_dir_all(dir.join("forms"));
        let mut providers = HashMap::new();
        for provider in Provider::ALL {
            let cached = std::fs::read_to_string(dir.join(format!("{}.json", provider.as_str())))
                .ok()
                .and_then(|text| serde_json::from_str::<ProviderCatalog>(&text).ok())
                .filter(|catalog| !catalog.entries.is_empty())
                .or_else(|| serde_json::from_str::<ProviderCatalog>(shipped(provider)).ok())
                .unwrap_or_default();
            providers.insert(provider, cached);
        }
        Arc::new(Self { dir, providers: RwLock::new(providers), http })
    }

    pub fn entries(&self) -> Vec<ModelEntry> {
        let providers = self.providers.read().unwrap_or_else(|p| p.into_inner());
        Provider::ALL.iter().flat_map(|provider| providers.get(provider).map(|c| c.entries.clone()).unwrap_or_default()).collect()
    }

    pub fn find(&self, provider: Provider, id: &str) -> Option<ModelEntry> {
        let providers = self.providers.read().unwrap_or_else(|p| p.into_inner());
        providers.get(&provider)?.entries.iter().find(|entry| entry.id == id).cloned()
    }

    fn status(&self) -> Value {
        let providers = self.providers.read().unwrap_or_else(|p| p.into_inner());
        Value::Object(
            Provider::ALL
                .iter()
                .map(|provider| {
                    let catalog = providers.get(provider).cloned().unwrap_or_default();
                    (provider.as_str().to_string(), json!({ "models": catalog.entries.len(), "updated": catalog.updated, "refreshing": catalog.refreshing, "error": catalog.error }))
                })
                .collect(),
        )
    }

    fn set(&self, provider: Provider, change: impl FnOnce(&mut ProviderCatalog)) {
        let mut providers = self.providers.write().unwrap_or_else(|p| p.into_inner());
        change(providers.entry(provider).or_default());
    }

    /// Reads one provider's catalogue again; the old list stays until the new one is whole.
    pub async fn refresh(self: &Arc<Self>, provider: Provider) {
        self.set(provider, |catalog| {
            catalog.refreshing = true;
            catalog.error = None;
        });
        let (read, partial) = match provider {
            Provider::Openrouter => (openrouter::catalog(&self.http).await, None),
            Provider::Runware => (runware::catalog(&self.http).await.map(|fresh| self.keep_runware_details(fresh)), None),
            Provider::Fal => {
                let (entries, failures) = fal::catalog(&self.http, 3).await;
                let note = (!failures.is_empty()).then(|| t!("catalog-partial", failures = failures.join("; ")));
                if entries.is_empty() {
                    (Err(vs_providers::ProviderError::Network(failures.join("; "))), None)
                } else {
                    (Ok(entries), note)
                }
            }
        };
        match read {
            Ok(entries) if !entries.is_empty() => {
                let catalog = ProviderCatalog { entries, updated: Some(now_ms()), refreshing: false, error: partial };
                let path = self.dir.join(format!("{}.json", provider.as_str()));
                if let Ok(text) = serde_json::to_string(&catalog) {
                    let _ = std::fs::write(path, text);
                }
                self.set(provider, |current| *current = catalog);
                crate::events::catalog_changed();
            }
            Ok(_) => self.set(provider, |catalog| {
                catalog.refreshing = false;
                catalog.error = Some(t!("catalog-empty"));
            }),
            Err(error) => {
                tracing::warn!("[ERROR] {} catalogue: {error}", provider.as_str());
                self.set(provider, |catalog| {
                    catalog.refreshing = false;
                    catalog.error = Some(error.to_string());
                });
            }
        }
    }

    /// Runware's index has no prices or dates; those come from the schemas, so the ones already known are
    /// carried over to the fresh list.
    fn keep_runware_details(&self, mut fresh: Vec<ModelEntry>) -> Vec<ModelEntry> {
        let providers = self.providers.read().unwrap_or_else(|p| p.into_inner());
        if let Some(old) = providers.get(&Provider::Runware) {
            for entry in &mut fresh {
                if let Some(known) = old.entries.iter().find(|known| known.id == entry.id) {
                    entry.created = entry.created.or(known.created);
                    entry.price = entry.price.clone().or_else(|| known.price.clone());
                    if entry.description.is_empty() {
                        entry.description = known.description.clone();
                    }
                }
            }
        }
        fresh
    }

    pub fn refresh_all(self: &Arc<Self>) {
        for provider in Provider::ALL {
            let catalog = self.clone();
            tokio::spawn(async move { catalog.refresh(provider).await });
        }
    }

    fn form_path(&self, provider: Provider, id: &str) -> PathBuf {
        use sha2::Digest;
        let hash = hex::encode(&sha2::Sha256::digest(id.as_bytes())[..12]);
        self.dir.join("forms").join(format!("{}-{hash}.json", provider.as_str()))
    }

    /// The form of a model: from disk when read before today, otherwise from the provider.
    pub async fn form(&self, provider: Provider, id: &str) -> Result<ModelForm, String> {
        let path = self.form_path(provider, id);
        if let Ok(meta) = std::fs::metadata(&path) {
            let fresh = meta.modified().ok().and_then(|time| time.elapsed().ok()).is_some_and(|age| age.as_secs() < 24 * 3600);
            if fresh
                && let Some(cached) = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str::<CachedForm>(&text).ok())
                && cached.version == FORM_VERSION
                // fal tells its prices only to a key: a form read before the key was set is read again once it is
                && (provider != Provider::Fal || cached.keyed || credentials::key(Provider::Fal).is_none())
            {
                return Ok(cached.form);
            }
        }
        match self.read_form(provider, id).await {
            Ok(form) => Ok(form),
            // the provider cannot be reached now: the copy read before still describes the model
            Err(error) => match std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str::<CachedForm>(&text).ok()) {
                Some(cached) => {
                    tracing::warn!("{} {id}: using the form read before, the provider answered: {error}", provider.as_str());
                    Ok(cached.form)
                }
                None => Err(error),
            },
        }
    }

    async fn read_form(&self, provider: Provider, id: &str) -> Result<ModelForm, String> {
        let path = self.form_path(provider, id);
        let entry = self.find(provider, id).ok_or_else(|| t!("catalog-unknown-model", provider = provider.as_str(), model = id.to_string()))?;
        let (form, schema) = match provider {
            Provider::Openrouter => {
                let mut form = openrouter::form(&entry).map_err(|e| e.to_string())?;
                if entry.source["kind"] == "image"
                    && let Ok(rule) = openrouter::image_price(&self.http, id).await {
                        form.price = rule;
                    }
                (form, Value::Null)
            }
            Provider::Runware => {
                let url = entry.source["schema"].as_str().ok_or_else(|| t!("catalog-no-schema"))?;
                let schema: Value = self.http.get_json(url, None).await.map_err(|e| e.to_string())?;
                let form = runware::form(id, &schema).map_err(|e| e.to_string())?;
                let (created, price, description) = runware::details(&schema);
                self.set(Provider::Runware, |catalog| {
                    if let Some(entry) = catalog.entries.iter_mut().find(|entry| entry.id == id) {
                        entry.created = entry.created.or(created);
                        entry.price = entry.price.clone().or(price);
                        if entry.description.is_empty() {
                            entry.description = description.unwrap_or_default();
                        }
                    }
                });
                (form, schema)
            }
            Provider::Fal => {
                let document = fal::openapi(&self.http, id).await.map_err(|e| e.to_string())?;
                let mut form = fal::form(id, &document).map_err(|e| e.to_string())?;
                if let Some((key, _)) = credentials::key(Provider::Fal) {
                    match fal::price(&self.http, &key, id).await {
                        Ok(rule) => form.price = rule,
                        Err(error) => form.price.note = Some(error.to_string()),
                    }
                }
                (form, Value::Null)
            }
        };
        let keyed = provider == Provider::Fal && credentials::key(Provider::Fal).is_some();
        let cached = CachedForm { version: FORM_VERSION, form: form.clone(), schema, keyed };
        if let Ok(text) = serde_json::to_string(&cached) {
            let _ = std::fs::write(&path, text);
        }
        Ok(form)
    }

    /// The Runware schema a form was read from, for checking a task before it is sent.
    pub fn runware_schema(&self, id: &str) -> Option<Value> {
        let text = std::fs::read_to_string(self.form_path(Provider::Runware, id)).ok()?;
        serde_json::from_str::<CachedForm>(&text).ok().map(|cached| cached.schema).filter(|schema| !schema.is_null())
    }
}

/// Reads every provider afresh, with the price and release of each Runware model from its schema, and writes
/// the copies shipped with the program into `dir`.
pub async fn write_snapshot(dir: &std::path::Path) -> anyhow::Result<()> {
    let http = vs_providers::http::Http::new(reqwest::Client::builder()).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    std::fs::create_dir_all(dir)?;
    let save = |provider: Provider, entries: Vec<ModelEntry>| -> anyhow::Result<()> {
        let catalog = ProviderCatalog { entries, updated: Some(now_ms()), refreshing: false, error: None };
        std::fs::write(dir.join(format!("{}.json", provider.as_str())), serde_json::to_string(&catalog)?)?;
        Ok(())
    };
    let openrouter = openrouter::catalog(&http).await.map_err(|e| anyhow::anyhow!(e.to_string()))?;
    println!("[OK] openrouter {}", openrouter.len());
    save(Provider::Openrouter, openrouter)?;
    let mut runware = runware::catalog(&http).await.map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let total = runware.len();
    for (index, entry) in runware.iter_mut().enumerate() {
        let Some(url) = entry.source["schema"].as_str() else { continue };
        match http.get_json::<Value>(url, None).await {
            Ok(schema) => {
                let (created, price, description) = runware::details(&schema);
                entry.created = created;
                entry.price = price;
                entry.description = description.unwrap_or_default();
            }
            Err(error) => println!("[WARN] {}: {error}", entry.id),
        }
        if index % 25 == 0 {
            println!("[{}%] runware schemas {index}/{total}", index * 100 / total.max(1));
        }
    }
    save(Provider::Runware, runware)?;
    let (fal, failures) = fal::catalog(&http, 3).await;
    for failure in &failures {
        println!("[WARN] fal {failure}");
    }
    println!("[OK] fal {}", fal.len());
    if fal.is_empty() {
        anyhow::bail!("fal answered with no models");
    }
    save(Provider::Fal, fal)?;
    Ok(())
}

/// What a form read today knows; a form kept by an older VideoSOS is read again.
const FORM_VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
struct CachedForm {
    #[serde(default)]
    version: u32,
    form: ModelForm,
    #[serde(default)]
    schema: Value,
    /// Read with a key, so with the prices that need one.
    #[serde(default)]
    keyed: bool,
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    task: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    q: Option<String>,
}

async fn list(State(state): State<AppState>, Query(query): Query<ListQuery>) -> Json<Value> {
    let task = query.task.as_deref().and_then(Task::parse);
    let provider = query.provider.as_deref().and_then(Provider::parse);
    let words: Vec<String> = query.q.unwrap_or_default().to_lowercase().split_whitespace().map(str::to_string).collect();
    let mut models: Vec<ModelEntry> = state
        .catalog
        .entries()
        .into_iter()
        .filter(|entry| task.is_none_or(|task| entry.tasks.contains(&task)))
        .filter(|entry| provider.is_none_or(|provider| entry.provider == provider))
        .filter(|entry| {
            let haystack = format!("{} {} {}", entry.id, entry.name, entry.description).to_lowercase();
            words.iter().all(|word| haystack.contains(word))
        })
        .collect();
    models.sort_by(|a, b| (a.status != "live").cmp(&(b.status != "live")).then(b.created.unwrap_or(0).cmp(&a.created.unwrap_or(0))).then(a.name.cmp(&b.name)));
    let keys: Map<String, Value> = credentials::states().into_iter().map(|state| (state.provider.as_str().to_string(), Value::Bool(state.set))).collect();
    Json(json!({ "models": models, "providers": state.catalog.status(), "keys": keys }))
}

#[derive(Deserialize)]
pub struct RefreshBody {
    #[serde(default)]
    provider: Option<String>,
}

async fn refresh(State(state): State<AppState>, body: Option<Json<RefreshBody>>) -> StatusCode {
    match body.and_then(|Json(body)| body.provider).as_deref().and_then(Provider::parse) {
        Some(provider) => {
            let catalog = state.catalog.clone();
            tokio::spawn(async move { catalog.refresh(provider).await });
        }
        None => state.catalog.refresh_all(),
    }
    StatusCode::ACCEPTED
}

#[derive(Deserialize)]
pub struct FormQuery {
    provider: String,
    id: String,
}

pub fn bad(message: String) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
}

async fn form(State(state): State<AppState>, Query(query): Query<FormQuery>) -> Response {
    let Some(provider) = Provider::parse(&query.provider) else { return bad(t!("catalog-unknown-provider", provider = query.provider)) };
    match state.catalog.form(provider, &query.id).await {
        Ok(form) => Json(json!({ "form": form, "entry": state.catalog.find(provider, &query.id) })).into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, Json(json!({ "error": error }))).into_response(),
    }
}

#[derive(Deserialize)]
pub struct EstimateBody {
    provider: String,
    id: String,
    #[serde(default)]
    values: Map<String, Value>,
    #[serde(default = "one")]
    repeat: u32,
}

fn one() -> u32 {
    1
}

async fn estimate(State(state): State<AppState>, Json(body): Json<EstimateBody>) -> Response {
    let Some(provider) = Provider::parse(&body.provider) else { return bad(t!("catalog-unknown-provider", provider = body.provider)) };
    match state.catalog.form(provider, &body.id).await {
        Ok(form) => {
            let values = crate::jobs::with_defaults(&form, body.values);
            let estimate = price::estimate(&form, &values).map(|estimate| json!({ "usd": estimate.usd * f64::from(body.repeat.max(1)), "exact": estimate.exact }));
            Json(json!({ "estimate": estimate, "note": form.price.note, "rates": form.price.rates })).into_response()
        }
        Err(error) => (StatusCode::BAD_GATEWAY, Json(json!({ "error": error }))).into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/catalog", get(list))
        .route("/api/catalog/refresh", post(refresh))
        .route("/api/catalog/form", get(form))
        .route("/api/catalog/estimate", post(estimate))
}
