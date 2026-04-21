use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use serde_json::json;

use crate::SharedState;

#[derive(Serialize)]
struct UpdateChannel {
    version: &'static str,
    feed_url: String,
}

pub async fn ip_country() -> Json<serde_json::Value> {
    Json(json!({"country_code": "US"}))
}

async fn config(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let config = state.current_config().await;
    Json(json!({
        "lastUpdated": chrono::Utc::now(),
        "versions": {
            "1.9.1": {
                "minCompatibleVersion": "1.9.0",
                "description": "The Boss first-party update channel",
                "channels": {
                    "latest": {"version": "1.9.1", "feedUrls": {"github": format!("{}/updates/electron/latest", config.api_base_url), "gitcode": format!("{}/updates/electron/latest", config.api_base_url)}},
                    "rc": null,
                    "beta": null
                }
            }
        }
    }))
}

async fn app_update(
    State(state): State<SharedState>,
    Path((platform, arch, channel)): Path<(String, String, String)>,
) -> Json<serde_json::Value> {
    let config = state.current_config().await;
    Json(json!({
        "platform": platform,
        "arch": arch,
        "channel": channel,
        "version": "1.9.1",
        "feedUrl": format!("{}/updates/electron/{}", config.api_base_url, channel),
        "artifactBaseUrl": format!("{}/app/1.9.1", config.cdn_base_url)
    }))
}

async fn electron_latest(State(state): State<SharedState>, Path(channel): Path<String>) -> String {
    let config = state.current_config().await;
    format!(
        "version: 1.9.1\nfiles:\n  - url: {}/app/1.9.1/TheBoss-1.9.1.zip\n    sha512: pending\n    size: 0\npath: {}/app/1.9.1/TheBoss-1.9.1.zip\nsha512: pending\nreleaseDate: '{}'\nchannel: {}\n",
        config.cdn_base_url,
        config.cdn_base_url,
        chrono::Utc::now().to_rfc3339(),
        channel
    )
}

async fn channels(State(state): State<SharedState>) -> Json<Vec<UpdateChannel>> {
    let config = state.current_config().await;
    Json(vec![UpdateChannel {
        version: "1.9.1",
        feed_url: format!("{}/updates/electron/latest", config.api_base_url),
    }])
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/app/config", get(config))
        .route("/app/{platform}/{arch}/{channel}", get(app_update))
        .route("/app/channels", get(channels))
        .route("/electron/{channel}", get(electron_latest))
}
