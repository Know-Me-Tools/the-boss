use std::sync::Mutex;

use axum::{http::StatusCode, response::IntoResponse, Json};
use chrono::{DateTime, Utc};
use clap::Parser;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::ControlPlaneConfig;

#[derive(Debug, Parser)]
pub struct CliConfig {
    #[arg(long, env = "THE_BOSS_CONFIG_FILE")]
    pub config: Option<String>,
    #[arg(long, env = "THE_BOSS_BIND_ADDR")]
    pub bind_addr: Option<String>,
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: Option<String>,
    #[arg(long, env = "THE_BOSS_PUBLIC_BASE_URL")]
    pub public_base_url: Option<String>,
    #[arg(long, env = "THE_BOSS_API_BASE_URL")]
    pub api_base_url: Option<String>,
    #[arg(long, env = "THE_BOSS_AUTH_BASE_URL")]
    pub auth_base_url: Option<String>,
    #[arg(long, env = "THE_BOSS_CDN_BASE_URL")]
    pub cdn_base_url: Option<String>,
    #[arg(long, env = "ORY_JWT_AUDIENCE")]
    pub jwt_audience: Option<String>,
    #[arg(long, env = "ORY_JWT_ISSUER")]
    pub jwt_issuer: Option<String>,
    #[arg(long, env = "THE_BOSS_INFERENCE_BACKEND")]
    pub inference_backend: Option<String>,
    #[arg(long, env = "THE_BOSS_LLM_API_KEY")]
    pub llm_api_key: Option<String>,
    #[arg(long, env = "THE_BOSS_DEFAULT_CHAT_MODEL")]
    pub default_chat_model: Option<String>,
    #[arg(long, env = "THE_BOSS_DEFAULT_EMBEDDING_MODEL")]
    pub default_embedding_model: Option<String>,
    #[arg(long, env = "THE_BOSS_LLM_BASE_URL")]
    pub llm_base_url: Option<String>,
    #[arg(long, env = "THE_BOSS_ADMIN_BOOTSTRAP_TOKEN")]
    pub admin_bootstrap_token: Option<String>,
    #[arg(long, env = "THE_BOSS_KRATOS_PUBLIC_URL")]
    pub kratos_public_url: Option<String>,
    #[arg(long, env = "THE_BOSS_KRATOS_ADMIN_URL")]
    pub kratos_admin_url: Option<String>,
    #[arg(long, env = "THE_BOSS_KRATOS_ADMIN_BEARER_TOKEN")]
    pub kratos_admin_bearer_token: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ConfigSource {
    pub public_base_url: Option<String>,
    pub api_base_url: Option<String>,
    pub auth_base_url: Option<String>,
    pub cdn_base_url: Option<String>,
    pub jwt_audience: Option<String>,
    pub jwt_issuer: Option<String>,
    pub jwt_signing_key_pem: Option<String>,
    pub jwt_public_key_pem: Option<String>,
    pub jwt_key_id: Option<String>,
    pub jwt_ttl_seconds: Option<u64>,
    pub inference_backend: Option<String>,
    pub llm_api_key: Option<String>,
    pub default_chat_model: Option<String>,
    pub default_embedding_model: Option<String>,
    pub llm_base_url: Option<String>,
    pub admin_bootstrap_token: Option<String>,
    pub kratos_public_url: Option<String>,
    pub kratos_admin_url: Option<String>,
    pub kratos_admin_bearer_token: Option<String>,
    pub session_cache_ttl_seconds: Option<u64>,
}

impl ConfigSource {
    pub fn from_env() -> Self {
        Self {
            public_base_url: env_non_empty("THE_BOSS_PUBLIC_BASE_URL"),
            api_base_url: env_non_empty("THE_BOSS_API_BASE_URL"),
            auth_base_url: env_non_empty("THE_BOSS_AUTH_BASE_URL"),
            cdn_base_url: env_non_empty("THE_BOSS_CDN_BASE_URL"),
            jwt_audience: env_non_empty("ORY_JWT_AUDIENCE"),
            jwt_issuer: env_non_empty("ORY_JWT_ISSUER"),
            jwt_signing_key_pem: env_non_empty("THE_BOSS_JWT_SIGNING_KEY_PEM"),
            jwt_public_key_pem: env_non_empty("THE_BOSS_JWT_PUBLIC_KEY_PEM"),
            jwt_key_id: env_non_empty("THE_BOSS_JWT_KEY_ID"),
            jwt_ttl_seconds: env_non_empty("THE_BOSS_JWT_TTL_SECONDS")
                .and_then(|value| value.parse().ok()),
            inference_backend: env_non_empty("THE_BOSS_INFERENCE_BACKEND"),
            llm_api_key: env_non_empty("THE_BOSS_LLM_API_KEY"),
            default_chat_model: env_non_empty("THE_BOSS_DEFAULT_CHAT_MODEL"),
            default_embedding_model: env_non_empty("THE_BOSS_DEFAULT_EMBEDDING_MODEL"),
            llm_base_url: env_non_empty("THE_BOSS_LLM_BASE_URL"),
            admin_bootstrap_token: env_non_empty("THE_BOSS_ADMIN_BOOTSTRAP_TOKEN"),
            kratos_public_url: env_non_empty("THE_BOSS_KRATOS_PUBLIC_URL"),
            kratos_admin_url: env_non_empty("THE_BOSS_KRATOS_ADMIN_URL"),
            kratos_admin_bearer_token: env_non_empty("THE_BOSS_KRATOS_ADMIN_BEARER_TOKEN"),
            session_cache_ttl_seconds: env_non_empty("THE_BOSS_SESSION_CACHE_TTL_SECONDS")
                .and_then(|value| value.parse().ok()),
        }
    }

