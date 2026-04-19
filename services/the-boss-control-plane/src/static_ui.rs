use axum::{
    extract::Path,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use include_dir::{include_dir, Dir};

use crate::SharedState;

static ADMIN_UI: Dir<'_> = include_dir!("$OUT_DIR/admin-ui");

pub fn router() -> Router<SharedState> {
    Router::new()
        .route("/", get(index))
        .route("/{*path}", get(asset))
}

async fn index() -> Response {
    html_response(index_html())
}

async fn asset(Path(path): Path<String>) -> Response {
    let path = path.trim_start_matches('/');
    if let Some(file) = ADMIN_UI.get_file(path) {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static(content_type(path)),
        );
        return (StatusCode::OK, headers, file.contents().to_vec()).into_response();
    }
    html_response(index_html())
}

fn index_html() -> &'static [u8] {
    ADMIN_UI
        .get_file("index.html")
        .map(|file| file.contents())
        .unwrap_or(b"<!doctype html><html><body><h1>The Boss Control Plane</h1></body></html>")
}

fn html_response(bytes: &'static [u8]) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    (StatusCode::OK, headers, bytes).into_response()
}

fn content_type(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".json") {
        "application/json"
    } else {
        "application/octet-stream"
    }
}
