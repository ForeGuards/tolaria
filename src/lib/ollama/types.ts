export interface OllamaStatus {
  installed: boolean
  base_url: string
  version: string | null
  error: string | null
}

export interface OllamaModel {
  name: string
  size: number
  parameter_size: string | null
  quantization: string | null
  family: string | null
  modified_at: string
}

export interface OllamaLoadedModel {
  name: string
  size_vram: number
  expires_at: string | null
}

export type OllamaPullEvent =
  | { kind: 'status'; status: string }
  | { kind: 'progress'; completed: number; total: number; status: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export type AiCompletionAgentId = 'claude_code' | 'codex' | 'ollama'

export interface AiCompletionRequest {
  agent: AiCompletionAgentId
  model: string | null
  system_prompt: string
  user_prompt: string
  temperature: number | null
}

export type AiCompletionEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function isOllamaPullProgress(
  event: OllamaPullEvent,
): event is Extract<OllamaPullEvent, { kind: 'progress' }> {
  return event.kind === 'progress'
}

export function isOllamaPullError(
  event: OllamaPullEvent,
): event is Extract<OllamaPullEvent, { kind: 'error' }> {
  return event.kind === 'error'
}

export function isAiCompletionText(
  event: AiCompletionEvent,
): event is Extract<AiCompletionEvent, { kind: 'text' }> {
  return event.kind === 'text'
}

export function isAiCompletionError(
  event: AiCompletionEvent,
): event is Extract<AiCompletionEvent, { kind: 'error' }> {
  return event.kind === 'error'
}
