import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  checkOllamaStatus,
  listOllamaModels,
  setOllamaWarmModels,
  type OllamaModel,
  type OllamaStatus,
} from '@/lib/ollama'
import type { Settings } from '@/types'
import { OllamaSetupDialog } from './OllamaSetupDialog'
import { OllamaPullDialog } from './OllamaPullDialog'
import { formatModelSize } from './OllamaModelRow'

export interface OllamaSettingsLauncherProps {
  /** When false, render nothing (the agent picker is showing a different agent). */
  visible: boolean
}

interface OllamaSnapshot {
  status: OllamaStatus | null
  models: OllamaModel[]
  active: string | null
  warm: string[]
}

const EMPTY_SNAPSHOT: OllamaSnapshot = { status: null, models: [], active: null, warm: [] }

function tauriCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

async function loadOllamaSettings(): Promise<{ active: string | null; warm: string[] }> {
  try {
    const settings = await tauriCall<Settings>('get_settings')
    return {
      active: settings.ollama_active_model ?? null,
      warm: settings.ollama_warm_models ?? [],
    }
  } catch {
    return { active: null, warm: [] }
  }
}

async function persistOllamaSettings(active: string | null, warm: string[]): Promise<void> {
  // Read the latest settings before merging, to avoid clobbering anything
  // another panel saved while the dialog was open.
  const current = await tauriCall<Settings>('get_settings').catch(() => ({} as Settings))
  const merged: Settings = {
    ...current,
    ollama_active_model: active,
    ollama_warm_models: warm,
  } as Settings
  await tauriCall<null>('save_settings', { settings: merged })
}

async function loadSnapshot(): Promise<OllamaSnapshot> {
  const [statusResult, modelsResult, settingsResult] = await Promise.allSettled([
    checkOllamaStatus(),
    listOllamaModels(),
    loadOllamaSettings(),
  ])
  const status = statusResult.status === 'fulfilled' ? statusResult.value : null
  const models =
    status?.installed && modelsResult.status === 'fulfilled' ? modelsResult.value : []
  const settings =
    settingsResult.status === 'fulfilled' ? settingsResult.value : { active: null, warm: [] }
  return { status, models, active: settings.active, warm: settings.warm }
}

function describeStatus(snapshot: OllamaSnapshot): string {
  const { status, models, active, warm } = snapshot
  if (!status) return 'Checking Ollama…'
  if (!status.installed) return `Ollama not detected at ${status.base_url}`
  const versionPart = status.version ? `v${status.version} · ` : ''
  const modelsPart = `${models.length} model${models.length === 1 ? '' : 's'} installed`
  const warmExtras = warm.filter((name) => name !== active).length
  const warmPart = warmExtras > 0 ? ` · ${warmExtras} kept warm` : ''
  return `${versionPart}${modelsPart}${warmPart}`
}

function modelOptionLabel(model: OllamaModel): string {
  const params = model.parameter_size ? ` · ${model.parameter_size}` : ''
  const size = ` · ${formatModelSize(model.size)}`
  return `${model.name}${params}${size}`
}

export function OllamaSettingsLauncher({ visible }: OllamaSettingsLauncherProps) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [pullOpen, setPullOpen] = useState(false)
  const [pullSuggestion, setPullSuggestion] = useState<string | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<OllamaSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await loadSnapshot())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  const handleSelectActive = useCallback(
    async (name: string) => {
      const previousSnapshot = snapshot
      const dedupedWarm = snapshot.warm.filter((entry) => entry !== name)
      setSnapshot({ ...snapshot, active: name, warm: dedupedWarm })
      setError(null)
      try {
        await persistOllamaSettings(name, dedupedWarm)
        await setOllamaWarmModels(name, dedupedWarm)
      } catch (err) {
        setSnapshot(previousSnapshot)
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [snapshot],
  )

  const handleSaveFromDialog = useCallback(async (active: string | null, warm: string[]) => {
    await persistOllamaSettings(active, warm)
    try {
      await setOllamaWarmModels(active, warm)
    } catch {
      // Daemon might be unreachable; settings still persisted for next launch.
    }
    setSnapshot((prev) => ({ ...prev, active, warm }))
  }, [])

  const handleSetupOpenChange = useCallback(
    (next: boolean) => {
      setSetupOpen(next)
      if (!next) void refresh()
    },
    [refresh],
  )

  const handleOpenPull = useCallback((suggestion?: string) => {
    setPullSuggestion(suggestion)
    setPullOpen(true)
  }, [])

  const handlePulled = useCallback(async () => {
    await refresh()
    setSetupOpen(true)
  }, [refresh])

  const showInlinePicker = useMemo(
    () => snapshot.status?.installed === true && snapshot.models.length > 0,
    [snapshot],
  )
  const showEmptyHint = useMemo(
    () => snapshot.status?.installed === true && snapshot.models.length === 0 && !loading,
    [snapshot, loading],
  )

  if (!visible) return null

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p
          data-testid="ollama-launcher-status"
          style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}
        >
          {loading && !snapshot.status ? 'Checking Ollama…' : describeStatus(snapshot)}
        </p>

        {showInlinePicker && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }}>
              Active model
            </span>
            <Select
              value={snapshot.active ?? ''}
              onValueChange={(value) => void handleSelectActive(value)}
              disabled={loading}
            >
              <SelectTrigger data-testid="ollama-inline-active-select">
                <SelectValue placeholder="Pick a model…" />
              </SelectTrigger>
              <SelectContent>
                {snapshot.models.map((model) => (
                  <SelectItem
                    key={model.name}
                    value={model.name}
                    data-testid={`ollama-inline-active-option-${model.name}`}
                  >
                    {modelOptionLabel(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showEmptyHint && (
          <div
            data-testid="ollama-launcher-empty"
            style={{
              fontSize: 12,
              color: 'var(--muted-foreground)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span>No models installed yet.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenPull(undefined)}
              data-testid="ollama-launcher-pull"
            >
              Pull a model…
            </Button>
          </div>
        )}

        {error && (
          <p
            data-testid="ollama-launcher-error"
            role="alert"
            style={{ fontSize: 12, color: 'var(--destructive)', margin: 0 }}
          >
            {error}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSetupOpen(true)}
          data-testid="ollama-configure-button"
          style={{ alignSelf: 'flex-start' }}
        >
          Configure Ollama models…
        </Button>
      </div>

      <OllamaSetupDialog
        open={setupOpen}
        onOpenChange={handleSetupOpenChange}
        initialActiveModel={snapshot.active}
        initialWarmModels={snapshot.warm}
        onSave={handleSaveFromDialog}
        onOpenPullDialog={(suggestion) => {
          setSetupOpen(false)
          handleOpenPull(suggestion)
        }}
      />
      <OllamaPullDialog
        open={pullOpen}
        onOpenChange={(next) => {
          setPullOpen(next)
          if (!next) void refresh()
        }}
        suggestedName={pullSuggestion}
        onPulled={handlePulled}
      />
    </>
  )
}
