//! HTTP client for the Ollama daemon.
//!
//! Wraps `/api/version`, `/api/tags`, `/api/ps`, `/api/generate`,
//! `/api/pull`, and `/api/delete`. Streaming endpoints (`generate`, `pull`)
//! return [`futures::Stream`]s of typed events; non-streaming endpoints
//! return `Result<T, String>`.

use futures::Stream;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};

use super::keep_warm::{plan_warm_actions, KEEP_ALIVE_FOREVER};
use super::stream::{ndjson_lines, parse_generate_line, parse_pull_line, GenerateLineOutcome};
use super::types::{
    OllamaLoadedModel, OllamaModel, OllamaPullEvent, OllamaStatus, PsResponse, TagsResponse,
    VersionResponse, DEFAULT_BASE_URL,
};

/// Request timeout for non-streaming calls. Streaming requests intentionally
/// do not set this — they may run for minutes (model pull) or longer.
const REQUEST_TIMEOUT_SECS: u64 = 10;

/// HTTP client for a single Ollama daemon.
#[derive(Clone, Debug)]
pub struct OllamaClient {
    base_url: String,
    http: Client,
}

impl OllamaClient {
    /// Construct a client. Pass `None` for the default `http://localhost:11434`.
    pub fn new(base_url: Option<String>) -> Self {
        let base_url = base_url
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        let base_url = base_url.trim_end_matches('/').to_string();
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { base_url, http }
    }

    /// The base URL this client targets (with no trailing slash).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    // -----------------------------------------------------------------------
    // Status / metadata
    // -----------------------------------------------------------------------

    /// Probe `/api/version`. Always returns a status (never an `Err`) so that
    /// callers can render UI for both reachable and unreachable daemons.
    pub async fn check_status(&self) -> OllamaStatus {
        match self.fetch_version().await {
            Ok(version) => OllamaStatus {
                installed: true,
                base_url: self.base_url.clone(),
                version: Some(version),
                error: None,
            },
            Err(err) => OllamaStatus {
                installed: false,
                base_url: self.base_url.clone(),
                version: None,
                error: Some(err),
            },
        }
    }

