import { memo } from 'react'
import type { VaultEntry } from '../types'
import { cn } from '@/lib/utils'
import {
  MagnifyingGlass,
  GitBranch,
  CursorText,
  Sparkle,
  DotsThree,
} from '@phosphor-icons/react'

interface BreadcrumbBarProps {
  entry: VaultEntry
  wordCount: number
  isModified: boolean
  showDiffToggle: boolean
  diffMode: boolean
  diffLoading: boolean
  onToggleDiff: () => void
  showAIChat?: boolean
  onToggleAIChat?: () => void
}

const DISABLED_ICON_STYLE = { opacity: 0.4, cursor: 'not-allowed' } as const

export const BreadcrumbBar = memo(function BreadcrumbBar({
  entry, wordCount, isModified, showDiffToggle, diffMode, diffLoading,
  onToggleDiff, showAIChat, onToggleAIChat,
}: BreadcrumbBarProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-between"
      style={{
        height: 45,
        background: 'var(--background)',
        borderBottom: '1px solid var(--border)',
        padding: '6px 16px',
      }}
    >
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-1" style={{ fontSize: 12 }}>
        <span className="text-muted-foreground">{entry.isA || 'Note'}</span>
        <span className="text-muted-foreground" style={{ margin: '0 2px' }}>&rsaquo;</span>
        <span className="font-medium text-foreground">{entry.title}</span>
        <span className="text-muted-foreground" style={{ margin: '0 4px' }}>&middot;</span>
        <span className="text-muted-foreground">{wordCount.toLocaleString()} words</span>
        {isModified && (
          <>
            <span className="text-muted-foreground" style={{ margin: '0 4px' }}>&middot;</span>
            <span className="font-semibold" style={{ color: 'var(--accent-yellow)' }}>M</span>
          </>
        )}
      </div>

      {/* Right: action icons */}
      <div className="flex items-center" style={{ gap: 12 }}>
        <button
          className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
          title="Search in file"
        >
          <MagnifyingGlass size={16} />
        </button>
        {showDiffToggle ? (
          <button
            className={cn(
              "flex items-center justify-center border-none bg-transparent p-0 cursor-pointer transition-colors",
              diffMode ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={onToggleDiff}
            disabled={diffLoading}
            title={diffLoading ? 'Loading diff...' : diffMode ? 'Back to editor' : 'Show diff'}
          >
            <GitBranch size={16} />
          </button>
        ) : (
          <button
            className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground"
            style={DISABLED_ICON_STYLE}
            title="No changes"
            tabIndex={-1}
          >
            <GitBranch size={16} />
          </button>
        )}
        <button
          className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground"
          style={DISABLED_ICON_STYLE}
          title="Coming soon"
          tabIndex={-1}
        >
          <CursorText size={16} />
        </button>
        <button
          className={cn(
            "flex items-center justify-center border-none bg-transparent p-0 cursor-pointer transition-colors",
            showAIChat ? "" : "text-muted-foreground hover:text-foreground"
          )}
          style={showAIChat ? { color: 'var(--primary)' } : undefined}
          onClick={onToggleAIChat}
          title={showAIChat ? 'Close AI Chat' : 'Open AI Chat'}
        >
          <Sparkle size={16} weight={showAIChat ? 'fill' : 'regular'} />
        </button>
        <button
          className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground"
          style={DISABLED_ICON_STYLE}
          title="Coming soon"
          tabIndex={-1}
        >
          <DotsThree size={16} />
        </button>
      </div>
    </div>
  )
})
