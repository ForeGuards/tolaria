import { memo } from 'react'
import { Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import type { OllamaModel } from '@/lib/ollama/types'

interface OllamaModelRowProps {
  model: OllamaModel
  isActive: boolean
  isWarm: boolean
  isLoaded: boolean
  onSelectActive: (name: string) => void
  onToggleWarm: (name: string) => void
  onDelete: (name: string) => void
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--background)',
}

const NAME_BLOCK_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
}

const NAME_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const META_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--muted-foreground)',
}

const ACTIVE_RADIO_BUTTON_STYLE: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: '2px solid var(--border)',
  background: 'var(--background)',
  cursor: 'pointer',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

const ACTIVE_RADIO_DOT_STYLE: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--primary)',
}

export function formatModelSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(decimals)} ${units[unitIndex]}`
}

function ActiveRadio({
  name,
  checked,
  onSelect,
}: {
  name: string
  checked: boolean
  onSelect: (name: string) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={`Set ${name} as active model`}
      data-testid={`ollama-active-radio-${name}`}
      onClick={() => onSelect(name)}
      style={{
        ...ACTIVE_RADIO_BUTTON_STYLE,
        borderColor: checked ? 'var(--primary)' : 'var(--border)',
      }}
    >
      {checked && <span style={ACTIVE_RADIO_DOT_STYLE} />}
    </button>
  )
}

export const OllamaModelRow = memo(function OllamaModelRow({
  model,
  isActive,
  isWarm,
  isLoaded,
  onSelectActive,
  onToggleWarm,
  onDelete,
}: OllamaModelRowProps) {
  const sizeLabel = formatModelSize(model.size)
  const paramLabel = model.parameter_size ?? null

  return (
    <div style={ROW_STYLE} data-testid={`ollama-model-row-${model.name}`}>
      <ActiveRadio name={model.name} checked={isActive} onSelect={onSelectActive} />

      <div style={NAME_BLOCK_STYLE}>
        <div style={NAME_ROW_STYLE}>
          <span style={{ fontWeight: 500, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {model.name}
          </span>
          {isLoaded && (
            <Badge variant="secondary" data-testid={`ollama-loaded-badge-${model.name}`}>
              Loaded
            </Badge>
          )}
        </div>
        <div style={META_ROW_STYLE}>
          {paramLabel && <span data-testid={`ollama-params-${model.name}`}>{paramLabel}</span>}
          {paramLabel && <span aria-hidden="true">·</span>}
          <span data-testid={`ollama-size-${model.name}`}>{sizeLabel}</span>
        </div>
      </div>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-foreground)', cursor: isActive ? 'not-allowed' : 'pointer' }}
        title={isActive ? 'Active model is always kept warm' : 'Keep this model preloaded so switching is instant'}
      >
        <Checkbox
          checked={isWarm || isActive}
          disabled={isActive}
          onCheckedChange={() => onToggleWarm(model.name)}
          aria-label={`Keep ${model.name} warm`}
          data-testid={`ollama-warm-checkbox-${model.name}`}
        />
        <span>Keep warm</span>
      </label>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${model.name}`}
        data-testid={`ollama-delete-btn-${model.name}`}
        onClick={() => onDelete(model.name)}
      >
        <Trash size={16} />
      </Button>
    </div>
  )
})
