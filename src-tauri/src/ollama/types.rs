//! Wire types for the Ollama HTTP API and the public client surface.
//!
//! These types are kept small and parsing-focused. The `Raw*` structs mirror
//! the JSON shapes returned by Ollama; they are converted into the public
//! `Ollama*` types via [`From`]/helper functions so that the public surface
//! stays stable even if Ollama changes its wire format.

use serde::{Deserialize, Serialize};

/// Default base URL used when the caller passes `None`.
pub const DEFAULT_BASE_URL: &str = "http://localhost:11434";

// ---------------------------------------------------------------------------
// Public surface (matches Wave 1 contract exactly)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaStatus {
    pub installed: bool,
    pub base_url: String,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
    pub family: Option<String>,
    pub modified_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaLoadedModel {
    pub name: String,
    pub size_vram: u64,
    pub expires_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OllamaPullEvent {
    Status { status: String },
    Progress { completed: u64, total: u64, status: String },
    Done {},
    Error { message: String },
}

// ---------------------------------------------------------------------------
// Wire types (private to the module — used by client/stream)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct VersionResponse {
    pub version: String,
}

#[derive(Deserialize)]
pub(crate) struct TagsResponse {
    pub models: Vec<RawTagModel>,
}

#[derive(Deserialize)]
pub(crate) struct RawTagModel {
    pub name: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub modified_at: String,
    #[serde(default)]
    pub details: Option<RawTagDetails>,
}

#[derive(Deserialize, Default)]
pub(crate) struct RawTagDetails {
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
    pub family: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct PsResponse {
    pub models: Vec<RawPsModel>,
}

#[derive(Deserialize)]
pub(crate) struct RawPsModel {
    pub name: String,
    #[serde(default)]
    pub size_vram: u64,
    #[serde(default)]
    pub expires_at: Option<String>,
}

/// One NDJSON line of `/api/generate` while streaming.
#[derive(Deserialize)]
pub(crate) struct GenerateChunk {
    #[serde(default)]
    pub response: String,
    #[serde(default)]
    pub done: bool,
}

/// One NDJSON line of `/api/pull`.
#[derive(Deserialize)]
pub(crate) struct PullChunk {
    #[serde(default)]
    pub status: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

impl From<RawTagModel> for OllamaModel {
    fn from(raw: RawTagModel) -> Self {
        let details = raw.details.unwrap_or_default();
        OllamaModel {
            name: raw.name,
            size: raw.size,
            parameter_size: details.parameter_size,
            quantization: details.quantization_level,
            family: details.family,
            modified_at: raw.modified_at,
        }
    }
}

impl From<RawPsModel> for OllamaLoadedModel {
    fn from(raw: RawPsModel) -> Self {
        OllamaLoadedModel {
            name: raw.name,
            size_vram: raw.size_vram,
            expires_at: raw.expires_at,
        }
    }
}

impl PullChunk {
    /// Convert a pull NDJSON line into a typed [`OllamaPullEvent`].
    pub(crate) fn into_event(self) -> OllamaPullEvent {
        if let Some(message) = self.error {
            return OllamaPullEvent::Error { message };
        }
        if let (Some(completed), Some(total)) = (self.completed, self.total) {
            return OllamaPullEvent::Progress {
                completed,
                total,
                status: self.status,
            };
        }
        if self.status == "success" {
            return OllamaPullEvent::Done {};
        }
        OllamaPullEvent::Status {
            status: self.status,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_tag_model_to_public_uses_details() {
        let raw = RawTagModel {
            name: "llama3.2:latest".into(),
            size: 1234,
            modified_at: "2025-01-01T00:00:00Z".into(),
            details: Some(RawTagDetails {
                parameter_size: Some("3.2B".into()),
                quantization_level: Some("Q4_K_M".into()),
                family: Some("llama".into()),
            }),
        };
        let model: OllamaModel = raw.into();
        assert_eq!(model.name, "llama3.2:latest");
        assert_eq!(model.size, 1234);
        assert_eq!(model.parameter_size.as_deref(), Some("3.2B"));
        assert_eq!(model.quantization.as_deref(), Some("Q4_K_M"));
        assert_eq!(model.family.as_deref(), Some("llama"));
    }

    #[test]
    fn raw_tag_model_without_details_yields_none_fields() {
        let raw = RawTagModel {
            name: "x".into(),
            size: 0,
            modified_at: String::new(),
            details: None,
        };
        let model: OllamaModel = raw.into();
        assert!(model.parameter_size.is_none());
        assert!(model.quantization.is_none());
        assert!(model.family.is_none());
    }

    #[test]
    fn raw_ps_model_to_public_copies_fields() {
        let raw = RawPsModel {
            name: "llama3.2:latest".into(),
            size_vram: 9876,
            expires_at: Some("2025-01-01T00:05:00Z".into()),
        };
        let loaded: OllamaLoadedModel = raw.into();
        assert_eq!(loaded.name, "llama3.2:latest");
        assert_eq!(loaded.size_vram, 9876);
        assert_eq!(loaded.expires_at.as_deref(), Some("2025-01-01T00:05:00Z"));
    }

    #[test]
    fn pull_chunk_progress_with_completed_and_total() {
        let chunk = PullChunk {
            status: "downloading".into(),
            completed: Some(50),
            total: Some(100),
            error: None,
        };
        match chunk.into_event() {
            OllamaPullEvent::Progress { completed, total, status } => {
                assert_eq!(completed, 50);
                assert_eq!(total, 100);
                assert_eq!(status, "downloading");
            }
            other => panic!("expected Progress, got {other:?}"),
        }
    }

    #[test]
    fn pull_chunk_status_only_yields_status_event() {
        let chunk = PullChunk {
            status: "pulling manifest".into(),
            completed: None,
            total: None,
            error: None,
        };
        assert_eq!(
            chunk.into_event(),
            OllamaPullEvent::Status { status: "pulling manifest".into() }
        );
    }

    #[test]
    fn pull_chunk_success_status_yields_done() {
        let chunk = PullChunk {
            status: "success".into(),
            completed: None,
            total: None,
            error: None,
        };
        assert_eq!(chunk.into_event(), OllamaPullEvent::Done {});
    }

    #[test]
    fn pull_chunk_error_yields_error_event() {
        let chunk = PullChunk {
            status: String::new(),
            completed: None,
            total: None,
            error: Some("model not found".into()),
        };
        assert_eq!(
            chunk.into_event(),
            OllamaPullEvent::Error { message: "model not found".into() }
        );
    }
}
