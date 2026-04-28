import { Button } from '../ui/button'

export interface AiImprovePreset {
  id: string
  label: string
  instruction: string
}

export const AI_IMPROVE_PRESETS: readonly AiImprovePreset[] = [
  {
    id: 'fix-grammar',
    label: 'Fix grammar',
    instruction:
      'Fix grammar and spelling. Keep style and meaning. Return ONLY the fixed text, with no explanation or commentary.',
  },
  {
    id: 'make-shorter',
    label: 'Make shorter',
    instruction:
      'Make this shorter without losing meaning. Return ONLY the shorter version.',
  },
  {
    id: 'make-longer',
    label: 'Make longer',
    instruction:
      'Expand this with more detail and examples. Return ONLY the expanded version.',
  },
  {
    id: 'improve-clarity',
    label: 'Improve clarity',
    instruction:
      'Improve clarity and flow. Keep the meaning. Return ONLY the improved text.',
  },
  {
    id: 'translate-en',
    label: 'Translate to English',
    instruction: 'Translate to English. Return ONLY the translation.',
  },
  {
    id: 'translate-it',
    label: 'Translate to Italian',
    instruction: 'Translate to Italian. Return ONLY the translation.',
  },
] as const

export const AI_IMPROVE_CUSTOM_ID = 'custom'

interface AiImprovePresetsProps {
  selectedId: string | null
  disabled?: boolean
  onSelectPreset: (preset: AiImprovePreset) => void
  onSelectCustom: () => void
}

export function AiImprovePresets({
  selectedId,
  disabled = false,
  onSelectPreset,
  onSelectCustom,
}: AiImprovePresetsProps) {
  return (
    <div
      data-testid="ai-improve-presets"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {AI_IMPROVE_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          size="sm"
          variant={selectedId === preset.id ? 'default' : 'outline'}
          disabled={disabled}
          data-testid={`ai-improve-preset-${preset.id}`}
          onClick={() => onSelectPreset(preset)}
        >
          {preset.label}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        variant={selectedId === AI_IMPROVE_CUSTOM_ID ? 'default' : 'outline'}
        disabled={disabled}
        data-testid="ai-improve-preset-custom"
        onClick={onSelectCustom}
      >
        Custom…
      </Button>
    </div>
  )
}
