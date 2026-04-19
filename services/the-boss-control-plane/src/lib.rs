use std::sync::Arc;

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub mod account;
pub mod admin;
pub mod analytics;
pub mod artifacts;
pub mod auth;
pub mod catalog;
pub mod config;
pub mod inference;
pub mod kratos;
pub mod runtimes;
pub mod static_ui;
pub mod updates;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ControlPlaneConfig {
    pub bind_addr: String,
    pub database_url: Option<String>,
    pub config_file: Option<String>,
    pub public_base_url: String,
    pub api_base_url: String,
    pub auth_base_url: String,
    pub cdn_base_url: String,
    pub jwt_audience: String,
    pub jwt_issuer: String,
    pub jwt_signing_key_pem: Option<String>,
    pub jwt_public_key_pem: Option<String>,
    pub jwt_key_id: String,
    pub jwt_ttl_seconds: u64,
    pub inference_backend: String,
    pub llm_api_key: Option<String>,
    pub default_chat_model: String,
    pub default_embedding_model: String,
    pub llm_base_url: Option<String>,
    pub admin_bootstrap_token: Option<String>,
    pub kratos_public_url: Option<String>,
    pub kratos_admin_url: Option<String>,
    pub kratos_admin_bearer_token: Option<String>,
    pub session_cache_ttl_seconds: u64,
}

impl Default for ControlPlaneConfig {
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:8787".into(),
            database_url: None,
            config_file: None,
            public_base_url: "https://the-boss.know-me.tools".into(),
            api_base_url: "https://api.know-me.tools".into(),
            auth_base_url: "https://auth.know-me.tools".into(),
            cdn_base_url: "https://cdn.know-me.tools".into(),
            jwt_audience: "the-boss-control-plane".into(),
            jwt_issuer: "https://api.know-me.tools".into(),
            jwt_signing_key_pem: None,
            jwt_public_key_pem: None,
            jwt_key_id: "the-boss-control-plane".into(),
            jwt_ttl_seconds: 300,
            inference_backend: "stub".into(),
            llm_api_key: None,
            default_chat_model: "openai/gpt-4o-mini".into(),
            default_embedding_model: "openai/text-embedding-3-small".into(),
            llm_base_url: None,
            admin_bootstrap_token: None,
            kratos_public_url: None,
            kratos_admin_url: None,
            kratos_admin_bearer_token: None,
            session_cache_ttl_seconds: 30,
        }
    }
}

