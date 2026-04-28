import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pullOllamaModel, type OllamaPullEvent } from '@/lib/ollama'
import { OllamaPullProgress } from './OllamaPullProgress'
import { SUGGESTED_MODELS } from './OllamaSetupDialog'

export interface OllamaPullDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestedName?: string
  onPulled: (modelName: string) => void
}

type PullPhase =
  | { kind: 'idle' }
  | { kind: 'pulling'; status: string; completed: number; total: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

const IDLE_PHASE: PullPhase = { kind: 'idle' }

export function OllamaPullDialog({
  open,
  onOpenChange,
  suggestedName,
  onPulled,
}: OllamaPullDialogProps) {
  const [name, setName] = useState(suggestedName ?? '')
  const [phase, setPhase] = useState<PullPhase>(IDLE_PHASE)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setName(suggestedName ?? '')
    setPhase(IDLE_PHASE)
    cancelRef.current = false
  }, [open, suggestedName])

  const handleEvent = useCallback((event: OllamaPullEvent) => {
    if (cancelRef.current) return
    if (event.kind === 'progress') {
      setPhase({
        kind: 'pulling',
        status: event.status,
        completed: event.completed,
        total: event.total,
      })
      return
    }
    if (event.kind === 'status') {
      setPhase((prev) => ({
        kind: 'pulling',
        status: event.status,
        completed: prev.kind === 'pulling' ? prev.completed : 0,
        total: prev.kind === 'pulling' ? prev.total : 0,
      }))
      return
    }
    if (event.kind === 'done') {
      setPhase({ kind: 'done' })
      return
    }
    setPhase({ kind: 'error', message: event.message })
  }, [])

  const startPull = useCallback(async () => {
    const target = name.trim()
    if (!target) return
    cancelRef.current = false
    setPhase({ kind: 'pulling', status: 'Starting…', completed: 0, total: 0 })
    try {
      await pullOllamaModel(target, handleEvent)
      if (cancelRef.current) return
      setPhase((prev) => (prev.kind === 'done' ? prev : { kind: 'done' }))
    } catch (err) {
      if (cancelRef.current) return
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [name, handleEvent])

  const handleCancel = useCallback(() => {
    cancelRef.current = true
    setPhase(IDLE_PHASE)
  }, [])

  const handleDone = useCallback(() => {
    onPulled(name.trim())
    onOpenChange(false)
  }, [name, onPulled, onOpenChange])

  const isPulling = phase.kind === 'pulling'
  const canSubmit = name.trim().length > 0 && phase.kind !== 'pulling' && phase.kind !== 'done'

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isPulling) onOpenChange(next) }}>
      <DialogContent className="max-w-md" data-testid="ollama-pull-dialog">
        <DialogHeader>
          <DialogTitle>Pull a model</DialogTitle>
          <DialogDescription>
            Download an Ollama model. Sizes vary from a few hundred MB to several GB.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. llama3.2:3b"
            disabled={isPulling || phase.kind === 'done'}
            data-testid="ollama-pull-input"
            autoFocus
          />

          {phase.kind === 'idle' && (
            <div className="flex flex-wrap gap-2" data-testid="ollama-pull-suggestions">
              {SUGGESTED_MODELS.map((m) => (
                <Button
                  key={m.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setName(m.name)}
                  data-testid={`ollama-pull-suggest-${m.name}`}
                >
                  {m.name}
                  <span className="ml-2 text-[var(--muted-foreground)]">{m.hint}</span>
                </Button>
              ))}
            </div>
          )}

          {phase.kind === 'pulling' && (
            <OllamaPullProgress
              status={phase.status}
              completed={phase.completed}
              total={phase.total}
            />
          )}

          {phase.kind === 'done' && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" data-testid="ollama-pull-success">
              Successfully pulled <code>{name.trim()}</code>.
            </p>
          )}

          {phase.kind === 'error' && (
            <p className="text-sm text-[var(--destructive)]" role="alert" data-testid="ollama-pull-error">
              {phase.message}
            </p>
          )}
        </div>

        <DialogFooter>
          {phase.kind === 'pulling' && (
            <Button type="button" variant="outline" onClick={handleCancel} data-testid="ollama-pull-cancel">
              Cancel
            </Button>
          )}
          {phase.kind === 'done' && (
            <Button type="button" onClick={handleDone} data-testid="ollama-pull-done">
              Done
            </Button>
          )}
          {phase.kind === 'error' && (
            <Button type="button" onClick={() => void startPull()} data-testid="ollama-pull-retry">
              Retry
            </Button>
          )}
          {phase.kind === 'idle' && (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button type="button" disabled={!canSubmit} onClick={() => void startPull()} data-testid="ollama-pull-start">
                Pull
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
