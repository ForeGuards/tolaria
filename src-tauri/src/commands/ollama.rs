//! Tauri command handlers wrapping `crate::ollama` for the frontend.
//!
//! All commands use `Result<T, String>` for ergonomic forwarding to JS, and the
//! streaming commands (`pull_ollama_model`, `stream_ai_completion`) emit events
//! through a `tauri::ipc::Channel<T>` so each invocation has its own bounded
//! event stream.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::ollama::{
    client::OllamaClient,
    types::{OllamaLoadedModel, OllamaModel, OllamaPullEvent, OllamaStatus},
};

#[derive(Debug, Clone, Deserialize)]
pub struct AiCompletionRequest {
    pub agent: String,
    #[serde(default)]
    pub model: Option<String>,
    pub system_prompt: String,
    pub user_prompt: String,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub ollama_base_url: Option<String>,
    /// For Claude/Codex agents: vault path to operate from. Optional when
    /// agent == "ollama" (which doesn't use the vault filesystem).
    #[serde(default)]
    pub vault_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiCompletionEvent {
    Text { delta: String },
    Done,
    Error { message: String },
}

fn ollama_client(base_url: Option<String>) -> OllamaClient {
    OllamaClient::new(base_url)
}

#[tauri::command]
pub async fn check_ollama_status(base_url: Option<String>) -> OllamaStatus {
    ollama_client(base_url).check_status().await
}

#[tauri::command]
pub async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<OllamaModel>, String> {
    ollama_client(base_url).list_models().await
}

#[tauri::command]
pub async fn get_ollama_loaded_models(
    base_url: Option<String>,
) -> Result<Vec<OllamaLoadedModel>, String> {
    ollama_client(base_url).list_loaded().await
}

#[tauri::command]
pub async fn delete_ollama_model(name: String, base_url: Option<String>) -> Result<(), String> {
    ollama_client(base_url).delete_model(&name).await
}

#[tauri::command]
pub async fn set_ollama_warm_models(
    active: Option<String>,
    warm: Vec<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    ollama_client(base_url)
        .warm_models(active.as_deref(), &warm)
        .await
}

#[tauri::command]
pub async fn pull_ollama_model(
    name: String,
    base_url: Option<String>,
    on_event: Channel<OllamaPullEvent>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = ollama_client(base_url);
    let mut stream = Box::pin(client.pull_model_stream(&name));
    while let Some(item) = stream.next().await {
        match item {
            Ok(event) => {
                let _ = on_event.send(event);
            }
            Err(err) => {
                let _ = on_event.send(OllamaPullEvent::Error {
                    message: err.clone(),
                });
                return Err(err);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn stream_ai_completion(
    request: AiCompletionRequest,
    on_event: Channel<AiCompletionEvent>,
) -> Result<(), String> {
    match request.agent.as_str() {
        "ollama" => stream_ollama_completion(request, on_event).await,
        "claude_code" | "codex" => {
            // V1: route Claude/Codex single-shot through the same channel via
            // the agentic stream, instructing the model not to use tools. Tool
            // events from claude/codex (if any) are dropped; only TextDelta is
            // forwarded.
            stream_cli_completion(request, on_event).await
        }
        other => Err(format!("Unknown agent: {other}")),
    }
}

async fn stream_ollama_completion(
    request: AiCompletionRequest,
    on_event: Channel<AiCompletionEvent>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let model = request
        .model
        .ok_or_else(|| "Ollama completion requires a model".to_string())?;
    let client = ollama_client(request.ollama_base_url);
    let mut stream = Box::pin(client.generate_stream(
        &model,
        &request.system_prompt,
        &request.user_prompt,
        request.temperature,
    ));
    while let Some(item) = stream.next().await {
        match item {
            Ok(delta) => {
                let _ = on_event.send(AiCompletionEvent::Text { delta });
            }
            Err(err) => {
                let _ = on_event.send(AiCompletionEvent::Error {
                    message: err.clone(),
                });
                return Err(err);
            }
        }
    }
    let _ = on_event.send(AiCompletionEvent::Done);
    Ok(())
}

#[cfg(desktop)]
async fn stream_cli_completion(
    request: AiCompletionRequest,
    on_event: Channel<AiCompletionEvent>,
) -> Result<(), String> {
    use crate::ai_agents::{AiAgentId, AiAgentStreamEvent, AiAgentStreamRequest};

    let agent = match request.agent.as_str() {
        "claude_code" => AiAgentId::ClaudeCode,
        "codex" => AiAgentId::Codex,
        other => return Err(format!("Unknown CLI agent: {other}")),
    };
    let vault_path = request
        .vault_path
        .ok_or_else(|| "CLI agents require a vault_path".to_string())?;
    let stream_request = AiAgentStreamRequest {
        agent,
        message: format!(
            "{system}\n\n{user}\n\nReturn ONLY the resulting text. Do not call tools. Do not explain.",
            system = request.system_prompt,
            user = request.user_prompt,
        ),
        system_prompt: Some(request.system_prompt.clone()),
        vault_path,
        model: None,
        ollama_base_url: None,
    };

    let on_event_for_stream = on_event.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::ai_agents::run_ai_agent_stream(stream_request, |event| {
            if let AiAgentStreamEvent::TextDelta { text } = event {
                let _ = on_event_for_stream.send(AiCompletionEvent::Text { delta: text });
            }
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?;

    match result {
        Ok(_) => {
            let _ = on_event.send(AiCompletionEvent::Done);
            Ok(())
        }
        Err(err) => {
            let _ = on_event.send(AiCompletionEvent::Error {
                message: err.clone(),
            });
            Err(err)
        }
    }
}

#[cfg(mobile)]
async fn stream_cli_completion(
    _request: AiCompletionRequest,
    _on_event: Channel<AiCompletionEvent>,
) -> Result<(), String> {
    Err("CLI AI agents are not available on mobile".into())
}