    pub fn from_cli(cli: &CliConfig) -> Self {
        Self {
            public_base_url: cli.public_base_url.clone(),
            api_base_url: cli.api_base_url.clone(),
            auth_base_url: cli.auth_base_url.clone(),
            cdn_base_url: cli.cdn_base_url.clone(),
            jwt_audience: cli.jwt_audience.clone(),
            jwt_issuer: cli.jwt_issuer.clone(),
            inference_backend: cli.inference_backend.clone(),
            llm_api_key: cli.llm_api_key.clone(),
            default_chat_model: cli.default_chat_model.clone(),
            default_embedding_model: cli.default_embedding_model.clone(),
            llm_base_url: cli.llm_base_url.clone(),
            admin_bootstrap_token: cli.admin_bootstrap_token.clone(),
            kratos_public_url: cli.kratos_public_url.clone(),
            kratos_admin_url: cli.kratos_admin_url.clone(),
            kratos_admin_bearer_token: cli.kratos_admin_bearer_token.clone(),
            ..Self::default()
        }
    }

    pub fn from_yaml_path(path: &str) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)?;
        Ok(serde_yaml::from_str(&contents)?)
    }

    pub fn apply_to(self, config: &mut ControlPlaneConfig) {
        assign(&mut config.public_base_url, self.public_base_url);
        assign(&mut config.api_base_url, self.api_base_url);
        assign(&mut config.auth_base_url, self.auth_base_url);
        assign(&mut config.cdn_base_url, self.cdn_base_url);
        assign(&mut config.jwt_audience, self.jwt_audience);
        assign(&mut config.jwt_issuer, self.jwt_issuer);
        assign_option(&mut config.jwt_signing_key_pem, self.jwt_signing_key_pem);
        assign_option(&mut config.jwt_public_key_pem, self.jwt_public_key_pem);
        assign(&mut config.jwt_key_id, self.jwt_key_id);
        assign_copy(&mut config.jwt_ttl_seconds, self.jwt_ttl_seconds);
        assign(&mut config.inference_backend, self.inference_backend);
        assign_option(&mut config.llm_api_key, self.llm_api_key);
        assign(&mut config.default_chat_model, self.default_chat_model);
        assign(
            &mut config.default_embedding_model,
            self.default_embedding_model,
        );
        assign_option(&mut config.llm_base_url, self.llm_base_url);
        assign_option(
            &mut config.admin_bootstrap_token,
            self.admin_bootstrap_token,
        );
        assign_option(&mut config.kratos_public_url, self.kratos_public_url);
        assign_option(&mut config.kratos_admin_url, self.kratos_admin_url);
        assign_option(
            &mut config.kratos_admin_bearer_token,
            self.kratos_admin_bearer_token,
        );
        assign_copy(
            &mut config.session_cache_ttl_seconds,
            self.session_cache_ttl_seconds,
        );
    }

    pub fn apply_managed_to(mut self, config: &mut ControlPlaneConfig) {
        self.admin_bootstrap_token = None;
        self.apply_to(config);
    }
}

