use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::json;
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    thread,
};
use the_boss_control_plane::{
    app,
    auth::claims::Claims,
    config::{BootstrapConfig, ConfigPatch, ConfigSource, ConfigStore, InMemoryConfigStore},
    kratos::KratosRequest,
    AppState, ControlPlaneConfig,
};
use tower::ServiceExt;

#[derive(Debug, Clone)]
struct CapturedHttpRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    cookie: Option<String>,
}

struct MockKratos {
    url: String,
    requests: Arc<Mutex<Vec<CapturedHttpRequest>>>,
    _handle: thread::JoinHandle<()>,
}

impl MockKratos {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock kratos");
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);

        let handle = thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    continue;
                }
                let mut request_parts = request_line.split_whitespace();
                let method = request_parts.next().unwrap_or("GET").to_string();
                let path = request_parts.next().unwrap_or("/").to_string();

                let mut authorization = None;
                let mut cookie = None;
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                        break;
                    }
                    if let Some((name, value)) = line.trim().split_once(':') {
                        if name.eq_ignore_ascii_case("authorization") {
                            authorization = Some(value.trim().to_string());
                        } else if name.eq_ignore_ascii_case("cookie") {
                            cookie = Some(value.trim().to_string());
                        } else if name.eq_ignore_ascii_case("content-length") {
                            content_length = value.trim().parse().unwrap_or(0);
                        }
                    }
                }

                let mut body = vec![0; content_length];
                if content_length > 0 {
                    let _ = std::io::Read::read_exact(&mut reader, &mut body);
                }
                let _body: serde_json::Value =
                    serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));

                captured.lock().unwrap().push(CapturedHttpRequest {
                    method: method.clone(),
                    path: path.clone(),
                    authorization: authorization.clone(),
                    cookie,
                });

                let (status, response_body) = match (method.as_str(), path.as_str()) {
                    ("GET", "/sessions/whoami") => (
                        "200 OK",
                        json!({
                            "id": "sess_123",
                            "active": true,
                            "expires_at": "2099-01-01T00:00:00Z",
                            "authenticated_at": "2026-01-01T00:00:00Z",
                            "authenticator_assurance_level": "aal2",
                            "identity": {
                                "id": "user_123",
                                "traits": {"email": "admin@example.com"},
                                "metadata_public": {"roles": ["admin"], "scope": "admin:config:read admin:config:write admin:identities:read admin:identities:write"}
                            }
                        }),
                    ),
                    ("GET", "/admin/identities") => (
                        "200 OK",
                        json!([{
                            "id": "user_123",
                            "traits": {"email": "admin@example.com"},
                            "metadata_public": {"roles": ["admin"]},
                            "state": "active"
                        }]),
                    ),
                    ("GET", "/admin/identities/user_123") => (
                        "200 OK",
                        json!({
                            "id": "user_123",
                            "traits": {"email": "admin@example.com"},
                            "metadata_public": {"roles": ["admin"]},
                            "state": "active"
                        }),
                    ),
                    ("PATCH", "/admin/identities/user_123") => (
                        "200 OK",
                        json!({
                            "id": "user_123",
                            "traits": {"email": "admin@example.com"},
                            "metadata_public": {"roles": ["admin"], "scope": "admin:config:read"},
                            "state": "active"
                        }),
                    ),
                    ("GET", "/admin/identities/user_123/sessions") => {
                        ("200 OK", json!([{"id": "sess_123", "active": true}]))
                    }
                    ("DELETE", "/admin/sessions/sess_123") => ("204 No Content", json!(null)),
                    _ => ("404 Not Found", json!({"error": "not found"})),
                };

                let body = if response_body.is_null() {
                    String::new()
                } else {
                    response_body.to_string()
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        Self {
            url,
            requests,
            _handle: handle,
        }
    }

    fn requests(&self) -> Vec<CapturedHttpRequest> {
        self.requests.lock().unwrap().clone()
    }
}

fn test_config() -> ControlPlaneConfig {
    ControlPlaneConfig {
        bind_addr: "127.0.0.1:0".into(),
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
        jwt_key_id: "test-key".into(),
        jwt_ttl_seconds: 300,
        inference_backend: "stub".into(),
        llm_api_key: None,
        default_chat_model: "openai/gpt-4o-mini".into(),
        default_embedding_model: "openai/text-embedding-3-small".into(),
        llm_base_url: None,
        admin_bootstrap_token: Some("bootstrap-secret".into()),
        kratos_public_url: None,
        kratos_admin_url: None,
        kratos_admin_bearer_token: None,
        session_cache_ttl_seconds: 30,
    }
}

fn test_app_with_config(config: ControlPlaneConfig) -> axum::Router {
    let store = Arc::new(InMemoryConfigStore::seeded(config.clone()));
    let state = Arc::new(AppState::new_with_config_store(config, store));
    app(state)
}

