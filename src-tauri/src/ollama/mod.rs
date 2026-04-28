//! Ollama HTTP client module.
//!
//! Wraps the local Ollama daemon's HTTP API. The public surface is
//! [`OllamaClient`]; supporting types live in [`types`]. NDJSON streaming
//! helpers are in [`stream`], and keep-alive policy lives in [`keep_warm`].
//!
//! This module is intentionally not yet wired into the Tauri command surface
//! or the `AiAgentId` enum — that integration happens in a later wave.

#![allow(dead_code)]

pub mod client;
pub mod keep_warm;
pub mod stream;
pub mod types;

pub use client::OllamaClient;
pub use types::{
    OllamaLoadedModel, OllamaModel, OllamaPullEvent, OllamaStatus,
};
