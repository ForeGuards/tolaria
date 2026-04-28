import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OllamaModel, OllamaStatus } from '@/lib/ollama'

const checkOllamaStatusMock = vi.fn<() => Promise<OllamaStatus>>()
const listOllamaModelsMock = vi.fn<() => Promise<OllamaModel[]>>()
const setOllamaWarmModelsMock = vi.fn<(active: string | null, warm: string[]) => Promise<void>>()
const invokeMock = vi.fn()

vi.mock('@/lib/ollama', () => ({
  checkOllamaStatus: () => checkOllamaStatusMock(),
  listOllamaModels: () => listOllamaModelsMock(),
  setOllamaWarmModels: (active: string | null, warm: string[]) => setOllamaWarmModelsMock(active, warm),
}))

vi.mock('../../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}))

// The setup and pull dialogs are heavy and have their own data flow; stub them
// out so we test the launcher's inline picker in isolation.
vi.mock('./OllamaSetupDialog', () => ({
  OllamaSetupDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="setup-dialog-open" /> : null,
}))
vi.mock('./OllamaPullDialog', () => ({
  OllamaPullDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="pull-dialog-open" /> : null,
}))

import { OllamaSettingsLauncher } from './OllamaSettingsLauncher'

function statusReachable(): OllamaStatus {
  return {
    installed: true,
    base_url: 'http://localhost:11434',
    version: '0.4.0',
    error: null,
  }
}

function model(name: string, paramSize: string, sizeBytes: number): OllamaModel {
  return {
    name,
    size: sizeBytes,
    parameter_size: paramSize,
    quantization: null,
    family: 'llama',
    modified_at: '2026-01-01T00:00:00Z',
  }
}

function settingsResponse(active: string | null = null, warm: string[] = []): Record<string, unknown> {
  return {
    auto_pull_interval_minutes: null,
    telemetry_consent: null,
    crash_reporting_enabled: null,
    analytics_enabled: null,
    anonymous_id: null,
    release_channel: null,
    ollama_active_model: active,
    ollama_warm_models: warm,
  }
}

beforeEach(() => {
  checkOllamaStatusMock.mockReset()
  listOllamaModelsMock.mockReset()
  setOllamaWarmModelsMock.mockReset()
  invokeMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OllamaSettingsLauncher', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<OllamaSettingsLauncher visible={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows installed models in the inline active-model dropdown', async () => {
    checkOllamaStatusMock.mockResolvedValue(statusReachable())
    listOllamaModelsMock.mockResolvedValue([
      model('llama3.2:3b', '3.2B', 2_000_000_000),
      model('qwen2.5:0.5b', '0.5B', 400_000_000),
    ])
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_settings') return Promise.resolve(settingsResponse('llama3.2:3b', []))
      if (cmd === 'save_settings') return Promise.resolve(null)
      return Promise.resolve(null)
    })

    render(<OllamaSettingsLauncher visible={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('ollama-inline-active-select')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ollama-launcher-status')).toHaveTextContent(
      /v0\.4\.0.*2 models installed/,
    )
    expect(screen.getByTestId('ollama-configure-button')).toBeInTheDocument()
  })

  it('shows the empty hint and a pull launcher when no models are installed', async () => {
    checkOllamaStatusMock.mockResolvedValue(statusReachable())
    listOllamaModelsMock.mockResolvedValue([])
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_settings') return Promise.resolve(settingsResponse(null, []))
      return Promise.resolve(null)
    })

    render(<OllamaSettingsLauncher visible={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('ollama-launcher-empty')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ollama-launcher-pull')).toBeInTheDocument()
    expect(screen.queryByTestId('ollama-inline-active-select')).not.toBeInTheDocument()
  })

  it('reports status when Ollama is unreachable and hides the dropdown', async () => {
    checkOllamaStatusMock.mockResolvedValue({
      installed: false,
      base_url: 'http://localhost:11434',
      version: null,
      error: 'connection refused',
    })
    listOllamaModelsMock.mockResolvedValue([])
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_settings') return Promise.resolve(settingsResponse(null, []))
      return Promise.resolve(null)
    })

    render(<OllamaSettingsLauncher visible={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('ollama-launcher-status')).toHaveTextContent(
        /Ollama not detected/,
      )
    })
    expect(screen.queryByTestId('ollama-inline-active-select')).not.toBeInTheDocument()
  })

  it('renders the active model as the trigger value and lists every installed model', async () => {
    checkOllamaStatusMock.mockResolvedValue(statusReachable())
    listOllamaModelsMock.mockResolvedValue([
      model('llama3.2:3b', '3.2B', 2_000_000_000),
      model('qwen2.5:0.5b', '0.5B', 400_000_000),
    ])
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_settings') return Promise.resolve(settingsResponse('llama3.2:3b', []))
      return Promise.resolve(null)
    })

    render(<OllamaSettingsLauncher visible={true} />)

    const trigger = await screen.findByTestId('ollama-inline-active-select')
    // Radix Select renders the active value inside the trigger.
    expect(trigger).toHaveTextContent('llama3.2:3b')

    // Open the popover via keyboard so the SelectItem nodes mount.
    await act(async () => {
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'Enter' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('ollama-inline-active-option-llama3.2:3b')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ollama-inline-active-option-qwen2.5:0.5b')).toBeInTheDocument()
  })
})
