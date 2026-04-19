use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::json;

use crate::{auth::claims::Claims, ControlPlaneConfig, SharedState};

pub mod claims;
pub mod jwt;

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub claims: Claims,
}

impl AuthenticatedUser {
    pub fn actor(&self) -> &str {
        &self.claims.sub
    }
}

#[derive(Debug, Serialize)]
struct SessionResponse {
    subject: String,
    session_id: Option<String>,
    roles: Vec<String>,
    scope: Option<String>,
    aal: Option<String>,
    email: Option<String>,
}

#[derive(Debug)]
pub struct AuthError {
    status: StatusCode,
    message: String,
}

impl AuthError {
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "error": {
                    "message": self.message,
                    "type": "authentication_error"
                }
            })),
        )
            .into_response()
    }
}

pub async fn require_scope(
    state: &SharedState,
    headers: &HeaderMap,
    scope: &str,
) -> Result<AuthenticatedUser, AuthError> {
    let user = authenticate(state, headers).await?;
    if user.claims.has_scope(scope) || user.claims.has_role("admin") {
        Ok(user)
    } else {
        Err(AuthError::forbidden(format!(
            "missing required scope '{scope}'"
        )))
    }
}

pub async fn authenticate(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<AuthenticatedUser, AuthError> {
    let config = state.current_config().await;
    if let Some(token) = jwt::bearer_token(header_value(headers, header::AUTHORIZATION).as_deref())
    {
        if is_bootstrap_token(&config, &token) {
            return Ok(bootstrap_user(&config));
        }
        if let Ok(claims) = jwt::decode_internal_jwt(&config, &token) {
            return Ok(AuthenticatedUser { claims });
        }
    }
    let cookie = header_value(headers, header::COOKIE);
    let bearer = jwt::bearer_token(header_value(headers, header::AUTHORIZATION).as_deref());
    if cookie.is_none() && bearer.is_none() {
        return Err(AuthError::unauthorized("missing session credentials"));
    }
    let session = state
        .kratos()
        .whoami(cookie.as_deref(), bearer.as_deref())
        .await
        .map_err(|error| AuthError {
            status: error.status,
            message: error.message,
        })?;
    let claims = jwt::claims_for_session(&config, &session);
    Ok(AuthenticatedUser { claims })
}

async fn session(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    match authenticate(&state, &headers).await {
        Ok(user) => Json(session_response(&user.claims)).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn exchange(State(state): State<SharedState>, headers: HeaderMap) -> Response {
    match exchange_impl(&state, &headers).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn exchange_impl(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<serde_json::Value, AuthError> {
    let user = authenticate(state, headers).await?;
    let config = state.current_config().await;
    let token = jwt::encode_internal_jwt(&config, &user.claims)
        .map_err(|error| AuthError::unauthorized(error.to_string()))?;
    Ok(json!({
        "token_type": "Bearer",
        "access_token": token,
        "expires_at": user.claims.exp,
        "session": session_response(&user.claims)
    }))
}

pub async fn revoke() -> Json<serde_json::Value> {
    Json(json!({"revoked": true}))
}

async fn logout() -> Json<serde_json::Value> {
    Json(json!({"revoked": true}))
}

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/session", get(session))
        .route("/exchange", post(exchange))
        .route("/logout", post(logout))
        .route("/revoke", post(revoke))
}

fn session_response(claims: &Claims) -> SessionResponse {
    SessionResponse {
        subject: claims.sub.clone(),
        session_id: claims.sid.clone(),
        roles: claims.roles.clone(),
        scope: claims.scope.clone(),
        aal: claims.aal.clone(),
        email: claims.email.clone(),
    }
}

fn bootstrap_user(config: &ControlPlaneConfig) -> AuthenticatedUser {
    AuthenticatedUser {
        claims: Claims {
            sub: "bootstrap-admin".into(),
            sid: None,
            aud: Some(config.jwt_audience.clone()),
            iss: Some(config.jwt_issuer.clone()),
            exp: usize::MAX,
            scope: Some(
                [
                    "admin:config:read",
                    "admin:config:write",
                    "admin:identities:read",
                    "admin:identities:write",
                ]
                .join(" "),
            ),
            roles: vec!["admin".into()],
            aal: Some("bootstrap".into()),
            email: None,
        },
    }
}

fn is_bootstrap_token(config: &ControlPlaneConfig, token: &str) -> bool {
    config
        .admin_bootstrap_token
        .as_deref()
        .map(|candidate| candidate == token)
        .unwrap_or(false)
}

fn header_value(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string)
}
