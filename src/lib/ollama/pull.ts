import { Channel, invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { OllamaPullEvent } from './types'

export async function pullOllamaModel(
  name: string,
  onEvent: (event: OllamaPullEvent) => void,
): Promise<void> {
  if (!isTauri()) {
    await mockInvoke<void>('pull_ollama_model', { name, onEvent })
    return
  }

  const channel = new Channel<OllamaPullEvent>()
  channel.onmessage = (event) => onEvent(event)
  await invoke<void>('pull_ollama_model', { name, onEvent: channel })
}
