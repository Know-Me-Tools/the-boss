use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::json;
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    thread,
};
use the_boss_control_plane::{app, AppState, ControlPlaneConfig};
use tower::ServiceExt;

#[derive(Debug, Clone)]
struct CapturedRequest {
    path: String,
    body: serde_json::Value,
}

struct MockUpstream {
    url: String,
    requests: Arc<Mutex<Vec<CapturedRequest>>>,
    _handle: thread::JoinHandle<()>,
}

impl MockUpstream {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock upstream");
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
                let path = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();

                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                        break;
                    }
                    if let Some((name, value)) = line.trim().split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            content_length = value.trim().parse().unwrap_or(0);
                        }
                    }
                }

                let mut body = vec![0; content_length];
                if content_length > 0 {
                    let _ = std::io::Read::read_exact(&mut reader, &mut body);
                }
                let body: serde_json::Value =
                    serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
                captured.lock().unwrap().push(CapturedRequest {
                    path: path.clone(),
                    body: body.clone(),
                });

                let response_body = match path.as_str() {
                    "/chat/completions" => {
                        if body
                            .get("stream")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false)
                        {
                            let chunk = json!({
                                "id": "chatcmpl_mock",
                                "object": "chat.completion.chunk",
                                "created": 1,
                                "model": body["model"],
                                "choices": [{"index": 0, "delta": {"content": "mock"}, "finish_reason": null}]
                            });
                            format!("data: {}\n\ndata: [DONE]\n\n", chunk)
                        } else {
                            json!({
                                "id": "chatcmpl_mock",
                                "object": "chat.completion",
                                "created": 1,
                                "model": body["model"],
                                "choices": [{
                                    "index": 0,
                                    "message": {"role": "assistant", "content": "mock"},
                                    "finish_reason": "stop"
                                }],
                                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
                            })
                            .to_string()
                        }
                    }
                    "/embeddings" => json!({
                        "object": "list",
                        "model": body["model"],
                        "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
                        "usage": {"prompt_tokens": 1, "total_tokens": 1}
                    })
                    .to_string(),
                    "/responses" => json!({
                        "id": "resp_mock",
                        "object": "response",
                        "created_at": 1,
                        "model": body["model"],
                        "status": "completed",
                        "output": [{"type": "message", "content": "mock"}],
                        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
                    })
                    .to_string(),
                    _ => json!({"error": {"message": "unexpected path"}}).to_string(),
                };

                let content_type = if path == "/chat/completions"
                    && body
                        .get("stream")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                {
                    "text/event-stream"
                } else {
                    "application/json"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
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

    fn requests(&self) -> Vec<CapturedRequest> {
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

fn test_app() -> axum::Router {
    test_app_with_config(test_config())
}

fn test_app_with_config(config: ControlPlaneConfig) -> axum::Router {
    let state = Arc::new(AppState::new(config));
    app(state)
}

#[tokio::test]
async fn exposes_openai_compatible_models() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/v1/models")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["object"], "list");
    assert_eq!(json["data"][0]["id"], "theboss-default");
}

#[tokio::test]
async fn streams_chat_completion_chunks() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"model":"theboss-default","stream":true,"messages":[]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(content_type.starts_with("text/event-stream"));
}

#[tokio::test]
async fn liter_backend_without_api_key_returns_openai_error() {
    let mut config = test_config();
    config.inference_backend = "liter".into();

    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"model":"theboss-default","messages":[]}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["type"], "service_unavailable");
    assert!(json["error"]["message"]
        .as_str()
        .unwrap()
        .contains("THE_BOSS_LLM_API_KEY"));
}

#[tokio::test]
async fn unknown_public_chat_model_returns_openai_error() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"model":"gpt-4o","messages":[]}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert!(json["error"]["message"]
        .as_str()
        .unwrap()
        .contains("unknown chat model alias"));
}

#[tokio::test]
async fn liter_chat_rewrites_public_model_to_upstream_and_back() {
    let upstream = MockUpstream::start();
    let mut config = test_config();
    config.inference_backend = "liter".into();
    config.llm_api_key = Some("test-key".into());
    config.default_chat_model = "openai/gpt-4o-mini".into();
    config.llm_base_url = Some(upstream.url.clone());

    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"model":"theboss-default","messages":[{"role":"user","content":"hi"}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["model"], "theboss-default");

    let requests = upstream.requests();
    assert_eq!(requests[0].path, "/chat/completions");
    assert_eq!(requests[0].body["model"], "openai/gpt-4o-mini");
}

#[tokio::test]
async fn liter_streaming_chat_emits_sse_done_sentinel() {
    let upstream = MockUpstream::start();
    let mut config = test_config();
    config.inference_backend = "liter".into();
    config.llm_api_key = Some("test-key".into());
    config.default_chat_model = "openai/gpt-4o-mini".into();
    config.llm_base_url = Some(upstream.url.clone());

    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"model":"theboss-default","stream":true,"messages":[{"role":"user","content":"hi"}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8(body.to_vec()).unwrap();
    assert!(body.contains("data:"));
    assert!(body.contains("[DONE]"));
    assert!(body.contains("theboss-default"));
}

#[tokio::test]
async fn liter_embeddings_rewrite_public_model_to_upstream_and_back() {
    let upstream = MockUpstream::start();
    let mut config = test_config();
    config.inference_backend = "liter".into();
    config.llm_api_key = Some("test-key".into());
    config.default_embedding_model = "openai/text-embedding-3-small".into();
    config.llm_base_url = Some(upstream.url.clone());

    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/embeddings")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"model":"theboss-embedding","input":"hello"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["model"], "theboss-embedding");
    assert_eq!(json["data"][0]["embedding"][0], 0.1);

    let requests = upstream.requests();
    assert_eq!(requests[0].path, "/embeddings");
    assert_eq!(requests[0].body["model"], "openai/text-embedding-3-small");
}

#[tokio::test]
async fn liter_responses_uses_response_client_and_public_model_alias() {
    let upstream = MockUpstream::start();
    let mut config = test_config();
    config.inference_backend = "liter".into();
    config.llm_api_key = Some("test-key".into());
    config.default_chat_model = "openai/gpt-4o-mini".into();
    config.llm_base_url = Some(upstream.url.clone());

    let response = test_app_with_config(config)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/responses")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"model":"theboss-default","input":"hello"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["id"], "resp_mock");
    assert_eq!(json["model"], "theboss-default");

    let requests = upstream.requests();
    assert_eq!(requests[0].path, "/responses");
    assert_eq!(requests[0].body["model"], "openai/gpt-4o-mini");
}

#[tokio::test]
async fn returns_runtime_manifest_with_cloudflare_cdn_url() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/runtimes/manifests/codex/darwin/arm64/latest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["runtime"], "codex");
    assert!(json["artifact"]["httpsUrl"]
        .as_str()
        .unwrap()
        .starts_with("https://cdn.know-me.tools"));
}
