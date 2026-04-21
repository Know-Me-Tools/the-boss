use std::{convert::Infallible, future::Future, pin::Pin, sync::Arc};

use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    Json,
};
use futures_util::{stream, Stream, StreamExt};
use liter_llm::types::responses::CreateResponseRequest;
use liter_llm::{
    ChatCompletionChunk, ChatCompletionRequest, ClientConfigBuilder, DefaultClient,
    EmbeddingRequest, LlmClient, ResponseClient,
};
use serde::Serialize;
use serde_json::{json, Value};

use crate::{catalog, ControlPlaneConfig, SharedState};

const CHAT_MODEL_ALIAS: &str = "theboss-default";
const EMBEDDING_MODEL_ALIAS: &str = "theboss-embedding";

type BackendFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, InferenceError>> + Send + 'a>>;
type EventStream = Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send + 'static>>;

#[derive(Serialize)]
pub struct ListResponse<T> {
    object: &'static str,
    data: Vec<T>,
}

#[derive(Debug, Clone)]
pub struct InferenceError {
    status: StatusCode,
    message: String,
    error_type: &'static str,
    code: Option<&'static str>,
    param: Option<String>,
}

impl InferenceError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
            error_type: "invalid_request_error",
            code: Some("invalid_request"),
            param: None,
        }
    }

    fn service_unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
            error_type: "service_unavailable",
            code: Some("service_unavailable"),
            param: None,
        }
    }

    fn upstream(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: message.into(),
            error_type: "upstream_error",
            code: Some("upstream_error"),
            param: None,
        }
    }

    fn from_liter(error: liter_llm::LiterLlmError) -> Self {
        match error {
            liter_llm::LiterLlmError::BadRequest { message } => Self::bad_request(message),
            other => Self::upstream(other.to_string()),
        }
    }
}

impl IntoResponse for InferenceError {
    fn into_response(self) -> Response {
        let body = json!({
            "error": {
                "message": self.message,
                "type": self.error_type,
                "param": self.param,
                "code": self.code
            }
        });
        (self.status, Json(body)).into_response()
    }
}

pub trait InferenceBackend: Send + Sync {
    fn chat(
        &self,
        request: ChatCompletionRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value>;
    fn chat_stream(
        &self,
        request: ChatCompletionRequest,
        public_model: String,
    ) -> BackendFuture<'_, EventStream>;
    fn responses(
        &self,
        request: CreateResponseRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value>;
    fn response_stream(
        &self,
        request: CreateResponseRequest,
        public_model: String,
    ) -> BackendFuture<'_, EventStream>;
    fn embeddings(
        &self,
        request: EmbeddingRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value>;
}

pub fn backend_from_config(config: &ControlPlaneConfig) -> Arc<dyn InferenceBackend> {
    match config.inference_backend.as_str() {
        "liter" => match LiterInferenceBackend::new(config) {
            Ok(backend) => Arc::new(backend),
            Err(error) => Arc::new(UnavailableInferenceBackend { error }),
        },
        _ => Arc::new(StubInferenceBackend),
    }
}

struct StubInferenceBackend;

impl InferenceBackend for StubInferenceBackend {
    fn chat(
        &self,
        request: ChatCompletionRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value> {
        Box::pin(async move {
            Ok(json!({
                "id": "chatcmpl_theboss_stub",
                "object": "chat.completion",
                "model": public_model,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "The Boss control plane is online."},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": request.messages.len(), "completion_tokens": 7, "total_tokens": 7}
            }))
        })
    }

    fn chat_stream(
        &self,
        _request: ChatCompletionRequest,
        public_model: String,
    ) -> BackendFuture<'_, EventStream> {
        Box::pin(async move {
            let chunks = vec![
                json!({
                    "id": "chatcmpl_theboss_stub",
                    "object": "chat.completion.chunk",
                    "model": public_model,
                    "choices": [{"index": 0, "delta": {"role": "assistant", "content": "The Boss control plane is online."}, "finish_reason": null}]
                }),
                json!({
                    "id": "chatcmpl_theboss_stub",
                    "object": "chat.completion.chunk",
                    "model": public_model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                }),
            ];
            Ok(sse_json_values(chunks))
        })
    }

    fn responses(
        &self,
        request: CreateResponseRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value> {
        Box::pin(async move {
            Ok(json!({
                "id": "resp_theboss_stub",
                "object": "response",
                "model": public_model,
                "status": "completed",
                "output": [{
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "The Boss control plane is online."}]
                }],
                "usage": {"input_tokens": if request.input.is_null() { 0 } else { 1 }, "output_tokens": 7, "total_tokens": 8}
            }))
        })
    }

    fn response_stream(
        &self,
        _request: CreateResponseRequest,
        public_model: String,
    ) -> BackendFuture<'_, EventStream> {
        Box::pin(async move {
            let events = vec![
                Event::default()
                    .event("response.created")
                    .json_data(json!({
                        "type": "response.created",
                        "response": {"id": "resp_theboss_stub", "model": public_model}
                    }))
                    .unwrap(),
                Event::default()
                    .event("response.output_text.delta")
                    .json_data(json!({
                        "type": "response.output_text.delta",
                        "delta": "The Boss control plane is online."
                    }))
                    .unwrap(),
                Event::default()
                    .event("response.completed")
                    .json_data(json!({
                        "type": "response.completed",
                        "response": {"id": "resp_theboss_stub", "status": "completed"}
                    }))
                    .unwrap(),
            ];
            Ok(sse_events(events))
        })
    }

