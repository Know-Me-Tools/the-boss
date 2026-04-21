use axum::{http::StatusCode, response::IntoResponse, Json};
use reqwest::header::{AUTHORIZATION, COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

use crate::ControlPlaneConfig;

#[derive(Clone)]
pub struct KratosClient {
    public_url: Option<String>,
    admin_url: Option<String>,
    admin_bearer_token: Option<String>,
    http: reqwest::Client,
}

impl KratosClient {
    pub fn new(config: &ControlPlaneConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("build reqwest client");
        Self {
            public_url: config.kratos_public_url.clone(),
            admin_url: config.kratos_admin_url.clone(),
            admin_bearer_token: config.kratos_admin_bearer_token.clone(),
            http,
        }
    }

    pub async fn whoami(
        &self,
        cookie: Option<&str>,
        bearer: Option<&str>,
    ) -> Result<KratosSession, KratosError> {
        let base_url = self
            .public_url
            .as_deref()
            .ok_or_else(|| KratosError::unavailable("Kratos public URL is not configured"))?;
        let mut request = self.http.get(url(base_url, &KratosRequest::Whoami.path()));
        if let Some(cookie) = cookie {
            request = request.header(COOKIE, cookie);
        }
        if let Some(bearer) = bearer {
            request = request.header(AUTHORIZATION, format!("Bearer {bearer}"));
        }
        self.send_json(request).await
    }

    pub async fn list_identities(&self) -> Result<Value, KratosError> {
        self.admin_json(
            reqwest::Method::GET,
            KratosRequest::ListIdentities.path(),
            None,
        )
        .await
    }

    pub async fn get_identity(&self, id: &str) -> Result<Value, KratosError> {
        self.admin_json(
            reqwest::Method::GET,
            KratosRequest::Identity(id).path(),
            None,
        )
        .await
    }

    pub async fn patch_identity(&self, id: &str, body: Value) -> Result<Value, KratosError> {
        self.admin_json(
            reqwest::Method::PATCH,
            KratosRequest::Identity(id).path(),
            Some(body),
        )
        .await
    }

    pub async fn identity_sessions(&self, id: &str) -> Result<Value, KratosError> {
        self.admin_json(
            reqwest::Method::GET,
            KratosRequest::IdentitySessions(id).path(),
            None,
        )
        .await
    }

    pub async fn revoke_session(&self, id: &str) -> Result<(), KratosError> {
        let _: Value = self
            .admin_json(
                reqwest::Method::DELETE,
                KratosRequest::Session(id).path(),
                None,
            )
            .await?;
        Ok(())
    }

    async fn admin_json<T: for<'de> Deserialize<'de>>(
        &self,
        method: reqwest::Method,
        path: String,
        body: Option<Value>,
    ) -> Result<T, KratosError> {
        let base_url = self
            .admin_url
            .as_deref()
            .ok_or_else(|| KratosError::unavailable("Kratos admin URL is not configured"))?;
        let mut request = self.http.request(method, url(base_url, &path));
        if let Some(token) = &self.admin_bearer_token {
            request = request.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        self.send_json(request).await
    }

    async fn send_json<T: for<'de> Deserialize<'de>>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, KratosError> {
        let response = request
            .send()
            .await
            .map_err(|error| KratosError::unavailable(error.to_string()))?;
        let status = response.status();
        if status == reqwest::StatusCode::NO_CONTENT {
            return serde_json::from_value(Value::Null)
                .map_err(|error| KratosError::upstream(StatusCode::NO_CONTENT, error.to_string()));
        }
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            let status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            return Err(KratosError::upstream(status, body));
        }
        serde_json::from_str(&body).map_err(|error| {
            KratosError::upstream(
                StatusCode::BAD_GATEWAY,
                format!("invalid Kratos JSON response: {error}"),
            )
        })
    }
}

#[derive(Clone, Copy)]
pub enum KratosRequest<'a> {
    Whoami,
    ListIdentities,
    Identity(&'a str),
    IdentitySessions(&'a str),
    Session(&'a str),
}

impl KratosRequest<'_> {
    pub fn path(&self) -> String {
        match self {
            Self::Whoami => "/sessions/whoami".into(),
            Self::ListIdentities => "/admin/identities".into(),
            Self::Identity(id) => format!("/admin/identities/{id}"),
            Self::IdentitySessions(id) => format!("/admin/identities/{id}/sessions"),
            Self::Session(id) => format!("/admin/sessions/{id}"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct KratosSession {
    pub id: String,
    #[serde(default)]
    pub active: bool,
    pub expires_at: Option<String>,
    pub authenticated_at: Option<String>,
    pub authenticator_assurance_level: Option<String>,
    pub identity: KratosIdentity,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct KratosIdentity {
    pub id: String,
    #[serde(default)]
    pub traits: Value,
    #[serde(default)]
    pub metadata_public: Value,
    #[serde(default)]
    pub metadata_admin: Value,
    pub state: Option<String>,
}

impl KratosIdentity {
    pub fn email(&self) -> Option<String> {
        self.traits
            .get("email")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    }

    pub fn roles(&self) -> Vec<String> {
        values_from_metadata(&self.metadata_public, "roles")
            .or_else(|| values_from_metadata(&self.metadata_admin, "roles"))
            .unwrap_or_default()
    }

    pub fn scope(&self) -> Option<String> {
        self.metadata_public
            .get("scope")
            .or_else(|| self.metadata_admin.get("scope"))
            .and_then(|value| match value {
                Value::String(scope) => Some(scope.clone()),
                Value::Array(values) => Some(
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                _ => None,
            })
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct KratosError {
    pub status: StatusCode,
    pub message: String,
}

impl KratosError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }

    fn upstream(status: StatusCode, message: impl Into<String>) -> Self {
        let status = if status == StatusCode::UNAUTHORIZED {
            StatusCode::UNAUTHORIZED
        } else if status.is_server_error() {
            StatusCode::SERVICE_UNAVAILABLE
        } else {
            status
        };
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for KratosError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(json!({
                "error": {
                    "message": self.message,
                    "type": "kratos_error"
                }
            })),
        )
            .into_response()
    }
}

fn url(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn values_from_metadata(metadata: &Value, field: &str) -> Option<Vec<String>> {
    match metadata.get(field)? {
        Value::Array(values) => Some(
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect(),
        ),
        Value::String(value) => Some(vec![value.clone()]),
        _ => None,
    }
}
