# 0087 · Ollama as a third AI backend

## Status

Accepted — 2026-04-28

## Context

Tolaria ships with two CLI-backed AI agents: **Claude Code** and **Codex**. Both
are spawned as subprocesses with the user's vault as the working directory and
participate in an agentic tool-use loop (read/edit/search files, run shell
commands). ADR-0028 explicitly chose CLI-only over a direct LLM API integration
to avoid storing credentials and to delegate tool execution to the official
agents.

Users want a third option: a **local LLM via Ollama** (`http://localhost:11434`).
Motivation:

- **Privacy.** Notes never leave the machine.
- **Offline use.** No internet required.
- **No API costs.** A laptop with 8 GB of RAM can run a 1–3 B parameter model.
- **Multi-model workflows.** Users may want different models warm at once
  (e.g. `llama3.2:3b` for prose, `qwen2.5-coder:7b` for code) and switch
  instantly without paying the cold-load cost.

The user also wants Ollama to power *editor-text improvements* (rewrite,
shorten, fix grammar of selected text) — the same kind of workflow today's
Claude/Codex chat enables indirectly via tool-use.

## Decision

### Three integration surfaces

1. **AiPanel chat** — Ollama becomes a third selectable agent alongside Claude
   Code and Codex. Routed through the existing `stream_ai_agent` Tauri command,
   which now matches on `AiAgentId::Ollama` and delegates to a streaming
   `/api/generate` request.
2. **Multi-model setup dialog** (new) — When a user selects Ollama in Settings,
   they get a "Configure Ollama models…" launcher that opens a dialog showing
   reachable status, installed models, on-disk size, "is loaded in RAM" badge.
   They pick **one active model** (radio) plus zero-or-more **warm models**
   (checkbox) that get pre-loaded via `keep_alive: -1` so switching is instant.
   A "Pull a model…" sub-dialog streams progress from `/api/pull` directly into
   the UI, removing the need to drop to a terminal.
3. **AI Improve dialog** (new) — A reusable, single-shot completion surface
   that takes selected text + an instruction (preset or custom) and streams a
   rewrite back. The dialog targets a new `stream_ai_completion` Tauri command
   that all three agents implement; for Claude/Codex it instructs the CLI to
   return only the resulting text without using tools, for Ollama it goes
   straight to `/api/generate`.

### Boundaries

- **Ollama in the AiPanel is chat-only.** No MCP, no tool-call emulation, no
  vault edits. Open-source local models do not reliably emit structured tool
  calls; faking it would produce a worse experience than honest chat. This is
  surfaced in the dialog copy.
- **The AI Improve surface is uniform across agents.** All three agents
  participate in single-shot completion mode. This crosses ADR-0028's
  CLI-only stance only superficially: Claude/Codex still run as CLIs; we are
  just disciplining their prompts to avoid tool-use for this surface.
- **No credentials stored.** Ollama needs no auth (local HTTP). Claude/Codex
  continue to use their own CLI-managed credentials. Tolaria still stores
  zero API keys.

### Settings extensions

```rust
// src-tauri/src/settings.rs — AppSettings
ollama_base_url: Option<String>          // None → http://localhost:11434
ollama_active_model: Option<String>      // currently selected Ollama model
ollama_warm_models: Vec<String>          // models to keep loaded
```

`normalize_default_ai_agent` now accepts `"ollama"` in addition to
`"claude_code"` and `"codex"`.

### New Rust module

`src-tauri/src/ollama/` — self-contained HTTP client wrapping the daemon's
public API (`/api/version`, `/api/tags`, `/api/generate`, `/api/pull`,
`/api/delete`, `/api/ps`). NDJSON streaming is hand-rolled with
`futures::stream::unfold` to avoid an `async-stream` dependency. All public
methods return `Result<T, String>` so they forward cleanly to JS.

### New Tauri commands

```
check_ollama_status, list_ollama_models, get_ollama_loaded_models,
delete_ollama_model, set_ollama_warm_models, pull_ollama_model,
stream_ai_completion
```

`pull_ollama_model` and `stream_ai_completion` use Tauri 2's
`tauri::ipc::Channel<T>` for per-invocation event streams.

## Consequences

### Positive

- The agent abstraction stays clean — the existing `AiAgentId` enum + router
  pattern in `ai_agents.rs` absorbed Ollama with one new variant and one new
  arm in `run_ai_agent_stream`.
- The AI Improve surface is a useful net-new feature for **all** agents, not
  just Ollama. Single-shot rewrites were not previously available.
- Local-first users can run Tolaria fully offline with a small model.

### Negative / accepted trade-offs

- The two surfaces (agentic chat vs single-shot completion) means two routes
  and two event shapes. We opted for an explicit second command rather than
  overloading `stream_ai_agent` with a "no-tools" flag, because the event
  shapes genuinely differ (no tool events for completion).
- Claude/Codex single-shot mode relies on the CLIs honoring "do not use
  tools" prompt instructions. Compliance is high but not guaranteed; tool
  events that do come back are dropped silently.
- Adding `bytes` and the reqwest `blocking` feature is a small build-time
  cost; both were already in the dependency graph transitively.

### Deferred

- **Editor-side keymap and selection capture.** The AI Improve dialog
  component is built and self-contained; wiring it to the BlockNote rich
  editor's selection model and a `Cmd+J` keymap is the next step. Until then
  the dialog is reachable via the command palette and operates on text
  pasted into it. CodeMirror raw mode integration is straightforward via the
  `selectionRange` API.
- **Multi-model parallel inference** ("model arena" UX). Out of scope for
  v1. Today's "warm models" set keeps several models loaded but only one is
  the active chat target.
- **Localization** of new UI strings to `zh-Hans`. New strings ship in
  English first; translations follow in a later pass.

## Alternatives considered

- **Run Ollama through `stream_ai_agent` only, no completion path.** Rejected:
  the user's stated goal includes editor text improvements, which require a
  predictable single-shot text-in/text-out path — agentic mode is wrong for
  this even when it works.
- **Ollama tool-use emulation.** Rejected for v1: brittle across models and
  not better than honest "chat-only Ollama + uniform completion surface."
- **Embed Anthropic API for the completion surface** (skipping Claude CLI in
  that path). Rejected: contradicts ADR-0028 and reintroduces credential
  storage we deliberately removed.

## References

- ADR-0028 — CLI-only AI agents (no API key field).
- ADR-0010 — Dynamic wikilink relationship detection (system-prompt context
  injection patterns the Ollama integration reuses).
- Ollama HTTP API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
