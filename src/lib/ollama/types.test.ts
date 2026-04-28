import { describe, expect, it } from 'vitest'
import {
  isAiCompletionError,
  isAiCompletionText,
  isOllamaPullError,
  isOllamaPullProgress,
  type AiCompletionEvent,
  type OllamaPullEvent,
} from './types'

describe('OllamaPullEvent narrowing', () => {
  it('narrows progress events', () => {
    const event: OllamaPullEvent = {
      kind: 'progress',
      completed: 50,
      total: 100,
      status: 'pulling',
    }
    expect(isOllamaPullProgress(event)).toBe(true)
    if (isOllamaPullProgress(event)) {
      expect(event.completed).toBe(50)
      expect(event.total).toBe(100)
    }
  })

  it('narrows error events', () => {
    const event: OllamaPullEvent = { kind: 'error', message: 'boom' }
    expect(isOllamaPullError(event)).toBe(true)
    if (isOllamaPullError(event)) {
      expect(event.message).toBe('boom')
    }
  })

  it('rejects non-matching variants', () => {
    const status: OllamaPullEvent = { kind: 'status', status: 'starting' }
    const done: OllamaPullEvent = { kind: 'done' }
    expect(isOllamaPullProgress(status)).toBe(false)
    expect(isOllamaPullError(done)).toBe(false)
  })
})

describe('AiCompletionEvent narrowing', () => {
  it('narrows text deltas', () => {
    const event: AiCompletionEvent = { kind: 'text', delta: 'hi' }
    expect(isAiCompletionText(event)).toBe(true)
    if (isAiCompletionText(event)) {
      expect(event.delta).toBe('hi')
    }
  })

  it('narrows error events', () => {
    const event: AiCompletionEvent = { kind: 'error', message: 'fail' }
    expect(isAiCompletionError(event)).toBe(true)
    if (isAiCompletionError(event)) {
      expect(event.message).toBe('fail')
    }
  })

  it('rejects non-matching variants', () => {
    const done: AiCompletionEvent = { kind: 'done' }
    expect(isAiCompletionText(done)).toBe(false)
    expect(isAiCompletionError(done)).toBe(false)
  })
})