#[derive(Clone, Debug)]
pub struct BootstrapConfig;

impl BootstrapConfig {
    pub fn merge(
        mut defaults: ControlPlaneConfig,
        yaml: Option<ConfigSource>,
        env: ConfigSource,
        cli: ConfigSource,
    ) -> ControlPlaneConfig {
        if let Some(yaml) = yaml {
            yaml.apply_to(&mut defaults);
        }
        env.apply_to(&mut defaults);
        cli.apply_to(&mut defaults);
        defaults
    }

    pub fn from_cli_env() -> anyhow::Result<ControlPlaneConfig> {
        let cli = CliConfig::parse();
        let mut defaults = ControlPlaneConfig::default();
        defaults.bind_addr = cli
            .bind_addr
            .clone()
            .or_else(|| env_non_empty("THE_BOSS_BIND_ADDR"))
            .unwrap_or(defaults.bind_addr);
        defaults.database_url = cli
            .database_url
            .clone()
            .or_else(|| env_non_empty("DATABASE_URL"));
        defaults.config_file = cli
            .config
            .clone()
            .or_else(|| env_non_empty("THE_BOSS_CONFIG_FILE"));
        let yaml = defaults
            .config_file
            .as_deref()
            .map(ConfigSource::from_yaml_path)
            .transpose()?;
        Ok(Self::merge(
            defaults,
            yaml,
            ConfigSource::from_env(),
            ConfigSource::from_cli(&cli),
        ))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConfigPatch {
    pub revision: i64,
    pub config: ConfigSource,
}

#[derive(Clone, Debug, Serialize)]
pub struct ConfigSnapshot {
    pub revision: i64,
    pub config: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct ConfigRecord {
    pub revision: i64,
    pub config: ControlPlaneConfig,
    pub updated_at: DateTime<Utc>,
}

pub trait ConfigStore: Send + Sync {
    fn load_or_seed(&self, seed: ControlPlaneConfig) -> Result<ControlPlaneConfig, ConfigError>;
    fn snapshot(&self) -> Result<ConfigRecord, ConfigError>;
    fn patch(&self, patch: ConfigPatch, actor: &str) -> Result<ConfigRecord, ConfigError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("configuration revision conflict")]
    Conflict,
    #[error("{0}")]
    Store(String),
}

impl IntoResponse for ConfigError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::Conflict => StatusCode::CONFLICT,
            Self::Store(_) => StatusCode::SERVICE_UNAVAILABLE,
        };
        (
            status,
            Json(json!({
                "error": {
                    "message": self.to_string(),
                    "type": "configuration_error"
                }
            })),
        )
            .into_response()
    }
}

pub struct InMemoryConfigStore {
    record: Mutex<ConfigRecord>,
}

impl InMemoryConfigStore {
    pub fn seeded(config: ControlPlaneConfig) -> Self {
        Self {
            record: Mutex::new(ConfigRecord {
                revision: 1,
                config,
                updated_at: Utc::now(),
            }),
        }
    }
}

impl ConfigStore for InMemoryConfigStore {
    fn load_or_seed(&self, _seed: ControlPlaneConfig) -> Result<ControlPlaneConfig, ConfigError> {
        Ok(self.record.lock().unwrap().config.clone())
    }

    fn snapshot(&self) -> Result<ConfigRecord, ConfigError> {
        Ok(self.record.lock().unwrap().clone())
    }

    fn patch(&self, patch: ConfigPatch, _actor: &str) -> Result<ConfigRecord, ConfigError> {
        let mut record = self.record.lock().unwrap();
        if patch.revision != record.revision {
            return Err(ConfigError::Conflict);
        }
        patch.config.apply_managed_to(&mut record.config);
        record.revision += 1;
        record.updated_at = Utc::now();
        Ok(record.clone())
    }
}

#[derive(Clone)]
pub struct PgConfigStore {
    pool: PgPool,
}

impl PgConfigStore {
    pub async fn connect(database_url: &str) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn load_or_seed_async(
        &self,
        seed: ControlPlaneConfig,
    ) -> Result<ControlPlaneConfig, ConfigError> {
        sqlx::query(
            r#"
            insert into control_plane_config (id, revision, config)
            values (true, 1, $1)
            on conflict (id) do nothing
            "#,
        )
        .bind(serde_json::to_value(&seed).map_err(|error| ConfigError::Store(error.to_string()))?)
        .execute(&self.pool)
        .await
        .map_err(|error| ConfigError::Store(error.to_string()))?;

        let record = self.snapshot_async().await?;
        Ok(record.config)
    }

