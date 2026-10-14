//! The one shape every provider is brought to: a catalogue entry per model, a form of fields per model,
//! and a job that ends in files.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openrouter,
    Fal,
    Runware,
}

impl Provider {
    pub const ALL: [Provider; 3] = [Provider::Openrouter, Provider::Fal, Provider::Runware];

    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Openrouter => "openrouter",
            Provider::Fal => "fal",
            Provider::Runware => "runware",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|provider| provider.as_str() == value)
    }
}

/// What the person wants made; a model serves one or more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Task {
    Image,
    ImageEdit,
    Video,
    VideoEdit,
    LipSync,
    Upscale,
    RemoveBackground,
    Music,
    Speech,
    Sound,
    Transcribe,
    Text,
}

impl Task {
    pub const ALL: [Task; 12] = [
        Task::Image,
        Task::ImageEdit,
        Task::Video,
        Task::VideoEdit,
        Task::LipSync,
        Task::Upscale,
        Task::RemoveBackground,
        Task::Music,
        Task::Speech,
        Task::Sound,
        Task::Transcribe,
        Task::Text,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Task::Image => "image",
            Task::ImageEdit => "image_edit",
            Task::Video => "video",
            Task::VideoEdit => "video_edit",
            Task::LipSync => "lip_sync",
            Task::Upscale => "upscale",
            Task::RemoveBackground => "remove_background",
            Task::Music => "music",
            Task::Speech => "speech",
            Task::Sound => "sound",
            Task::Transcribe => "transcribe",
            Task::Text => "text",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|task| task.as_str() == value)
    }
}

/// One model as the catalogue lists it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub provider: Provider,
    /// What the provider calls it: an OpenRouter slug, a fal endpoint id, a Runware AIR.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub tasks: Vec<Task>,
    /// Unix seconds of release, when the provider says.
    #[serde(default)]
    pub created: Option<i64>,
    /// `live` or `deprecated`.
    pub status: String,
    /// The provider's own price line, shown as is.
    #[serde(default)]
    pub price: Option<String>,
    /// The rates VideoSOS works out itself (the lowest per second; per character; per input and output token),
    /// for the window to word in its language.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rates: Vec<Rate>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    /// What the provider needs later to build the form: OpenRouter typed parameters, a schema URL, a category.
    #[serde(default)]
    pub source: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Choice {
    pub value: Value,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FieldKind {
    /// `max_length`: the most characters the model takes, when its schema says.
    Text {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_length: Option<u64>,
    },
    Textarea {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_length: Option<u64>,
    },
    Integer { min: Option<f64>, max: Option<f64> },
    Number { min: Option<f64>, max: Option<f64> },
    Boolean,
    Select { options: Vec<Choice> },
    /// Files from the media library: `min`..`max` of them.
    /// `list` when the request takes an array, even of one.
    Media { media: MediaKind, min: u32, max: u32, list: bool },
    /// A width and height pair from the model's closed list; the value is `"<w>x<h>"`.
    Size { options: Vec<Choice>, width_key: String, height_key: String },
}

/// What a field means to the window, so the same control serves every provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Prompt,
    NegativePrompt,
    Duration,
    Resolution,
    Aspect,
    Size,
    Count,
    Seed,
    Voice,
    FirstFrame,
    LastFrame,
    Reference,
    Source,
    Mask,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Field {
    /// Dotted path inside the request (`inputs.frameImages`, `settings.quality`, `image_size`).
    pub key: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(flatten)]
    pub kind: FieldKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    /// Shown behind "More settings".
    #[serde(default)]
    pub advanced: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
}

/// How the price of one run is worked out before it runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PriceRule {
    /// Rates: amount in USD per unit, with the label the provider ties to a variant ("720p", "with audio").
    #[serde(default)]
    pub rates: Vec<Rate>,
    /// The provider's own words when the rates do not say it all.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rate {
    pub amount: f64,
    /// `output` (per result), `second` (of output), `character`, `image_input`, `megapixel`, `token_in`, `token_out`.
    pub unit: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelForm {
    pub provider: Provider,
    pub id: String,
    pub fields: Vec<Field>,
    #[serde(default)]
    pub price: PriceRule,
    /// How the provider runs it: `sync` answers in the request, `async` is polled.
    pub delivery: String,
    /// Provider data the request builder needs again (task type, schema, endpoint).
    #[serde(default)]
    pub source: Value,
}

/// A file the person gave a job, already read from disk.
#[derive(Debug, Clone)]
pub struct MediaPayload {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub name: String,
}

impl MediaPayload {
    pub fn data_uri(&self) -> String {
        use base64::Engine;
        format!("data:{};base64,{}", self.mime, base64::engine::general_purpose::STANDARD.encode(&self.bytes))
    }
}

/// What a finished job produced, before it is saved.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Output {
    Url { url: String, #[serde(default)] mime: Option<String> },
    /// Bytes the provider answered with, base64 in the job record until saved.
    Data { data_base64: String, mime: String },
    Text { text: String },
}

/// What submitting a job gave back.
#[derive(Debug, Clone)]
pub enum Submitted {
    Done { outputs: Vec<Output>, cost: Option<f64> },
    /// The provider took it; this is what polling and cancelling need, saved before anything else happens.
    Pending { handle: Value },
}

#[derive(Debug, Clone)]
pub enum Polled {
    Waiting { progress: Option<f64> },
    Done { outputs: Vec<Output>, cost: Option<f64> },
    Failed { message: String },
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("{0}")]
    Refused(String),
    /// Safe to send again: the provider did not take the job.
    #[error("{0}")]
    Busy(String),
    #[error("no API key for {0}: add it in Settings, Providers")]
    NoKey(&'static str),
    #[error("{0}")]
    Network(String),
}

impl From<reqwest::Error> for ProviderError {
    fn from(error: reqwest::Error) -> Self {
        ProviderError::Network(error.to_string())
    }
}
