use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::json;

use crate::SharedState;

async fn resolve(
    State(state): State<SharedState>,
    Path(key): Path<String>,
) -> Json<serde_json::Value> {
    let config = state.current_config().await;
    Json(json!({
        "key": key,
        "url": format!("{}/{}", config.cdn_base_url, key),
        "transport": "cloudflare-cdn",
        "cacheControl": "public, max-age=31536000, immutable"
    }))
}

pub fn router() -> Router<SharedState> {
    Router::new().route("/{*key}", get(resolve))
}