#[test]
fn bootstrap_config_merges_sources_and_db_wins_after_seed() {
    let defaults = ControlPlaneConfig::default();
    let yaml = ConfigSource {
        api_base_url: Some("https://yaml.example.com".into()),
        inference_backend: Some("liter".into()),
        default_chat_model: Some("openai/yaml".into()),
        ..ConfigSource::default()
    };
    let env = ConfigSource {
        api_base_url: Some("https://env.example.com".into()),
        default_chat_model: Some("openai/env".into()),
        ..ConfigSource::default()
    };
    let cli = ConfigSource {
        default_chat_model: Some("openai/cli".into()),
        ..ConfigSource::default()
    };
    let merged = BootstrapConfig::merge(defaults, Some(yaml), env, cli);
    assert_eq!(merged.api_base_url, "https://env.example.com");
    assert_eq!(merged.inference_backend, "liter");
    assert_eq!(merged.default_chat_model, "openai/cli");

    let store = InMemoryConfigStore::seeded(merged.clone());
    let boot_again = BootstrapConfig::merge(
        ControlPlaneConfig::default(),
        None,
        ConfigSource {
            api_base_url: Some("https://changed.example.com".into()),
            ..ConfigSource::default()
        },
        ConfigSource::default(),
    );
    assert_eq!(
        store.load_or_seed(boot_again).unwrap().api_base_url,
        merged.api_base_url
    );
}

#[tokio::test]
async fn admin_config_requires_scope_and_redacts_secrets() {
    let mut config = test_config();
    config.llm_api_key = Some("secret-key".into());
    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .uri("/admin/config")
                .header(header::AUTHORIZATION, "Bearer bootstrap-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["config"]["llm_api_key"], "********");

    let response = test_app_with_config(test_config())
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/admin/config")
                .header(header::AUTHORIZATION, "Bearer bootstrap-secret")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_string(&ConfigPatch {
                        revision: 1,
                        config: ConfigSource {
                            default_chat_model: Some("openai/gpt-4o".into()),
                            ..ConfigSource::default()
                        },
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn kratos_cookie_session_can_be_exchanged_for_internal_jwt() {
    let kratos = MockKratos::start();
    let mut config = test_config();
    config.kratos_public_url = Some(kratos.url.clone());
    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/exchange")
                .header(header::COOKIE, "ory_kratos_session=cookie-value")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["access_token"].as_str().unwrap().len() > 20);
    assert_eq!(json["session"]["subject"], "user_123");
    assert_eq!(
        kratos.requests()[0].cookie.as_deref(),
        Some("ory_kratos_session=cookie-value")
    );
}

#[tokio::test]
async fn kratos_session_token_forwards_bearer_to_whoami() {
    let kratos = MockKratos::start();
    let mut config = test_config();
    config.kratos_public_url = Some(kratos.url.clone());
    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header(header::AUTHORIZATION, "Bearer ory-session-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        kratos.requests()[0].authorization.as_deref(),
        Some("Bearer ory-session-token")
    );
}

#[tokio::test]
async fn internal_jwt_verifies_without_calling_kratos() {
    let claims = Claims {
        sub: "user_123".into(),
        sid: Some("sess_123".into()),
        aud: Some("the-boss-control-plane".into()),
        iss: Some("https://api.know-me.tools".into()),
        exp: 4_071_268_800,
        scope: Some("admin:config:read".into()),
        roles: vec!["admin".into()],
        aal: Some("aal2".into()),
        email: Some("admin@example.com".into()),
    };
    let config = test_config();
    let token = the_boss_control_plane::auth::jwt::encode_internal_jwt(&config, &claims).unwrap();
    let decoded = the_boss_control_plane::auth::jwt::decode_internal_jwt(&config, &token).unwrap();
    assert_eq!(decoded.sub, "user_123");
    assert_eq!(decoded.roles, vec!["admin"]);
}

#[tokio::test]
async fn kratos_admin_identity_routes_use_admin_rest_api() {
    let kratos = MockKratos::start();
    let mut config = test_config();
    config.kratos_admin_url = Some(kratos.url.clone());
    config.kratos_admin_bearer_token = Some("ory-admin-token".into());
    let app = test_app_with_config(config);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/admin/identities")
                .header(header::AUTHORIZATION, "Bearer bootstrap-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let requests = kratos.requests();
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/admin/identities");
    assert_eq!(
        requests[0].authorization.as_deref(),
        Some("Bearer ory-admin-token")
    );
}

#[tokio::test]
async fn static_admin_ui_falls_back_to_index_html() {
    let app = test_app_with_config(test_config());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/admin/ui/config")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("The Boss Control Plane"));
}

#[test]
fn kratos_request_paths_are_direct_rest_paths() {
    assert_eq!(KratosRequest::Whoami.path(), "/sessions/whoami");
    assert_eq!(KratosRequest::ListIdentities.path(), "/admin/identities");
    assert_eq!(
        KratosRequest::IdentitySessions("user_123").path(),
        "/admin/identities/user_123/sessions"
    );
}