    fn embeddings(
        &self,
        request: EmbeddingRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value> {
        Box::pin(async move {
            let input_count = match request.input {
                liter_llm::EmbeddingInput::Multiple(values) => values.len(),
                liter_llm::EmbeddingInput::Single(_) => 1,
            };
            let data: Vec<_> = (0..input_count)
                .map(|index| json!({"object": "embedding", "index": index, "embedding": [0.0, 0.0, 0.0]}))
                .collect();

            Ok(json!({
                "object": "list",
                "model": public_model,
                "data": data,
                "usage": {"prompt_tokens": input_count, "total_tokens": input_count}
            }))
        })
    }
}

struct LiterInferenceBackend {
    client: DefaultClient,
}

impl LiterInferenceBackend {
    fn new(config: &ControlPlaneConfig) -> Result<Self, InferenceError> {
        let api_key = config.llm_api_key.clone().ok_or_else(|| {
            InferenceError::service_unavailable(
                "THE_BOSS_LLM_API_KEY is required when THE_BOSS_INFERENCE_BACKEND=liter",
            )
        })?;
        let mut builder = ClientConfigBuilder::new(api_key);
        if let Some(base_url) = &config.llm_base_url {
            builder = builder.base_url(base_url);
        }
        let client = DefaultClient::new(builder.build(), Some(&config.default_chat_model))
            .map_err(|error| InferenceError::service_unavailable(error.to_string()))?;
        Ok(Self { client })
    }
}

impl InferenceBackend for LiterInferenceBackend {
    fn chat(
        &self,
        request: ChatCompletionRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value> {
        Box::pin(async move {
            let mut response = self
                .client
                .chat(request)
                .await
                .map_err(InferenceError::from_liter)?;
            response.model = public_model;
            serde_json::to_value(response)
                .map_err(|error| InferenceError::upstream(error.to_string()))
        })
    }

    fn chat_stream(
        &self,
        request: ChatCompletionRequest,
        public_model: String,
    ) -> BackendFuture<'_, EventStream> {
        Box::pin(async move {
            let stream = self
                .client
                .chat_stream(request)
                .await
                .map_err(InferenceError::from_liter)?;
            let chunks = stream.collect::<Vec<_>>().await;
            let mut events = Vec::with_capacity(chunks.len());
            for chunk in chunks {
                let mut chunk = chunk.map_err(InferenceError::from_liter)?;
                chunk.model = public_model.clone();
                events.push(chat_chunk_event(chunk)?);
            }
            Ok(sse_events(events))
        })
    }

