import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import { Button } from '@/components/ui/button'
import { setOllamaWarmModels } from '@/lib/ollama'
import type { Settings } from '@/types'
import { OllamaSetupDialog } from './OllamaSetupDialog'
import { OllamaPullDialog } from './OllamaPullDialog'

export interface OllamaSettingsLauncherProps {
  /** When false, render nothing (the agent picker is showing a different agent). */
  visible: boolean
}

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

export function OllamaSettingsLauncher({ visible }: OllamaSettingsLauncherProps) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [pullOpen, setPullOpen] = useState(false)
  const [pullSuggestion, setPullSuggestion] = useState<string | undefined>(undefined)
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [warmModels, setWarmModels] = useState<string[]>([])

  useEffect(() => {
    if (!visible) return
    void loadOllamaSettings().then(({ active, warm }) => {
      setActiveModel(active)
      setWarmModels(warm)
    })
  }, [visible])

  const handleSave = useCallback(async (active: string | null, warm: string[]) => {
    await persistOllamaSettings(active, warm)
    try {
      await setOllamaWarmModels(active, warm)
    } catch {
      // Daemon might be unreachable; settings still persisted for next launch.
    }
    setActiveModel(active)
    setWarmModels(warm)
  }, [])

  const handleOpenPull = useCallback((suggestion?: string) => {
    setPullSuggestion(suggestion)
    setPullOpen(true)
  }, [])

  const handlePulled = useCallback(() => {
    // Re-open setup dialog so the user can pick the freshly-pulled model.
    setSetupOpen(true)
  }, [])

  if (!visible) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setSetupOpen(true)}
        data-testid="ollama-configure-button"
      >
        Configure Ollama models…
      </Button>
      <OllamaSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        initialActiveModel={activeModel}
        initialWarmModels={warmModels}
        onSave={handleSave}
        onOpenPullDialog={(suggestion) => {
          setSetupOpen(false)
          handleOpenPull(suggestion)
        }}
      />
      <OllamaPullDialog
        open={pullOpen}
        onOpenChange={setPullOpen}
        suggestedName={pullSuggestion}
        onPulled={handlePulled}
      />
    </>
  )
}
