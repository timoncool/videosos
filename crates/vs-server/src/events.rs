//! What changed on the server, for the windows: a job moved, the catalogue was read again, a key was set.
//! Each window keeps one `/api/events` stream open and reads again what an event names.

use std::convert::Infallible;
use std::sync::OnceLock;

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use serde_json::{json, Value};
use tokio::sync::broadcast;

fn channel() -> &'static broadcast::Sender<String> {
    static CHANNEL: OnceLock<broadcast::Sender<String>> = OnceLock::new();
    CHANNEL.get_or_init(|| broadcast::channel(256).0)
}

pub fn send(kind: &str, payload: Value) {
    let _ = channel().send(json!({ "kind": kind, "data": payload }).to_string());
}

pub fn catalog_changed() {
    send("catalog", Value::Null);
}

pub async fn stream() -> impl IntoResponse {
    let receiver = channel().subscribe();
    let hello = futures_util::stream::once(async { Ok::<Event, Infallible>(Event::default().data(json!({ "kind": "hello" }).to_string())) });
    let updates = futures_util::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(text) => return Some((Ok::<Event, Infallible>(Event::default().data(text)), receiver)),
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    return Some((Ok(Event::default().data(json!({ "kind": "resync" }).to_string())), receiver));
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(futures_util::StreamExt::chain(hello, updates)).keep_alive(KeepAlive::default())
}
