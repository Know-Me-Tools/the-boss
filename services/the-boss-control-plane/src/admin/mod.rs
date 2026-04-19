use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use serde_json::json;

use crate::{
    auth,
    config::{self, ConfigPatch},
    SharedState,
};

async fn status() -> Json<serde_json::Value> {
    Json(json!({
        "service": "the-boss-control-plane",
        "admin": "online",
        "policy": "jwt-or-kratos-session"
    }))
}

async fn get_config(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    match auth::require_scope(&state, &headers, "admin:config:read").await {
        Ok(_) => match state.config_store().snapshot() {
            Ok(record) => Json(config::snapshot_response(record)).into_response(),
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

async fn patch_config(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(patch): Json<ConfigPatch>,
) -> Response {
    match auth::require_scope(&state, &headers, "admin:config:write").await {
        Ok(user) => match state.config_store().patch(patch, user.actor()) {
            Ok(record) => {
                let config = record.config.clone();
                state.apply_runtime_config(config).await;
                Json(config::snapshot_response(record)).into_response()
            }
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

async fn list_identities(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    match auth::require_scope(&state, &headers, "admin:identities:read").await {
        Ok(_) => match state.kratos().list_identities().await {
            Ok(value) => Json(value).into_response(),
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

async fn get_identity(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    match auth::require_scope(&state, &headers, "admin:identities:read").await {
        Ok(_) => match state.kratos().get_identity(&id).await {
            Ok(value) => Json(value).into_response(),
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

async fn patch_identity(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    match auth::require_scope(&state, &headers, "admin:identities:write").await {
        Ok(_) => match state.kratos().patch_identity(&id, body).await {
            Ok(value) => Json(value).into_response(),
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

async fn identity_sessions(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    match auth::require_scope(&state, &headers, "admin:identities:read").await {
        Ok(_) => match state.kratos().identity_sessions(&id).await {
            Ok(value) => Json(value).into_response(),
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

async fn revoke_session(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    match auth::require_scope(&state, &headers, "admin:identities:write").await {
        Ok(_) => match state.kratos().revoke_session(&id).await {
            Ok(()) => Json(json!({"revoked": true})).into_response(),
            Err(error) => error.into_response(),
        },
        Err(error) => error.into_response(),
    }
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/status", get(status))
        .route("/config", get(get_config).patch(patch_config))
        .route("/identities", get(list_identities))
        .route("/identities/{id}", get(get_identity).patch(patch_identity))
        .route("/identities/{id}/sessions", get(identity_sessions))
        .route("/sessions/{id}", delete(revoke_session))
}
