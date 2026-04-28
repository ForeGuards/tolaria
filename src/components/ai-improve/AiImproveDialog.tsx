import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  streamAiCompletion,
  type AiCompletionAgentId,
  type AiCompletionEvent,
} from '@/lib/ollama'
import {
  AI_IMPROVE_CUSTOM_ID,
  AI_IMPROVE_PRESETS,
  AiImprovePresets,
  type AiImprovePreset,
} from './AiImprovePresets'

export interface AiImproveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedText: string
  defaultAgent: AiCompletionAgentId
  ollamaActiveModel: string | null
  availableAgents: { claude_code: boolean; codex: boolean; ollama: boolean }
  onAccept: (improvedText: string) => void
}

const SYSTEM_PROMPT = `You are an editing assistant integrated into Tolaria, a markdown knowledge management app. The user will give you a snippet of their note text and an instruction. Apply the instruction and return ONLY the resulting text — no preamble, no explanation, no markdown code fences. If the input is markdown, preserve markdown formatting (headings, lists, links, [[wikilinks]], **bold**, *italics*, code blocks).`

interface AgentOption {
  id: AiCompletionAgentId
  label: string
  available: boolean
  hint?: string
}

function buildAgentOptions(
  available: AiImproveDialogProps['availableAgents'],
  ollamaActiveModel: string | null,
): AgentOption[] {
  return [
    { id: 'claude_code', label: 'Claude Code', available: available.claude_code },
    { id: 'codex', label: 'Codex', available: available.codex },
    {
      id: 'ollama',
      label: ollamaActiveModel ? `Ollama (${ollamaActiveModel})` : 'Ollama',
      available: available.ollama && Boolean(ollamaActiveModel),
      hint: available.ollama && !ollamaActiveModel ? 'Configure Ollama in Settings first' : undefined,
    },
  ]
}

function pickInitialAgent(
  preferred: AiCompletionAgentId,
  options: AgentOption[],
): AiCompletionAgentId {
  const preferredOpt = options.find((o) => o.id === preferred)
  if (preferredOpt?.available) return preferred
  return options.find((o) => o.available)?.id ?? preferred
}

type ImprovePhase =
  | { kind: 'idle' }
  | { kind: 'streaming'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string; partialText: string }

const IDLE_PHASE: ImprovePhase = { kind: 'idle' }

function ResultPanel({ phase }: { phase: ImprovePhase }) {
  if (phase.kind === 'idle') return null
  const text =
    phase.kind === 'streaming' || phase.kind === 'done'
      ? phase.text
      : phase.partialText
  return (
    <div
      data-testid="ai-improve-result"
      className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-sm"
    >
      {text || (phase.kind === 'streaming' ? 'Working…' : '')}
    </div>
  )
}

