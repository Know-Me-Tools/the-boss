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
    let config = state.current_config().await;
    let platform_key = format!("{platform}-{arch}");
    let record = runtime_record(&runtime);
    Json(json!({
        "schemaVersion": 1,
        "name": record.name,
        "runtime": record.runtime,
        "version": record.version,
        "sourceCommit": record.source_commit,
        "channel": channel,
        "supportedPlatforms": supported_platforms(&platform_key),
        "binaries": runtime_binaries(&config.cdn_base_url, &record, &platform_key)
    }))
}

async fn publish() -> Json<serde_json::Value> {
    Json(json!({"accepted": true, "status": "queued"}))
}

async fn promote() -> Json<serde_json::Value> {
    Json(json!({"promoted": true}))
}

async fn latest(Path(runtime): Path<String>) -> Json<serde_json::Value> {
    let record = runtime_record(&runtime);
    Json(json!({
        "runtime": record.runtime,
        "name": record.name,
        "version": record.version,
        "sourceCommit": record.source_commit,
        "tag_name": format!("{}-{}", record.runtime, &record.source_commit[..7]),
        "channel": "latest"
    }))
}

struct RuntimeRecord {
    runtime: &'static str,
    name: &'static str,
    version: &'static str,
    source_commit: &'static str,
}

fn runtime_record(runtime: &str) -> RuntimeRecord {
    match runtime {
        "uar" | "universal-agent-runtime" => RuntimeRecord {
            runtime: "uar",
            name: "universal-agent-runtime",
            version: "0ab6b18c7626fb56da781f13f19c194cfb84b1c1",
            source_commit: "0ab6b18c7626fb56da781f13f19c194cfb84b1c1",
        },
        "opencode" => RuntimeRecord {
            runtime: "opencode",
            name: "opencode",
            version: "9464066b4a0faf68277c414131ed6770dcf9e383",
            source_commit: "9464066b4a0faf68277c414131ed6770dcf9e383",
        },
        "codex" => RuntimeRecord {
            runtime: "codex",
            name: "codex",
            version: "f48b777717e09eb68ef34736d328e96f7a39e9ac",
            source_commit: "f48b777717e09eb68ef34736d328e96f7a39e9ac",
        },
        _ => RuntimeRecord {
            runtime: "unknown",
            name: "unknown",
            version: "0.0.0",
            source_commit: "0000000000000000000000000000000000000000",
        },
    }
}

fn supported_platforms(requested_platform: &str) -> Vec<String> {
    const SUPPORTED: &[&str] = &[
        "darwin-arm64",
        "darwin-x64",
        "linux-arm64",
        "linux-x64",
        "win32-arm64",
        "win32-x64",
    ];
    if SUPPORTED.contains(&requested_platform) {
        vec![requested_platform.to_string()]
    } else {
        Vec::new()
    }
}

fn runtime_binaries(
    cdn_base_url: &str,
    record: &RuntimeRecord,
    platform: &str,
) -> Vec<serde_json::Value> {
    if supported_platforms(platform).is_empty() || record.name == "unknown" {
        return Vec::new();
    }

    let binary_name = match (record.name, platform.starts_with("win32-")) {
        ("universal-agent-runtime", true) => "universal-agent-runtime.exe",
        ("universal-agent-runtime", false) => "universal-agent-runtime",
        ("opencode", true) => "opencode.exe",
        ("opencode", false) => "opencode",
        ("codex", true) => "codex.exe",
        ("codex", false) => "codex",
        _ => "runtime",
    };

    vec![json!({
        "platform": platform,
        "binaryName": binary_name,
        "size": 0,
        "maxSize": 0,
        "sha256": "",
        "httpsUrl": format!("{}/runtimes/{}/{}/{}/{}", cdn_base_url, record.name, record.version, platform, binary_name),
        "ipfsCid": null
    })]
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