    pub async fn snapshot_async(&self) -> Result<ConfigRecord, ConfigError> {
        let row: (i64, serde_json::Value, DateTime<Utc>) = sqlx::query_as(
            "select revision, config, updated_at from control_plane_config where id = true",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| ConfigError::Store(error.to_string()))?;
        Ok(ConfigRecord {
            revision: row.0,
            config: serde_json::from_value(row.1)
                .map_err(|error| ConfigError::Store(error.to_string()))?,
            updated_at: row.2,
        })
    }

    pub async fn patch_async(
        &self,
        patch: ConfigPatch,
        actor: &str,
    ) -> Result<ConfigRecord, ConfigError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| ConfigError::Store(error.to_string()))?;
        let row: (i64, serde_json::Value, DateTime<Utc>) = sqlx::query_as(
            "select revision, config, updated_at from control_plane_config where id = true for update",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| ConfigError::Store(error.to_string()))?;
        if row.0 != patch.revision {
            return Err(ConfigError::Conflict);
        }
        let mut config: ControlPlaneConfig =
            serde_json::from_value(row.1).map_err(|error| ConfigError::Store(error.to_string()))?;
        patch.config.clone().apply_managed_to(&mut config);
        let next_revision = row.0 + 1;
        let config_json =
            serde_json::to_value(&config).map_err(|error| ConfigError::Store(error.to_string()))?;
        sqlx::query(
            "update control_plane_config set revision = $1, config = $2, updated_at = now() where id = true",
        )
        .bind(next_revision)
        .bind(config_json)
        .execute(&mut *tx)
        .await
        .map_err(|error| ConfigError::Store(error.to_string()))?;
        sqlx::query(
            "insert into control_plane_config_audit (revision, actor, changes) values ($1, $2, $3)",
        )
        .bind(next_revision)
        .bind(actor)
        .bind(
            serde_json::to_value(&patch.config)
                .map_err(|error| ConfigError::Store(error.to_string()))?,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| ConfigError::Store(error.to_string()))?;
        tx.commit()
            .await
            .map_err(|error| ConfigError::Store(error.to_string()))?;
        self.snapshot_async().await
    }
}

impl ConfigStore for PgConfigStore {
    fn load_or_seed(&self, seed: ControlPlaneConfig) -> Result<ControlPlaneConfig, ConfigError> {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(self.load_or_seed_async(seed))
        })
    }

    fn snapshot(&self) -> Result<ConfigRecord, ConfigError> {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(self.snapshot_async())
        })
    }

    fn patch(&self, patch: ConfigPatch, actor: &str) -> Result<ConfigRecord, ConfigError> {
        let actor = actor.to_string();
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(self.patch_async(patch, &actor))
        })
    }
}

pub fn snapshot_response(record: ConfigRecord) -> ConfigSnapshot {
    ConfigSnapshot {
        revision: record.revision,
        config: redacted_config(record.config),
    }
}

fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn assign(target: &mut String, value: Option<String>) {
    if let Some(value) = value {
        *target = value;
    }
}

fn assign_option(target: &mut Option<String>, value: Option<String>) {
    if value.is_some() {
        *target = value;
    }
}

fn assign_copy<T: Copy>(target: &mut T, value: Option<T>) {
    if let Some(value) = value {
        *target = value;
    }
}

fn redact(value: Option<&str>) -> Option<String> {
    value.map(|_| "********".to_string())
}

fn redacted_config(mut config: ControlPlaneConfig) -> serde_json::Value {
    let llm_api_key = redact(config.llm_api_key.as_deref());
    let admin_bootstrap_token = redact(config.admin_bootstrap_token.as_deref());
    let kratos_admin_bearer_token = redact(config.kratos_admin_bearer_token.as_deref());
    let jwt_signing_key_pem = redact(config.jwt_signing_key_pem.as_deref());
    config.llm_api_key = llm_api_key;
    config.admin_bootstrap_token = admin_bootstrap_token;
    config.kratos_admin_bearer_token = kratos_admin_bearer_token;
    config.jwt_signing_key_pem = jwt_signing_key_pem;
    serde_json::to_value(config).unwrap_or_else(|_| json!({}))
}