    async fn fetch_version(&self) -> Result<String, String> {
        let url = format!("{}/api/version", self.base_url);
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("connection failed: {e}"))?;
        let parsed: VersionResponse = response
            .error_for_status()
            .map_err(|e| format!("daemon returned error: {e}"))?
            .json()
            .await
            .map_err(|e| format!("invalid version JSON: {e}"))?;
        Ok(parsed.version)
    }

    /// `GET /api/tags` — list all installed models.
    pub async fn list_models(&self) -> Result<Vec<OllamaModel>, String> {
        let url = format!("{}/api/tags", self.base_url);
        let parsed: TagsResponse = self.get_json(&url).await?;
        Ok(parsed.models.into_iter().map(OllamaModel::from).collect())
    }

    /// `GET /api/ps` — list models currently resident in memory.
    pub async fn list_loaded(&self) -> Result<Vec<OllamaLoadedModel>, String> {
        let url = format!("{}/api/ps", self.base_url);
        let parsed: PsResponse = self.get_json(&url).await?;
        Ok(parsed
            .models
            .into_iter()
            .map(OllamaLoadedModel::from)
            .collect())
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, String> {
        self.http
            .get(url)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("daemon returned error: {e}"))?
            .json()
            .await
            .map_err(|e| format!("invalid JSON: {e}"))
    }

    // -----------------------------------------------------------------------
    // Mutating non-streaming
    // -----------------------------------------------------------------------

    /// `DELETE /api/delete` — delete a model.
    pub async fn delete_model(&self, name: &str) -> Result<(), String> {
        let url = format!("{}/api/delete", self.base_url);
        let response = self
            .http
            .delete(&url)
            .json(&json!({ "name": name }))
            .send()
            .await
            .map_err(|e| format!("delete failed: {e}"))?;
        response
            .error_for_status()
            .map(|_| ())
            .map_err(|e| format!("daemon returned error: {e}"))
    }

    /// Warm models by sending `keep_alive = -1` for each. Best-effort: a
    /// failure on one model is reported but does not stop the loop.
    pub async fn warm_models(
        &self,
        active: Option<&str>,
        warm: &[String],
    ) -> Result<(), String> {
        let actions = plan_warm_actions(active, warm);
        let mut errors: Vec<String> = Vec::new();
        for action in actions {
            if let Err(err) = self.touch_model(&action.model, action.keep_alive).await {
                errors.push(format!("{}: {err}", action.model));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    /// Send a no-op `/api/generate` to set a model's `keep_alive`.
    async fn touch_model(&self, model: &str, keep_alive: i64) -> Result<(), String> {
        let url = format!("{}/api/generate", self.base_url);
        let body = json!({
            "model": model,
            "prompt": "",
            "stream": false,
            "keep_alive": keep_alive,
        });
        let response = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("warm request failed: {e}"))?;
        response
            .error_for_status()
            .map(|_| ())
            .map_err(|e| format!("daemon returned error: {e}"))
    }

    // -----------------------------------------------------------------------
    // Streaming
    // -----------------------------------------------------------------------

    /// `POST /api/pull` (stream=true). Yields parsed pull events.
    pub fn pull_model_stream(
        &self,
        name: &str,
    ) -> impl Stream<Item = Result<OllamaPullEvent, String>> {
        let url = format!("{}/api/pull", self.base_url);
        let body = json!({ "name": name, "stream": true });
        let request = self.http.post(url).json(&body);
        ndjson_event_stream(request, parse_pull_line)
    }

    /// `POST /api/generate` (stream=true). Yields text deltas; ends after the
    /// `done:true` chunk.
    pub fn generate_stream(
        &self,
        model: &str,
        system: &str,
        prompt: &str,
        temperature: Option<f32>,
    ) -> impl Stream<Item = Result<String, String>> {
        let url = format!("{}/api/generate", self.base_url);
        let body = build_generate_body(model, system, prompt, temperature);
        let request = self.http.post(url).json(&body);
        generate_text_stream(request)
    }
}

/// Build the JSON body for `/api/generate`.
fn build_generate_body(model: &str, system: &str, prompt: &str, temperature: Option<f32>) -> Value {
    let mut body = json!({
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": true,
        "keep_alive": KEEP_ALIVE_FOREVER,
    });
    if let Some(temp) = temperature {
        body["options"] = json!({ "temperature": temp });
    }
    body
}

/// Drive an NDJSON streaming request and forward parsed events. The
/// `parse_line` closure converts a non-empty line into `Ok(Some(event))`,
/// `Ok(None)` (skip), or `Err(...)`.
fn ndjson_event_stream<F, T>(
    request: reqwest::RequestBuilder,
    parse_line: F,
) -> impl Stream<Item = Result<T, String>>
where
    F: Fn(&str) -> Result<Option<T>, String> + Send + Clone + 'static,
    T: Send + 'static,
{
    async_stream::try_stream_workaround(async move {
        let response = request
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("daemon returned error: {e}"))?;
        Ok(response.bytes_stream())
    }, parse_line)
}

/// Specialised generate streamer: stops yielding once `done:true` is seen.
fn generate_text_stream(
    request: reqwest::RequestBuilder,
) -> impl Stream<Item = Result<String, String>> {
    async_stream::try_stream_workaround_generate(async move {
        let response = request
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("daemon returned error: {e}"))?;
        Ok(response.bytes_stream())
    })
}

// ---------------------------------------------------------------------------
// Stream plumbing — kept in a private sub-module so that the outer module
// reads cleanly. We don't use the `async-stream` crate; we hand-roll with
// `futures::stream::unfold` to avoid an extra dependency.
// ---------------------------------------------------------------------------

mod async_stream {
    use super::*;
    use bytes::Bytes;
    use futures::stream::{self, BoxStream};

    /// Streams typed events from an NDJSON HTTP body. Skips lines for which
    /// `parse_line` returns `Ok(None)`; aborts on the first parse error.
    pub(super) fn try_stream_workaround<F, T>(
        connect: impl std::future::Future<
                Output = Result<
                    impl Stream<Item = reqwest::Result<Bytes>> + Send + Unpin + 'static,
                    String,
                >,
            > + Send
            + 'static,
        parse_line: F,
    ) -> BoxStream<'static, Result<T, String>>
    where
        F: Fn(&str) -> Result<Option<T>, String> + Send + Clone + 'static,
        T: Send + 'static,
    {
        Box::pin(stream::once(connect).flat_map(move |connected| {
            into_event_stream(connected, &parse_line)
        }))
    }

    fn into_event_stream<F, T, S>(
        connected: Result<S, String>,
        parse_line: &F,
    ) -> BoxStream<'static, Result<T, String>>
    where
        F: Fn(&str) -> Result<Option<T>, String> + Send + 'static + Clone,
        T: Send + 'static,
        S: Stream<Item = reqwest::Result<Bytes>> + Send + Unpin + 'static,
    {
        match connected {
            Err(err) => Box::pin(stream::iter(vec![Err(err)])),
            Ok(byte_stream) => {
                let parse_line = parse_line.clone();
                let lines = ndjson_lines(byte_stream);
                Box::pin(lines.filter_map(move |line_result| {
                    let parse_line = parse_line.clone();
                    async move { dispatch_line(line_result, &parse_line) }
                }))
            }
        }
    }

