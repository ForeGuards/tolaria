import { memo, useState, useRef, useCallback } from 'react'
import type { VaultEntry } from '../types'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { Plus, Columns, ArrowsOutSimple } from '@phosphor-icons/react'

interface Tab {
  entry: VaultEntry
  content: string
}

interface TabBarProps {
  tabs: Tab[]
  activeTabPath: string | null
  onSwitchTab: (path: string) => void
  onCloseTab: (path: string) => void
  onCreateNote?: () => void
  onReorderTabs?: (fromIndex: number, toIndex: number) => void
}

const DISABLED_ICON_STYLE = { opacity: 0.4, cursor: 'not-allowed' } as const

// --- Drag-and-drop helpers ---

function computeDropTarget(dragIdx: number | null, dropIdx: number | null): number | null {
  if (dragIdx === null || dropIdx === null || dragIdx === dropIdx) return null
  const toIndex = dropIdx > dragIdx ? dropIdx - 1 : dropIdx
  return toIndex !== dragIdx ? toIndex : null
}

function computeInsertIndex(e: React.DragEvent<HTMLDivElement>, index: number): number {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientX < rect.left + rect.width / 2 ? index : index + 1
}

function useTabDrag(onReorderTabs?: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const resetDrag = useCallback(() => {
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = ''
    dragNodeRef.current = null
    setDragIndex(null)
    setDropIndex(null)
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    dragNodeRef.current = e.currentTarget
    requestAnimationFrame(() => {
      if (dragNodeRef.current) dragNodeRef.current.style.opacity = '0.5'
    })
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragIndex === null || dragIndex === index) { setDropIndex(null); return }
    setDropIndex(computeInsertIndex(e, index))
  }, [dragIndex])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const toIndex = computeDropTarget(dragIndex, dropIndex)
    if (toIndex !== null && onReorderTabs) onReorderTabs(dragIndex!, toIndex)
    resetDrag()
  }, [dragIndex, dropIndex, onReorderTabs, resetDrag])

  const handleBarDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as HTMLElement | null
    if (!e.currentTarget.contains(related)) setDropIndex(null)
  }, [])

  return { dragIndex, dropIndex, handleDragStart, handleDragEnd: resetDrag, handleDragOver, handleDrop, handleBarDragLeave }
}

// --- Sub-components ---

function DropIndicator({ side }: { side: 'left' | 'right' }) {
  return (
    <div style={{
      position: 'absolute', [side]: -1, top: 8, bottom: 8,
      width: 2, background: 'var(--primary)', borderRadius: 1, zIndex: 10,
    }} />
  )
}

function TabItem({ tab, isActive, isDragging, showDropBefore, showDropAfter, onSwitch, onClose, dragProps }: {
  tab: Tab
  isActive: boolean
  isDragging: boolean
  showDropBefore: boolean
  showDropAfter: boolean
  onSwitch: () => void
  onClose: () => void
  dragProps: React.HTMLAttributes<HTMLDivElement>
}) {
  return (
    <div
      draggable
      {...dragProps}
      className={cn(
        "group flex shrink-0 items-center gap-1.5 whitespace-nowrap max-w-[180px] transition-all relative",
        isActive ? "text-foreground" : "text-muted-foreground hover:text-secondary-foreground"
      )}
      style={{
        background: isActive ? 'var(--background)' : 'transparent',
        borderRight: `1px solid ${isActive ? 'var(--border)' : 'var(--sidebar-border)'}`,
        borderBottom: isActive ? 'none' : '1px solid var(--sidebar-border)',
        padding: '0 12px', fontSize: 12,
        fontWeight: isActive ? 500 : 400,
        cursor: isDragging ? 'grabbing' : 'grab',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onClick={onSwitch}
    >
      {showDropBefore && <DropIndicator side="left" />}
      <span className="truncate">{tab.entry.title}</span>
      <button
        className={cn(
          "shrink-0 rounded-sm p-0 bg-transparent border-none text-muted-foreground cursor-pointer transition-opacity hover:bg-accent hover:text-foreground",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        style={{ lineHeight: 0 }}
        draggable={false}
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        <X size={14} />
      </button>
      {showDropAfter && <DropIndicator side="right" />}
    </div>
  )
}

function TabBarActions({ onCreateNote }: { onCreateNote?: () => void }) {
  return (
    <div
      className="flex shrink-0 items-center"
      style={{
        borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        gap: 12, padding: '0 12px', WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <button className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onClick={onCreateNote} title="New note">
        <Plus size={16} />
      </button>
      <button className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground" style={DISABLED_ICON_STYLE} title="Coming soon" tabIndex={-1}>
        <Columns size={16} />
      </button>
      <button className="flex items-center justify-center border-none bg-transparent p-0 text-muted-foreground" style={DISABLED_ICON_STYLE} title="Coming soon" tabIndex={-1}>
        <ArrowsOutSimple size={16} />
      </button>
    </div>
  )
}

// --- Main TabBar ---

export const TabBar = memo(function TabBar({
  tabs, activeTabPath, onSwitchTab, onCloseTab, onCreateNote, onReorderTabs,
}: TabBarProps) {
  const { dragIndex, dropIndex, handleDragStart, handleDragEnd, handleDragOver, handleDrop, handleBarDragLeave } = useTabDrag(onReorderTabs)

  return (
    <div
      className="flex shrink-0 items-stretch"
      style={{ height: 45, background: 'var(--sidebar)', WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-tauri-drag-region
      onDragLeave={handleBarDragLeave}
    >
      {tabs.map((tab, index) => (
        <TabItem
          key={tab.entry.path}
          tab={tab}
          isActive={tab.entry.path === activeTabPath}
          isDragging={dragIndex !== null}
          showDropBefore={dropIndex === index}
          showDropAfter={dropIndex === index + 1 && index === tabs.length - 1}
          onSwitch={() => onSwitchTab(tab.entry.path)}
          onClose={() => onCloseTab(tab.entry.path)}
          dragProps={{
            onDragStart: (e) => handleDragStart(e, index),
            onDragEnd: handleDragEnd,
            onDragOver: (e) => handleDragOver(e, index),
            onDrop: handleDrop,
          }}
        />
      ))}
      <div className="flex-1" style={{ borderBottom: '1px solid var(--border)' }} />
      <TabBarActions onCreateNote={onCreateNote} />
    </div>
  )
})
