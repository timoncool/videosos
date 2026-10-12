//! The providers of VideoSOS — OpenRouter, fal and Runware — brought to one contract: a catalogue of
//! models by task, a form of fields per model, a run that ends in files, and a price before it runs.

pub mod fal;
pub mod http;
pub mod model;
pub mod openrouter;
pub mod price;
pub mod runware;
pub mod schema_form;

pub use model::*;
