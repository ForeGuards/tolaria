import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const NOTE_TYPES = [
  'Note',
  'Project',
  'Experiment',
  'Responsibility',
  'Procedure',
  'Person',
  'Event',
  'Topic',
] as const

export type NoteType = (typeof NOTE_TYPES)[number]

interface CreateNoteDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (title: string, type: NoteType) => void
  defaultType?: NoteType
}

export function CreateNoteDialog({ open, onClose, onCreate, defaultType }: CreateNoteDialogProps) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<NoteType>('Note')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setType(defaultType ?? 'Note')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, defaultType])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onCreate(trimmed, type)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create New Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Title
            </label>
            <Input
              ref={inputRef}
              placeholder="Enter note title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Type
            </label>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={type === t ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "rounded-full text-xs",
                    type === t && "bg-primary text-primary-foreground"
                  )}
                  onClick={() => setType(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
