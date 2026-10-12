//! The editor window: the built frontend (`frontend/dist`) with index.html for every route the router owns
//! on the page (`/projects`, `/editor/<id>`), so a reload on a deep link opens the same screen.

use std::path::Path;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

pub fn router(repo_root: &Path) -> Router {
    let dist = repo_root.join("frontend").join("dist");
    if !dist.join("index.html").is_file() {
        let missing = format!("The window is not built: {} has no index.html. Run npm run build in frontend/.", dist.display());
        return Router::new().fallback(move || {
            let missing = missing.clone();
            async move { (StatusCode::NOT_FOUND, missing).into_response() }
        });
    }
    let index = ServeFile::new(dist.join("index.html"));
    Router::new().fallback_service(ServeDir::new(&dist).append_index_html_on_directories(true).fallback(index))
}
