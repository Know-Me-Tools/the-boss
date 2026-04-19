use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::SharedState;

async fn manifest(
    State(state): State<SharedState>,
    Path((runtime, platform, arch, channel)): Path<(String, String, String, String)>,
) -> Json<serde_json::Value> {
    let artifact_name = format!("{runtime}-{platform}-{arch}");
    let config = state.current_config().await;
    Json(json!({
        "schemaVersion": 1,
        "runtime": runtime,
        "platform": platform,
        "arch": arch,
        "channel": channel,
        "version": "0.1.0",
        "artifact": {
            "httpsUrl": format!("{}/runtimes/{}/0.1.0/{}", config.cdn_base_url, runtime, artifact_name),
            "ipfsCid": null,
            "sha256": "pending",
            "size": 0
        },
        "signature": "pending"
    }))
}

async fn publish() -> Json<serde_json::Value> {
    Json(json!({"accepted": true, "status": "queued"}))
}

async fn promote() -> Json<serde_json::Value> {
    Json(json!({"promoted": true}))
}

async fn latest(Path(runtime): Path<String>) -> Json<serde_json::Value> {
    Json(json!({
        "runtime": runtime,
        "tag_name": "v2026.3.13",
        "channel": "latest"
    }))
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route(
            "/manifests/{runtime}/{platform}/{arch}/{channel}",
            get(manifest),
        )
        .route("/{runtime}/latest", get(latest))
        .route("/admin/publish", post(publish))
        .route("/admin/promote", post(promote))
}
