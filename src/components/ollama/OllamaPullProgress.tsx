import { cn } from '@/lib/utils'

interface OllamaPullProgressProps {
  status: string
  completed: number
  total: number
  className?: string
}

const KILOBYTE = 1024
const MEGABYTE = KILOBYTE * 1024
const GIGABYTE = MEGABYTE * 1024

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= GIGABYTE) return `${(bytes / GIGABYTE).toFixed(1)} GB`
  if (bytes >= MEGABYTE) return `${(bytes / MEGABYTE).toFixed(1)} MB`
  if (bytes >= KILOBYTE) return `${(bytes / KILOBYTE).toFixed(1)} KB`
  return `${bytes} B`
}

function computePercent(completed: number, total: number): number | null {
  if (total <= 0) return null
  const pct = (completed / total) * 100
  if (!Number.isFinite(pct)) return null
  return Math.max(0, Math.min(100, pct))
}

interface ProgressBarProps {
  percent: number | null
}

function ProgressBar({ percent }: ProgressBarProps) {
  const indeterminate = percent === null
  const width = indeterminate ? 100 : percent
  return (
    <div
      data-testid="ollama-pull-progress-track"
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent ?? 0)}
    >
      <div
        data-testid="ollama-pull-progress-fill"
        className={cn(
          'h-full rounded-full bg-[var(--primary)] transition-[width] duration-200 ease-out',
          indeterminate && 'opacity-40'
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

interface SizeLineProps {
  completed: number
  total: number
}

function SizeLine({ completed, total }: SizeLineProps) {
  if (total <= 0) return null
  return (
    <span data-testid="ollama-pull-bytes" className="tabular-nums">
      {formatBytes(completed)} / {formatBytes(total)}
    </span>
  )
}

export function OllamaPullProgress({ status, completed, total, className }: OllamaPullProgressProps) {
  const percent = computePercent(completed, total)
  const percentLabel = percent === null ? null : `${percent.toFixed(0)}%`

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="ollama-pull-progress">
      <ProgressBar percent={percent} />
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
        <span data-testid="ollama-pull-status" className="truncate">
          {status}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <SizeLine completed={completed} total={total} />
          {percentLabel !== null && (
            <span data-testid="ollama-pull-percent" className="tabular-nums text-[var(--foreground)]">
              {percentLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export const __test__ = { formatBytes, computePercent }