    fn dispatch_line<F, T>(
        line_result: Result<String, String>,
        parse_line: &F,
    ) -> Option<Result<T, String>>
    where
        F: Fn(&str) -> Result<Option<T>, String>,
    {
        match line_result {
            Err(err) => Some(Err(err)),
            Ok(line) => match parse_line(&line) {
                Ok(Some(event)) => Some(Ok(event)),
                Ok(None) => None,
                Err(err) => Some(Err(err)),
            },
        }
    }

    /// Generate-specific streamer: stops after `done:true`.
    pub(super) fn try_stream_workaround_generate(
        connect: impl std::future::Future<
                Output = Result<
                    impl Stream<Item = reqwest::Result<Bytes>> + Send + Unpin + 'static,
                    String,
                >,
            > + Send
            + 'static,
    ) -> BoxStream<'static, Result<String, String>> {
        Box::pin(
            stream::once(connect).flat_map(|connected| match connected {
                Err(err) => {
                    Box::pin(stream::iter(vec![Err(err)])) as BoxStream<'static, _>
                }
                Ok(byte_stream) => Box::pin(generate_lines_to_deltas(ndjson_lines(byte_stream))),
            }),
        )
    }

    /// Map line-stream → text-delta-stream, terminating after the done line.
    fn generate_lines_to_deltas<S>(
        lines: S,
    ) -> impl Stream<Item = Result<String, String>> + Send + 'static
    where
        S: Stream<Item = Result<String, String>> + Send + 'static,
    {
        stream::unfold(
            (Box::pin(lines), false),
            |(mut lines, done)| async move {
                if done {
                    return None;
                }
                loop {
                    let line = match lines.next().await? {
                        Ok(line) => line,
                        Err(err) => return Some((Err(err), (lines, true))),
                    };
                    match parse_generate_line(&line) {
                        Ok(GenerateLineOutcome::Delta(text)) => {
                            return Some((Ok(text), (lines, false)));
                        }
                        Ok(GenerateLineOutcome::Skip) => continue,
                        Ok(GenerateLineOutcome::Done) => return None,
                        Err(err) => return Some((Err(err), (lines, true))),
                    }
                }
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt as _;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn spawn_server() -> MockServer {
        MockServer::start().await
    }

    fn client(server: &MockServer) -> OllamaClient {
        OllamaClient::new(Some(server.uri()))
    }

    #[test]
    fn new_with_none_uses_default_base_url() {
        let c = OllamaClient::new(None);
        assert_eq!(c.base_url(), DEFAULT_BASE_URL);
    }

    #[test]
    fn new_strips_trailing_slash() {
        let c = OllamaClient::new(Some("http://example.com/".into()));
        assert_eq!(c.base_url(), "http://example.com");
    }

    #[test]
    fn new_with_empty_string_uses_default() {
        let c = OllamaClient::new(Some(String::new()));
        assert_eq!(c.base_url(), DEFAULT_BASE_URL);
    }

    #[tokio::test]
    async fn check_status_returns_version_when_reachable() {
        let server = spawn_server().await;
        Mock::given(method("GET"))
            .and(path("/api/version"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "version": "0.5.1" })))
            .mount(&server)
            .await;

        let status = client(&server).check_status().await;
        assert!(status.installed);
        assert_eq!(status.version.as_deref(), Some("0.5.1"));
        assert!(status.error.is_none());
    }

    #[tokio::test]
    async fn check_status_unreachable_sets_error() {
        // Use a port that nothing is listening on.
        let c = OllamaClient::new(Some("http://127.0.0.1:1".into()));
        let status = c.check_status().await;
        assert!(!status.installed);
        assert!(status.version.is_none());
        assert!(status.error.is_some());
    }

    #[tokio::test]
    async fn check_status_500_error_is_reported() {
        let server = spawn_server().await;
        Mock::given(method("GET"))
            .and(path("/api/version"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let status = client(&server).check_status().await;
        assert!(!status.installed);
        assert!(status.error.is_some());
    }

    #[tokio::test]
    async fn list_models_parses_tags_response() {
        let server = spawn_server().await;
        Mock::given(method("GET"))
            .and(path("/api/tags"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "models": [{
                    "name": "llama3.2:latest",
                    "size": 2_000_000_000u64,
                    "modified_at": "2025-01-02T03:04:05Z",
                    "details": {
                        "parameter_size": "3.2B",
                        "quantization_level": "Q4_K_M",
                        "family": "llama"
                    }
                }]
            })))
            .mount(&server)
            .await;

        let models = client(&server).list_models().await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "llama3.2:latest");
        assert_eq!(models[0].parameter_size.as_deref(), Some("3.2B"));
        assert_eq!(models[0].quantization.as_deref(), Some("Q4_K_M"));
        assert_eq!(models[0].family.as_deref(), Some("llama"));
    }

    #[tokio::test]
    async fn list_loaded_parses_ps_response() {
        let server = spawn_server().await;
        Mock::given(method("GET"))
            .and(path("/api/ps"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "models": [{
                    "name": "llama3.2:latest",
                    "size_vram": 2_500_000_000u64,
                    "expires_at": "2025-01-02T03:04:05Z"
                }]
            })))
            .mount(&server)
            .await;

        let loaded = client(&server).list_loaded().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "llama3.2:latest");
        assert_eq!(loaded[0].size_vram, 2_500_000_000);
    }

    #[tokio::test]
    async fn delete_model_sends_delete_with_name() {
        let server = spawn_server().await;
        Mock::given(method("DELETE"))
            .and(path("/api/delete"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        client(&server).delete_model("foo:latest").await.unwrap();
    }

    #[tokio::test]
    async fn delete_model_propagates_404() {
        let server = spawn_server().await;
        Mock::given(method("DELETE"))
            .and(path("/api/delete"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let err = client(&server).delete_model("foo").await.unwrap_err();
        assert!(err.contains("error"));
    }

    #[tokio::test]
    async fn generate_stream_yields_deltas_then_stops_on_done() {
        let server = spawn_server().await;
        let body = "{\"response\":\"Hello\",\"done\":false}\n\
                    {\"response\":\" world\",\"done\":false}\n\
                    {\"response\":\"\",\"done\":true}\n";
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let stream = client(&server).generate_stream("m", "sys", "hi", Some(0.5));
        let collected: Vec<_> = stream.collect().await;
        let texts: Vec<String> = collected.into_iter().map(|r| r.unwrap()).collect();
        assert_eq!(texts, vec!["Hello".to_string(), " world".to_string()]);
    }

    #[tokio::test]
    async fn pull_stream_emits_progress_and_done() {
        let server = spawn_server().await;
        let body = "{\"status\":\"pulling manifest\"}\n\
                    {\"status\":\"downloading\",\"completed\":50,\"total\":100}\n\
                    {\"status\":\"success\"}\n";
        Mock::given(method("POST"))
            .and(path("/api/pull"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let events: Vec<OllamaPullEvent> = client(&server)
            .pull_model_stream("foo")
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], OllamaPullEvent::Status { .. }));
        assert!(matches!(events[1], OllamaPullEvent::Progress { .. }));
        assert!(matches!(events[2], OllamaPullEvent::Done {}));
    }

    #[tokio::test]
    async fn warm_models_calls_generate_for_each_model() {
        let server = spawn_server().await;
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(2) // active + warm[0] (not active)
            .mount(&server)
            .await;

        let warm = vec!["base".to_string(), "active".to_string()];
        client(&server)
            .warm_models(Some("active"), &warm)
            .await
            .unwrap();
        // wiremock verifies on drop via `expect(2)`.
    }

    #[tokio::test]
    async fn warm_models_uses_keep_alive_minus_one() {
        let server = spawn_server().await;
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .and(wiremock::matchers::body_partial_json(
                json!({ "keep_alive": -1, "model": "active", "stream": false }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;
        client(&server)
            .warm_models(Some("active"), &[])
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn warm_models_reports_error_when_call_fails() {
        let server = spawn_server().await;
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let err = client(&server)
            .warm_models(Some("foo"), &[])
            .await
            .unwrap_err();
        assert!(err.contains("foo"));
    }

    #[test]
    fn build_generate_body_includes_temperature() {
        let body = build_generate_body("m", "sys", "p", Some(0.5));
        let temp = body["options"]["temperature"].as_f64().unwrap();
        assert!((temp - 0.5).abs() < 1e-6);
        assert_eq!(body["stream"], json!(true));
        assert_eq!(body["keep_alive"], json!(-1));
        assert_eq!(body["model"], json!("m"));
        assert_eq!(body["system"], json!("sys"));
        assert_eq!(body["prompt"], json!("p"));
    }

    #[test]
    fn build_generate_body_omits_options_when_no_temperature() {
        let body = build_generate_body("m", "", "p", None);
        assert!(body.get("options").is_none());
    }
}
