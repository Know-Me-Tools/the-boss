use axum::{
    routing::{delete, get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::json;

use crate::SharedState;

#[derive(Serialize)]
struct AccountProfile {
    id: &'static str,
    email: &'static str,
    name: &'static str,
}

async fn me() -> Json<AccountProfile> {
    Json(AccountProfile {
        id: "acct_local_dev",
        email: "local@know-me.tools",
        name: "The Boss User",
    })
}

async fn usage() -> Json<serde_json::Value> {
    Json(json!({
        "period": "current",
        "requests": 0,
        "tokens": {"input": 0, "output": 0, "total": 0}
    }))
}

async fn balance() -> Json<serde_json::Value> {
    Json(json!({"currency": "USD", "balance": 0, "billing_enabled": false}))
}

async fn create_token() -> Json<serde_json::Value> {
    Json(json!({"id": "tok_dev", "prefix": "tboss_dev", "created": chrono::Utc::now()}))
}

async fn delete_token() -> Json<serde_json::Value> {
    Json(json!({"deleted": true}))
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/me", get(me))
        .route("/usage", get(usage))
        .route("/balance", get(balance))
        .route("/tokens", post(create_token))
        .route("/tokens/{id}", delete(delete_token))
}