    fn responses(
        &self,
        request: CreateResponseRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value> {
        Box::pin(async move {
            let mut response = self
                .client
                .create_response(request)
                .await
                .map_err(InferenceError::from_liter)?;
            response.model = public_model;
            serde_json::to_value(response)
                .map_err(|error| InferenceError::upstream(error.to_string()))
        })
    }

    fn response_stream(
        &self,
        _request: CreateResponseRequest,
        _public_model: String,
    ) -> BackendFuture<'_, EventStream> {
        Box::pin(async {
            Err(InferenceError::bad_request(
                "streaming /v1/responses requests are not supported by the liter backend",
            ))
        })
    }

    fn embeddings(
        &self,
        request: EmbeddingRequest,
        public_model: String,
    ) -> BackendFuture<'_, Value> {
        Box::pin(async move {
            let mut response = self
                .client
                .embed(request)
                .await
                .map_err(InferenceError::from_liter)?;
            response.model = public_model;
            serde_json::to_value(response)
                .map_err(|error| InferenceError::upstream(error.to_string()))
        })
    }
}

struct UnavailableInferenceBackend {
    error: InferenceError,
}

impl InferenceBackend for UnavailableInferenceBackend {
    fn chat(
        &self,
        _request: ChatCompletionRequest,
        _public_model: String,
    ) -> BackendFuture<'_, Value> {
        let error = self.error.clone();
        Box::pin(async move { Err(error) })
    }

    fn chat_stream(
        &self,
        _request: ChatCompletionRequest,
        _public_model: String,
    ) -> BackendFuture<'_, EventStream> {
        let error = self.error.clone();
        Box::pin(async move { Err(error) })
    }

    fn responses(
        &self,
        _request: CreateResponseRequest,
        _public_model: String,
    ) -> BackendFuture<'_, Value> {
        let error = self.error.clone();
        Box::pin(async move { Err(error) })
    }

    fn response_stream(
        &self,
        _request: CreateResponseRequest,
        _public_model: String,
    ) -> BackendFuture<'_, EventStream> {
        let error = self.error.clone();
        Box::pin(async move { Err(error) })
    }

    fn embeddings(
        &self,
        _request: EmbeddingRequest,
        _public_model: String,
    ) -> BackendFuture<'_, Value> {
        let error = self.error.clone();
        Box::pin(async move { Err(error) })
    }
}

pub async fn models() -> Json<ListResponse<catalog::ModelDescriptor>> {
    Json(ListResponse {
        object: "list",
        data: catalog::seed_models(),
    })
}

