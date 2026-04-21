use axum::{extract::State, Json};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rsa::{
    pkcs1::DecodeRsaPublicKey, pkcs8::DecodePublicKey, traits::PublicKeyParts, RsaPublicKey,
};
use serde_json::json;

use crate::{auth::claims::Claims, ControlPlaneConfig, SharedState};

const DEV_HS256_SECRET: &[u8] = b"the-boss-control-plane-dev-secret-change-me";

pub fn claims_for_session(
    config: &ControlPlaneConfig,
    session: &crate::kratos::KratosSession,
) -> Claims {
    let now = Utc::now().timestamp() as usize;
    let kratos_exp = session
        .expires_at
        .as_ref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.timestamp().max(0) as usize);
    let exp = kratos_exp.unwrap_or(now + config.jwt_ttl_seconds as usize);
    Claims {
        sub: session.identity.id.clone(),
        sid: Some(session.id.clone()),
        aud: Some(config.jwt_audience.clone()),
        iss: Some(config.jwt_issuer.clone()),
        exp: exp.min(now + config.jwt_ttl_seconds as usize),
        scope: session.identity.scope(),
        roles: session.identity.roles(),
        aal: session.authenticator_assurance_level.clone(),
        email: session.identity.email(),
    }
}

pub fn encode_internal_jwt(
    config: &ControlPlaneConfig,
    claims: &Claims,
) -> jsonwebtoken::errors::Result<String> {
    let mut header = Header::new(jwt_algorithm(config));
    header.kid = Some(config.jwt_key_id.clone());
    jsonwebtoken::encode(&header, claims, &encoding_key(config)?)
}

pub fn decode_internal_jwt(
    config: &ControlPlaneConfig,
    token: &str,
) -> jsonwebtoken::errors::Result<Claims> {
    let mut validation = Validation::new(jwt_algorithm(config));
    validation.validate_aud = false;
    let data = jsonwebtoken::decode::<Claims>(token, &decoding_key(config)?, &validation)?;
    Ok(data.claims)
}

pub async fn jwks(State(state): State<SharedState>) -> Json<serde_json::Value> {
    let config = state.current_config().await;
    Json(public_jwks(&config))
}

pub fn public_jwks(config: &ControlPlaneConfig) -> serde_json::Value {
    if let Some(public_pem) = &config.jwt_public_key_pem {
        match rsa_public_key_from_pem(public_pem) {
            Ok(public_key) => json!({
                "keys": [{
                    "kty": "RSA",
                    "kid": config.jwt_key_id,
                    "use": "sig",
                    "alg": "RS256",
                    "n": URL_SAFE_NO_PAD.encode(public_key.n().to_bytes_be()),
                    "e": URL_SAFE_NO_PAD.encode(public_key.e().to_bytes_be())
                }]
            }),
            Err(error) => json!({
                "keys": [],
                "error": format!("invalid RS256 public key configuration: {error}")
            }),
        }
    } else {
        json!({
            "keys": [],
            "warning": "no RS256 public key configured; development HS256 signing fallback is active"
        })
    }
}

fn rsa_public_key_from_pem(pem: &str) -> Result<RsaPublicKey, String> {
    RsaPublicKey::from_public_key_pem(pem)
        .or_else(|_| RsaPublicKey::from_pkcs1_pem(pem))
        .map_err(|error| error.to_string())
}

fn jwt_algorithm(config: &ControlPlaneConfig) -> Algorithm {
    if config.jwt_signing_key_pem.is_some() && config.jwt_public_key_pem.is_some() {
        Algorithm::RS256
    } else {
        Algorithm::HS256
    }
}

fn encoding_key(config: &ControlPlaneConfig) -> jsonwebtoken::errors::Result<EncodingKey> {
    if let Some(pem) = &config.jwt_signing_key_pem {
        EncodingKey::from_rsa_pem(pem.as_bytes())
    } else {
        Ok(EncodingKey::from_secret(DEV_HS256_SECRET))
    }
}

fn decoding_key(config: &ControlPlaneConfig) -> jsonwebtoken::errors::Result<DecodingKey> {
    if let Some(pem) = &config.jwt_public_key_pem {
        DecodingKey::from_rsa_pem(pem.as_bytes())
    } else {
        Ok(DecodingKey::from_secret(DEV_HS256_SECRET))
    }
}

pub fn bearer_token(header: Option<&str>) -> Option<String> {
    let header = header?;
    let (scheme, token) = header.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("bearer") && !token.trim().is_empty() {
        Some(token.trim().to_string())
    } else {
        None
    }
}

pub fn token_preview(token: &str) -> String {
    let encoded = URL_SAFE_NO_PAD.encode(token.as_bytes());
    encoded.chars().take(12).collect()
}
