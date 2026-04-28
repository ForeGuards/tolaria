import { Channel, invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { AiCompletionEvent, AiCompletionRequest } from './types'

export async function streamAiCompletion(
  request: AiCompletionRequest,
  onEvent: (event: AiCompletionEvent) => void,
): Promise<void> {
  if (!isTauri()) {
    await mockInvoke<void>('stream_ai_completion', { request, onEvent })
    return
  }

  const channel = new Channel<AiCompletionEvent>()
  channel.onmessage = (event) => onEvent(event)
  await invoke<void>('stream_ai_completion', { request, onEvent: channel })
}