pub async fn chat_completions(
    State(state): State<SharedState>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Response {
    match chat_completions_impl(state, payload).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

async fn chat_completions_impl(
    state: SharedState,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Response, InferenceError> {
    let config = state.current_config().await;
    let inference = state.inference_backend().await;
    let mut body = json_body(payload)?;
    ensure_object_field(&mut body, "messages", json!([]))?;
    let public_model = public_model_or_default(&body, CHAT_MODEL_ALIAS)?;
    let upstream_model = chat_upstream_model(&config, &public_model)?;
    set_object_field(&mut body, "model", json!(upstream_model))?;

    let is_stream = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let request: ChatCompletionRequest = serde_json::from_value(body)
        .map_err(|error| InferenceError::bad_request(error.to_string()))?;

    if is_stream {
        Ok(Sse::new(inference.chat_stream(request, public_model).await?).into_response())
    } else {
        Ok(Json(inference.chat(request, public_model).await?).into_response())
    }
}

pub async fn responses(
    State(state): State<SharedState>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Response {
    match responses_impl(state, payload).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

async fn responses_impl(
    state: SharedState,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Response, InferenceError> {
    let config = state.current_config().await;
    let inference = state.inference_backend().await;
    let mut body = json_body(payload)?;
    ensure_object_field(&mut body, "input", Value::Null)?;
    let is_stream = body
        .as_object_mut()
        .and_then(|object| object.remove("stream"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let public_model = public_model_or_default(&body, CHAT_MODEL_ALIAS)?;
    let upstream_model = chat_upstream_model(&config, &public_model)?;
    set_object_field(&mut body, "model", json!(upstream_model))?;

    let request: CreateResponseRequest = serde_json::from_value(body)
        .map_err(|error| InferenceError::bad_request(error.to_string()))?;

    if is_stream {
        Ok(Sse::new(inference.response_stream(request, public_model).await?).into_response())
    } else {
        Ok(Json(inference.responses(request, public_model).await?).into_response())
    }
}

pub async fn embeddings(
    State(state): State<SharedState>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Response {
    match embeddings_impl(state, payload).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

async fn embeddings_impl(
    state: SharedState,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Response, InferenceError> {
    let config = state.current_config().await;
    let inference = state.inference_backend().await;
    let mut body = json_body(payload)?;
    let public_model = public_model_or_default(&body, EMBEDDING_MODEL_ALIAS)?;
    let upstream_model = embedding_upstream_model(&config, &public_model)?;
    set_object_field(&mut body, "model", json!(upstream_model))?;

    let request: EmbeddingRequest = serde_json::from_value(body)
        .map_err(|error| InferenceError::bad_request(error.to_string()))?;
    Ok(Json(inference.embeddings(request, public_model).await?).into_response())
}

fn json_body(payload: Result<Json<Value>, JsonRejection>) -> Result<Value, InferenceError> {
    payload
        .map(|Json(value)| value)
        .map_err(|error| InferenceError::bad_request(error.body_text()))
}

fn public_model_or_default(body: &Value, default_model: &str) -> Result<String, InferenceError> {
    match body.get("model") {
        Some(Value::String(model)) if !model.trim().is_empty() => Ok(model.clone()),
        Some(_) => Err(InferenceError::bad_request("'model' must be a string")),
        None => Ok(default_model.to_string()),
    }
}

fn chat_upstream_model(
    config: &ControlPlaneConfig,
    public_model: &str,
) -> Result<String, InferenceError> {
    if public_model == CHAT_MODEL_ALIAS {
        Ok(config.default_chat_model.clone())
    } else {
        Err(InferenceError::bad_request(format!(
            "unknown chat model alias '{public_model}'"
        )))
    }
}

fn embedding_upstream_model(
    config: &ControlPlaneConfig,
    public_model: &str,
) -> Result<String, InferenceError> {
    if public_model == EMBEDDING_MODEL_ALIAS {
        Ok(config.default_embedding_model.clone())
    } else {
        Err(InferenceError::bad_request(format!(
            "unknown embedding model alias '{public_model}'"
        )))
    }
}

fn ensure_object_field(
    body: &mut Value,
    field: &str,
    default: Value,
) -> Result<(), InferenceError> {
    let object = body
        .as_object_mut()
        .ok_or_else(|| InferenceError::bad_request("request body must be a JSON object"))?;
    object.entry(field.to_string()).or_insert(default);
    Ok(())
}

fn set_object_field(body: &mut Value, field: &str, value: Value) -> Result<(), InferenceError> {
    let object = body
        .as_object_mut()
        .ok_or_else(|| InferenceError::bad_request("request body must be a JSON object"))?;
    object.insert(field.to_string(), value);
    Ok(())
}

fn sse_json_values(values: Vec<Value>) -> EventStream {
    let events = values
        .into_iter()
        .map(|value| Event::default().json_data(value).unwrap())
        .collect();
    sse_events(events)
}

fn chat_chunk_event(chunk: ChatCompletionChunk) -> Result<Event, InferenceError> {
    Event::default()
        .json_data(chunk)
        .map_err(|error| InferenceError::upstream(error.to_string()))
}

fn sse_events(events: Vec<Event>) -> EventStream {
    Box::pin(
        stream::iter(events.into_iter().map(Ok::<_, Infallible>))
            .chain(stream::once(async { Ok(Event::default().data("[DONE]")) })),
    )
}