impl ControlPlaneConfig {
    pub fn from_env() -> Self {
        config::BootstrapConfig::merge(
            Self {
                bind_addr: std::env::var("THE_BOSS_BIND_ADDR")
                    .unwrap_or_else(|_| "127.0.0.1:8787".into()),
                database_url: std::env::var("DATABASE_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                config_file: std::env::var("THE_BOSS_CONFIG_FILE")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                public_base_url: std::env::var("THE_BOSS_PUBLIC_BASE_URL")
                    .unwrap_or_else(|_| "https://the-boss.know-me.tools".into()),
                api_base_url: std::env::var("THE_BOSS_API_BASE_URL")
                    .unwrap_or_else(|_| "https://api.know-me.tools".into()),
                auth_base_url: std::env::var("THE_BOSS_AUTH_BASE_URL")
                    .unwrap_or_else(|_| "https://auth.know-me.tools".into()),
                cdn_base_url: std::env::var("THE_BOSS_CDN_BASE_URL")
                    .unwrap_or_else(|_| "https://cdn.know-me.tools".into()),
                jwt_audience: std::env::var("ORY_JWT_AUDIENCE")
                    .unwrap_or_else(|_| "the-boss-control-plane".into()),
                jwt_issuer: std::env::var("ORY_JWT_ISSUER")
                    .unwrap_or_else(|_| "https://api.know-me.tools".into()),
                jwt_signing_key_pem: std::env::var("THE_BOSS_JWT_SIGNING_KEY_PEM")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                jwt_public_key_pem: std::env::var("THE_BOSS_JWT_PUBLIC_KEY_PEM")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                jwt_key_id: std::env::var("THE_BOSS_JWT_KEY_ID")
                    .unwrap_or_else(|_| "the-boss-control-plane".into()),
                jwt_ttl_seconds: std::env::var("THE_BOSS_JWT_TTL_SECONDS")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(300),
                inference_backend: std::env::var("THE_BOSS_INFERENCE_BACKEND")
                    .unwrap_or_else(|_| "stub".into()),
                llm_api_key: std::env::var("THE_BOSS_LLM_API_KEY")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                default_chat_model: std::env::var("THE_BOSS_DEFAULT_CHAT_MODEL")
                    .unwrap_or_else(|_| "openai/gpt-4o-mini".into()),
                default_embedding_model: std::env::var("THE_BOSS_DEFAULT_EMBEDDING_MODEL")
                    .unwrap_or_else(|_| "openai/text-embedding-3-small".into()),
                llm_base_url: std::env::var("THE_BOSS_LLM_BASE_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                admin_bootstrap_token: std::env::var("THE_BOSS_ADMIN_BOOTSTRAP_TOKEN")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                kratos_public_url: std::env::var("THE_BOSS_KRATOS_PUBLIC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                kratos_admin_url: std::env::var("THE_BOSS_KRATOS_ADMIN_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                kratos_admin_bearer_token: std::env::var("THE_BOSS_KRATOS_ADMIN_BEARER_TOKEN")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
                session_cache_ttl_seconds: std::env::var("THE_BOSS_SESSION_CACHE_TTL_SECONDS")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(30),
            },
            None,
            config::ConfigSource::default(),
            config::ConfigSource::default(),
        )
    }
}

pub struct AppState {
    pub config: ControlPlaneConfig,
    config_store: Arc<dyn config::ConfigStore>,
    runtime_config: RwLock<ControlPlaneConfig>,
    inference: RwLock<Arc<dyn inference::InferenceBackend>>,
    kratos: kratos::KratosClient,
}

impl AppState {
    pub fn new(config: ControlPlaneConfig) -> Self {
        let store = Arc::new(config::InMemoryConfigStore::seeded(config.clone()));
        Self::new_with_config_store(config, store)
    }

    pub fn new_with_config_store(
        config: ControlPlaneConfig,
        config_store: Arc<dyn config::ConfigStore>,
    ) -> Self {
        let config = config_store
            .load_or_seed(config)
            .unwrap_or_else(|_| ControlPlaneConfig::default());
        let inference = inference::backend_from_config(&config);
        let kratos = kratos::KratosClient::new(&config);
        Self {
            config: config.clone(),
            config_store,
            runtime_config: RwLock::new(config),
            inference: RwLock::new(inference),
            kratos,
        }
    }

    pub async fn current_config(&self) -> ControlPlaneConfig {
        self.runtime_config.read().await.clone()
    }

    pub async fn inference_backend(&self) -> Arc<dyn inference::InferenceBackend> {
        self.inference.read().await.clone()
    }

    pub fn config_store(&self) -> Arc<dyn config::ConfigStore> {
        Arc::clone(&self.config_store)
    }

    pub fn kratos(&self) -> kratos::KratosClient {
        self.kratos.clone()
    }

    pub async fn apply_runtime_config(&self, config: ControlPlaneConfig) {
        *self.runtime_config.write().await = config.clone();
        *self.inference.write().await = inference::backend_from_config(&config);
    }
}

pub type SharedState = Arc<AppState>;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "the-boss-control-plane",
    })
}

pub fn app(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/.well-known/jwks.json", get(auth::jwt::jwks))
        .nest("/account", account::router())
        .nest("/admin", admin::router())
        .nest("/analytics", analytics::router())
        .nest("/artifacts", artifacts::router())
        .nest("/auth", auth::router())
        .nest("/catalog", catalog::router())
        .nest("/oauth", auth::router())
        .nest("/runtimes", runtimes::router())
        .nest("/admin/ui", static_ui::router())
        .nest("/updates", updates::router())
        .route("/geo/ip-country", get(updates::ip_country))
        .route("/v1/models", get(inference::models))
        .route("/v1/chat/completions", post(inference::chat_completions))
        .route("/v1/responses", post(inference::responses))
        .route("/v1/embeddings", post(inference::embeddings))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