export function AiImproveDialog({
  open,
  onOpenChange,
  selectedText,
  defaultAgent,
  ollamaActiveModel,
  availableAgents,
  onAccept,
}: AiImproveDialogProps) {
  const agentOptions = useMemo(
    () => buildAgentOptions(availableAgents, ollamaActiveModel),
    [availableAgents, ollamaActiveModel],
  )
  const [agent, setAgent] = useState<AiCompletionAgentId>(() => pickInitialAgent(defaultAgent, agentOptions))
  const [presetId, setPresetId] = useState<string | null>(null)
  const [customInstruction, setCustomInstruction] = useState('')
  const [phase, setPhase] = useState<ImprovePhase>(IDLE_PHASE)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setAgent(pickInitialAgent(defaultAgent, agentOptions))
    setPresetId(null)
    setCustomInstruction('')
    setPhase(IDLE_PHASE)
    cancelRef.current = false
  }, [open, defaultAgent, agentOptions])

  const instruction = useMemo(() => {
    if (presetId === AI_IMPROVE_CUSTOM_ID) return customInstruction.trim()
    if (!presetId) return ''
    return AI_IMPROVE_PRESETS.find((p) => p.id === presetId)?.instruction ?? ''
  }, [presetId, customInstruction])

  const handlePreset = useCallback((preset: AiImprovePreset) => {
    setPresetId(preset.id)
  }, [])

  const handleCustom = useCallback(() => {
    setPresetId(AI_IMPROVE_CUSTOM_ID)
  }, [])

  const submitImprove = useCallback(async () => {
    if (!instruction || !selectedText.trim()) return
    cancelRef.current = false
    setPhase({ kind: 'streaming', text: '' })
    let accumulated = ''
    const onEvent = (event: AiCompletionEvent) => {
      if (cancelRef.current) return
      if (event.kind === 'text') {
        accumulated += event.delta
        setPhase({ kind: 'streaming', text: accumulated })
        return
      }
      if (event.kind === 'done') {
        setPhase({ kind: 'done', text: accumulated })
        return
      }
      setPhase({ kind: 'error', message: event.message, partialText: accumulated })
    }
    try {
      await streamAiCompletion(
        {
          agent,
          model: agent === 'ollama' ? ollamaActiveModel : null,
          system_prompt: SYSTEM_PROMPT,
          user_prompt: `${instruction}\n\n---\n${selectedText}`,
          temperature: 0.5,
        },
        onEvent,
      )
      if (cancelRef.current) return
      setPhase((prev) => (prev.kind === 'streaming' ? { kind: 'done', text: prev.text } : prev))
    } catch (err) {
      if (cancelRef.current) return
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        partialText: accumulated,
      })
    }
  }, [agent, instruction, selectedText, ollamaActiveModel])

  const handleAccept = useCallback(() => {
    if (phase.kind !== 'done') return
    onAccept(phase.text)
    onOpenChange(false)
  }, [phase, onAccept, onOpenChange])

  const handleClose = useCallback(() => {
    cancelRef.current = true
    onOpenChange(false)
  }, [onOpenChange])

  const canSubmit = phase.kind !== 'streaming' && instruction.length > 0
  const ollamaHint = agentOptions.find((o) => o.id === 'ollama')?.hint

  return (
    <Dialog open={open} onOpenChange={(next) => { if (phase.kind !== 'streaming') onOpenChange(next) }}>
      <DialogContent className="max-w-2xl" data-testid="ai-improve-dialog">
        <DialogHeader>
          <DialogTitle>Improve text</DialogTitle>
          <DialogDescription>
            Pick what to do with the selected text and which agent to ask.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Selected text</p>
            <div
              data-testid="ai-improve-selection"
              className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)] p-2 text-sm text-[var(--foreground)]"
            >
              {selectedText}
            </div>
          </div>

          <AiImprovePresets
            selectedId={presetId}
            disabled={phase.kind === 'streaming'}
            onSelectPreset={handlePreset}
            onSelectCustom={handleCustom}
          />

          {presetId === AI_IMPROVE_CUSTOM_ID && (
            <Textarea
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="Describe what you want — e.g. 'rephrase as bullet points'"
              disabled={phase.kind === 'streaming'}
              data-testid="ai-improve-custom-input"
              rows={2}
            />
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">Improve with</span>
            <Select
              value={agent}
              onValueChange={(value) => setAgent(value as AiCompletionAgentId)}
              disabled={phase.kind === 'streaming'}
            >
              <SelectTrigger data-testid="ai-improve-agent-select" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agentOptions.map((opt) => (
                  <SelectItem
                    key={opt.id}
                    value={opt.id}
                    disabled={!opt.available}
                    data-testid={`ai-improve-agent-${opt.id}`}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ollamaHint && (
              <span className="text-xs text-[var(--muted-foreground)]" data-testid="ai-improve-ollama-hint">
                {ollamaHint}
              </span>
            )}
          </div>

          <ResultPanel phase={phase} />

          {phase.kind === 'error' && (
            <p className="text-sm text-[var(--destructive)]" role="alert" data-testid="ai-improve-error">
              {phase.message}
            </p>
          )}
        </div>

        <DialogFooter>
          {(phase.kind === 'idle' || phase.kind === 'error') && (
            <>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submitImprove()}
                disabled={!canSubmit}
                data-testid="ai-improve-submit"
              >
                {phase.kind === 'error' ? 'Retry' : 'Improve'}
              </Button>
            </>
          )}
          {phase.kind === 'streaming' && (
            <Button type="button" variant="ghost" disabled data-testid="ai-improve-streaming">
              Streaming…
            </Button>
          )}
          {phase.kind === 'done' && (
            <>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Reject
              </Button>
              <Button type="button" variant="outline" onClick={() => void submitImprove()} data-testid="ai-improve-retry">
                Retry
              </Button>
              <Button type="button" onClick={handleAccept} data-testid="ai-improve-accept">
                Accept
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
