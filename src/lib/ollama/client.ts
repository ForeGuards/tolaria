import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { OllamaLoadedModel, OllamaModel, OllamaStatus } from './types'

function tauriCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

export async function checkOllamaStatus(): Promise<OllamaStatus> {
  return tauriCall<OllamaStatus>('check_ollama_status')
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  return tauriCall<OllamaModel[]>('list_ollama_models')
}

export async function deleteOllamaModel(name: string): Promise<void> {
  await tauriCall<void>('delete_ollama_model', { name })
}

export async function setOllamaWarmModels(
  active: string | null,
  warm: string[],
): Promise<void> {
  await tauriCall<void>('set_ollama_warm_models', { active, warm })
}

export async function getOllamaLoadedModels(): Promise<OllamaLoadedModel[]> {
  return tauriCall<OllamaLoadedModel[]>('get_ollama_loaded_models')
}
