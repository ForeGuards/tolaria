import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, mockInvokeMock, isTauriState, channelInstances } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  mockInvokeMock: vi.fn(),
  isTauriState: { value: true },
  channelInstances: [] as Array<{ onmessage?: (event: unknown) => void }>,
}))

vi.mock('@tauri-apps/api/core', () => {
  class Channel<T> {
    onmessage?: (event: T) => void
    constructor() {
      channelInstances.push(this as unknown as { onmessage?: (event: unknown) => void })
    }
  }
  return { invoke: invokeMock, Channel }
})

vi.mock('../../mock-tauri', () => ({
  isTauri: () => isTauriState.value,
  mockInvoke: mockInvokeMock,
}))

import {
  checkOllamaStatus,
  deleteOllamaModel,
  getOllamaLoadedModels,
  listOllamaModels,
  setOllamaWarmModels,
} from './client'
import { pullOllamaModel } from './pull'
import { streamAiCompletion } from './completion'
import type {
  AiCompletionEvent,
  AiCompletionRequest,
  OllamaLoadedModel,
  OllamaModel,
  OllamaPullEvent,
  OllamaStatus,
} from './types'

beforeEach(() => {
  invokeMock.mockReset()
  mockInvokeMock.mockReset()
  channelInstances.length = 0
  isTauriState.value = true
})

describe('checkOllamaStatus', () => {
  it('invokes check_ollama_status and returns the payload', async () => {
    const status: OllamaStatus = {
      installed: true,
      base_url: 'http://localhost:11434',
      version: '0.1.0',
      error: null,
    }
    invokeMock.mockResolvedValue(status)
    await expect(checkOllamaStatus()).resolves.toEqual(status)
    expect(invokeMock).toHaveBeenCalledWith('check_ollama_status', undefined)
  })

  it('falls back to mockInvoke outside Tauri', async () => {
    isTauriState.value = false
    mockInvokeMock.mockResolvedValue({
      installed: false,
      base_url: '',
      version: null,
      error: null,
    } satisfies OllamaStatus)
    await checkOllamaStatus()
    expect(mockInvokeMock).toHaveBeenCalledWith('check_ollama_status', undefined)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('propagates rejection', async () => {
    invokeMock.mockRejectedValue(new Error('offline'))
    await expect(checkOllamaStatus()).rejects.toThrow('offline')
  })
})

describe('listOllamaModels', () => {
  it('invokes list_ollama_models', async () => {
    const models: OllamaModel[] = [
      {
        name: 'llama3',
        size: 1024,
        parameter_size: '7B',
        quantization: 'Q4',
        family: 'llama',
        modified_at: '2025-01-01',
      },
    ]
    invokeMock.mockResolvedValue(models)
    await expect(listOllamaModels()).resolves.toEqual(models)
    expect(invokeMock).toHaveBeenCalledWith('list_ollama_models', undefined)
  })
})

describe('deleteOllamaModel', () => {
  it('passes the name argument', async () => {
    invokeMock.mockResolvedValue(undefined)
    await deleteOllamaModel('llama3')
    expect(invokeMock).toHaveBeenCalledWith('delete_ollama_model', { name: 'llama3' })
  })

  it('propagates errors', async () => {
    invokeMock.mockRejectedValue(new Error('not found'))
    await expect(deleteOllamaModel('missing')).rejects.toThrow('not found')
  })
})

describe('setOllamaWarmModels', () => {
  it('passes active and warm arguments', async () => {
    invokeMock.mockResolvedValue(undefined)
    await setOllamaWarmModels('llama3', ['llama3', 'mistral'])
    expect(invokeMock).toHaveBeenCalledWith('set_ollama_warm_models', {
      active: 'llama3',
      warm: ['llama3', 'mistral'],
    })
  })

  it('allows null active model', async () => {
    invokeMock.mockResolvedValue(undefined)
    await setOllamaWarmModels(null, [])
    expect(invokeMock).toHaveBeenCalledWith('set_ollama_warm_models', {
      active: null,
      warm: [],
    })
  })
})

describe('getOllamaLoadedModels', () => {
  it('invokes get_ollama_loaded_models', async () => {
    const loaded: OllamaLoadedModel[] = [
      { name: 'llama3', size_vram: 4096, expires_at: null },
    ]
    invokeMock.mockResolvedValue(loaded)
    await expect(getOllamaLoadedModels()).resolves.toEqual(loaded)
    expect(invokeMock).toHaveBeenCalledWith('get_ollama_loaded_models', undefined)
  })
})

describe('pullOllamaModel', () => {
  it('forwards Channel events to onEvent in Tauri mode', async () => {
    invokeMock.mockResolvedValue(undefined)
    const events: OllamaPullEvent[] = []
    await pullOllamaModel('llama3', (e) => events.push(e))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [command, args] = invokeMock.mock.calls[0]
    expect(command).toBe('pull_ollama_model')
    expect((args as { name: string }).name).toBe('llama3')

    expect(channelInstances).toHaveLength(1)
    const channel = channelInstances[0]
    channel.onmessage?.({ kind: 'status', status: 'starting' })
    channel.onmessage?.({ kind: 'progress', completed: 10, total: 100, status: 'downloading' })
    channel.onmessage?.({ kind: 'done' })

    expect(events).toEqual([
      { kind: 'status', status: 'starting' },
      { kind: 'progress', completed: 10, total: 100, status: 'downloading' },
      { kind: 'done' },
    ])
  })

  it('delegates to mockInvoke outside Tauri', async () => {
    isTauriState.value = false
    mockInvokeMock.mockResolvedValue(undefined)
    const onEvent = vi.fn()
    await pullOllamaModel('llama3', onEvent)
    expect(mockInvokeMock).toHaveBeenCalledWith('pull_ollama_model', {
      name: 'llama3',
      onEvent,
    })
    expect(channelInstances).toHaveLength(0)
  })

  it('propagates invoke rejection', async () => {
    invokeMock.mockRejectedValue(new Error('pull failed'))
    await expect(pullOllamaModel('x', () => {})).rejects.toThrow('pull failed')
  })
})

describe('streamAiCompletion', () => {
  const baseRequest: AiCompletionRequest = {
    agent: 'ollama',
    model: 'llama3',
    system_prompt: 'sys',
    user_prompt: 'hi',
    temperature: 0.2,
  }

  it('forwards Channel events in Tauri mode', async () => {
    invokeMock.mockResolvedValue(undefined)
    const events: AiCompletionEvent[] = []
    await streamAiCompletion(baseRequest, (e) => events.push(e))

    const [command, args] = invokeMock.mock.calls[0]
    expect(command).toBe('stream_ai_completion')
    expect((args as { request: AiCompletionRequest }).request).toEqual(baseRequest)

    expect(channelInstances).toHaveLength(1)
    channelInstances[0].onmessage?.({ kind: 'text', delta: 'hello' })
    channelInstances[0].onmessage?.({ kind: 'done' })

    expect(events).toEqual([
      { kind: 'text', delta: 'hello' },
      { kind: 'done' },
    ])
  })

  it('delegates to mockInvoke outside Tauri', async () => {
    isTauriState.value = false
    mockInvokeMock.mockResolvedValue(undefined)
    const onEvent = vi.fn()
    await streamAiCompletion(baseRequest, onEvent)
    expect(mockInvokeMock).toHaveBeenCalledWith('stream_ai_completion', {
      request: baseRequest,
      onEvent,
    })
  })

  it('propagates rejection', async () => {
    invokeMock.mockRejectedValue(new Error('stream broken'))
    await expect(streamAiCompletion(baseRequest, () => {})).rejects.toThrow('stream broken')
  })
})
