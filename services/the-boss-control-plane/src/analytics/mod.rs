use axum::{routing::post, Json, Router};
use serde_json::json;

use crate::SharedState;

async fn ingest() -> Json<serde_json::Value> {
    Json(json!({"accepted": true}))
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/events", post(ingest))
        .route("/token-usage", post(ingest))
}
