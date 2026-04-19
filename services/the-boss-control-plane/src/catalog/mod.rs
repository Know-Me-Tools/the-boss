use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::SharedState;

#[derive(Clone, Serialize)]
pub struct ModelDescriptor {
    pub id: &'static str,
    pub object: &'static str,
    pub owned_by: &'static str,
    pub provider: &'static str,
    pub name: &'static str,
    pub group: &'static str,
    pub capabilities: &'static [&'static str],
}

#[derive(Serialize)]
struct ProviderDescriptor {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    api_base_url: String,
    default: bool,
}

#[derive(Serialize)]
struct DefaultsDescriptor {
    assistant: &'static str,
    topic_naming: &'static str,
    translation: &'static str,
    quick_assistant: &'static str,
}

#[derive(Serialize)]
struct CapabilityDescriptor {
    model: &'static str,
    chat_completions: bool,
    responses: bool,
    embeddings: bool,
    tools: bool,
    vision: bool,
}

pub fn seed_models() -> Vec<ModelDescriptor> {
    vec![
        ModelDescriptor {
            id: "theboss-default",
            object: "model",
            owned_by: "know-me-tools",
            provider: "theboss",
            name: "The Boss Default",
            group: "The Boss",
            capabilities: &["chat", "responses", "tools"],
        },
        ModelDescriptor {
            id: "theboss-embedding",
            object: "model",
            owned_by: "know-me-tools",
            provider: "theboss",
            name: "The Boss Embedding",
            group: "The Boss",
            capabilities: &["embeddings"],
        },
    ]
}

async fn providers(State(state): State<SharedState>) -> Json<Vec<ProviderDescriptor>> {
    let config = state.current_config().await;
    Json(vec![ProviderDescriptor {
        id: "theboss",
        name: "The Boss",
        kind: "openai-compatible",
        api_base_url: format!("{}/v1", config.api_base_url),
        default: true,
    }])
}

async fn models() -> Json<Vec<ModelDescriptor>> {
    Json(seed_models())
}

async fn defaults() -> Json<DefaultsDescriptor> {
    Json(DefaultsDescriptor {
        assistant: "theboss-default",
        topic_naming: "theboss-default",
        translation: "theboss-default",
        quick_assistant: "theboss-default",
    })
}

async fn capabilities() -> Json<Vec<CapabilityDescriptor>> {
    Json(vec![
        CapabilityDescriptor {
            model: "theboss-default",
            chat_completions: true,
            responses: true,
            embeddings: false,
            tools: true,
            vision: false,
        },
        CapabilityDescriptor {
            model: "theboss-embedding",
            chat_completions: false,
            responses: false,
            embeddings: true,
            tools: false,
            vision: false,
        },
    ])
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/providers", get(providers))
        .route("/models", get(models))
        .route("/defaults", get(defaults))
        .route("/capabilities", get(capabilities))
}
