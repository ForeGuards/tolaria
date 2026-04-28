import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowSquareOut, Cloud, Plus, Warning } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  checkOllamaStatus,
  deleteOllamaModel,
  getOllamaLoadedModels,
  listOllamaModels,
  type OllamaLoadedModel,
  type OllamaModel,
  type OllamaStatus,
} from '@/lib/ollama'
import { OllamaModelRow } from './OllamaModelRow'

export interface OllamaSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialActiveModel: string | null
  initialWarmModels: string[]
  onSave: (activeModel: string | null, warmModels: string[]) => Promise<void>
  onOpenPullDialog: (suggestedName?: string) => void
}

export const SUGGESTED_MODELS: ReadonlyArray<{ name: string; hint: string }> = [
  { name: 'llama3.2:1b', hint: '~1 GB' },
  { name: 'llama3.2:3b', hint: '~2 GB' },
  { name: 'qwen2.5:0.5b', hint: '~400 MB' },
  { name: 'qwen2.5-coder:7b', hint: '~5 GB' },
  { name: 'gemma2:2b', hint: '~1.5 GB' },
  { name: 'phi3.5:3.8b', hint: '~2.5 GB' },
] as const

interface DialogData {
  status: OllamaStatus | null
  models: OllamaModel[]
  loaded: OllamaLoadedModel[]
}

const EMPTY_DATA: DialogData = { status: null, models: [], loaded: [] }

async function loadDialogData(): Promise<DialogData> {
  const status = await checkOllamaStatus()
  if (!status.installed) return { status, models: [], loaded: [] }
  const [models, loaded] = await Promise.all([
    listOllamaModels().catch(() => [] as OllamaModel[]),
    getOllamaLoadedModels().catch(() => [] as OllamaLoadedModel[]),
  ])
  return { status, models, loaded }
}

function StatusRow({ status }: { status: OllamaStatus }) {
  const ok = status.installed
  return (
    <div
      data-testid="ollama-status-row"
      className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
    >
      <Cloud size={16} className={ok ? 'text-emerald-500' : 'text-[var(--muted-foreground)]'} />
      <span className="font-medium">
        {ok ? 'Ollama detected' : 'Ollama not detected'}
      </span>
      <span className="text-[var(--muted-foreground)]">{status.base_url}</span>
      {status.version && <Badge variant="secondary">v{status.version}</Badge>}
    </div>
  )
}

function NotDetectedState({ status }: { status: OllamaStatus }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="flex items-start gap-2">
        <Warning size={18} className="mt-0.5 text-amber-500" />
        <div className="text-sm">
          <p className="font-medium text-[var(--foreground)]">Ollama is not running</p>
          <p className="mt-1 text-[var(--muted-foreground)]">
            We could not reach the Ollama daemon at {status.base_url}.
            Install it from ollama.com and run <code>ollama serve</code>, then try again.
          </p>
          {status.error && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]" data-testid="ollama-status-error">
              {status.error}
            </p>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => window.open('https://ollama.com', '_blank', 'noopener,noreferrer')}
        data-testid="ollama-open-website"
      >
        <ArrowSquareOut size={14} className="mr-1.5" />
        Open ollama.com
      </Button>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (name: string) => void }) {
  return (
    <div
      data-testid="ollama-empty-state"
      className="flex flex-col gap-3 rounded-md border border-dashed border-[var(--border)] bg-[var(--background)] p-4"
    >
      <p className="text-sm font-medium text-[var(--foreground)]">No models installed yet</p>
      <p className="text-xs text-[var(--muted-foreground)]">
        Pull a small one to get started. Suggested:
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_MODELS.map((m) => (
          <Button
            key={m.name}
            type="button"
            variant="outline"
            size="sm"
            data-testid={`ollama-suggest-${m.name}`}
            onClick={() => onPick(m.name)}
          >
            {m.name}
            <span className="ml-2 text-[var(--muted-foreground)]">{m.hint}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

export function OllamaSetupDialog({
  open,
  onOpenChange,
  initialActiveModel,
  initialWarmModels,
  onSave,
  onOpenPullDialog,
}: OllamaSetupDialogProps) {
  const [data, setData] = useState<DialogData>(EMPTY_DATA)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<string | null>(initialActiveModel)
  const [warm, setWarm] = useState<string[]>(initialWarmModels)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await loadDialogData())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setActive(initialActiveModel)
    setWarm(initialWarmModels)
    void refresh()
  }, [open, initialActiveModel, initialWarmModels, refresh])

  const loadedNames = useMemo(() => new Set(data.loaded.map((m) => m.name)), [data.loaded])

  const handleSelectActive = useCallback((name: string) => {
    setActive(name)
  }, [])

  const handleToggleWarm = useCallback((name: string) => {
    setWarm((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }, [])

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete model "${name}"? This frees disk but you'll need to pull it again to use it.`)) return
    try {
      await deleteOllamaModel(name)
      if (active === name) setActive(null)
      setWarm((prev) => prev.filter((n) => n !== name))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [active, refresh])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const dedupedWarm = Array.from(new Set(warm.filter((n) => n !== active)))
      await onSave(active, dedupedWarm)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [active, warm, onSave, onOpenChange])

  const reachable = data.status?.installed === true
  const hasModels = data.models.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="ollama-setup-dialog">
        <DialogHeader>
          <DialogTitle>Ollama models</DialogTitle>
          <DialogDescription>
            Pick the model to chat with and any others to keep loaded for instant switching.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {data.status && <StatusRow status={data.status} />}

          {data.status && !reachable && <NotDetectedState status={data.status} />}

          {reachable && !hasModels && !loading && (
            <EmptyState onPick={(name) => onOpenPullDialog(name)} />
          )}

          {reachable && hasModels && (
            <div className="flex flex-col gap-2" data-testid="ollama-model-list">
              {data.models.map((model) => (
                <OllamaModelRow
                  key={model.name}
                  model={model}
                  isActive={active === model.name}
                  isWarm={warm.includes(model.name)}
                  isLoaded={loadedNames.has(model.name)}
                  onSelectActive={handleSelectActive}
                  onToggleWarm={handleToggleWarm}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--destructive)]" role="alert" data-testid="ollama-setup-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading}
              data-testid="ollama-refresh"
            >
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenPullDialog(undefined)}
              disabled={!reachable}
              data-testid="ollama-open-pull"
            >
              <Plus size={14} className="mr-1.5" />
              Pull a model…
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !reachable}
              data-testid="ollama-save"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
