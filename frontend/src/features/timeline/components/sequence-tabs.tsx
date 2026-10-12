import { memo, useCallback, useRef, useState } from 'react'
import { Film, MoreVertical, Plus, X } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useSequencesStore } from '../stores/sequences-store'
import { useCompositionsStore } from '../stores/compositions-store'
import {
  useCompositionNavigationStore,
  getActiveTabId,
} from '../stores/composition-navigation-store'
import {
  closeSequenceTab,
  createSequence,
  deleteCompoundClips,
  renameCompoundClip,
} from '../stores/actions/composition-actions'

/**
 * Standalone-timeline tab strip (multi-timeline). Lists the Main timeline plus
 * every top-level sequence; clicking switches which sequence is live. A
 * sequence is the same primitive as a compound clip — see sequences-store.
 */
export const SequenceTabs = memo(function SequenceTabs() {
  const topLevelSequenceIds = useSequencesStore((s) => s.topLevelSequenceIds)
  const compositionById = useCompositionsStore((s) => s.compositionById)
  const breadcrumbs = useCompositionNavigationStore((s) => s.breadcrumbs)
  const switchToSequence = useCompositionNavigationStore((s) => s.switchToSequence)
  const activeTabId = getActiveTabId(breadcrumbs)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const cancelledRef = useRef(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const beginRename = useCallback((id: string, currentName: string) => {
    cancelledRef.current = false
    setDraftName(currentName)
    setEditingId(id)
  }, [])

  const commitRename = useCallback(
    (id: string) => {
      // Escape sets the cancel guard; the unmount-triggered blur must not commit.
      if (cancelledRef.current) {
        cancelledRef.current = false
        setEditingId(null)
        return
      }
      renameCompoundClip(id, draftName)
      setEditingId(null)
    },
    [draftName],
  )

  // Only render tabs whose composition still exists (guards against dangling ids
  // e.g. after an undone create-sequence).
  const tabs = topLevelSequenceIds
    .map((id) => compositionById[id])
    .filter((comp): comp is NonNullable<typeof comp> => Boolean(comp))

  // Main is the active tab whenever the breadcrumb root is Main — including when
  // drilled into a compound clip from Main (that's the Main lineage, not a tab).
  const isMainActive = activeTabId === null

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-background/60 backdrop-blur-sm text-xs overflow-x-auto">
      <button
        type="button"
        onClick={() => switchToSequence(null)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 whitespace-nowrap transition-colors cursor-pointer',
          isMainActive
            ? 'bg-accent text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
        )}
      >
        <Film className="h-3 w-3" />
        Main
      </button>

      {tabs.map((comp) => {
        const isActive = activeTabId === comp.id
        const isEditing = editingId === comp.id
        return (
          <div
            key={comp.id}
            className={cn(
              'group flex items-center gap-1 rounded-md pl-2.5 pr-1 py-1 whitespace-nowrap transition-colors',
              isActive
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {isEditing ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(comp.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename(comp.id)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelledRef.current = true
                    ;(e.target as HTMLInputElement).blur()
                  }
                  e.stopPropagation()
                }}
                className="w-24 bg-transparent outline-none border-b border-border"
              />
            ) : (
              <button
                type="button"
                onClick={() => switchToSequence(comp.id)}
                onDoubleClick={() => beginRename(comp.id, comp.name)}
                className="cursor-pointer max-w-[10rem] truncate"
                title={comp.name}
              >
                {comp.name}
              </button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Sequence options"
                  className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 rounded p-0.5 hover:bg-accent transition-opacity cursor-pointer"
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                <DropdownMenuItem onSelect={() => beginRename(comp.id, comp.name)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => closeSequenceTab(comp.id)}>
                  Close tab
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteTarget({ id: comp.id, name: comp.name })}
                >
                  Delete sequence
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              aria-label="Close tab"
              onClick={() => closeSequenceTab(comp.id)}
              className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-accent transition-opacity cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        aria-label="New sequence"
        title="New sequence"
        onClick={() => createSequence()}
        className="ml-0.5 flex items-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sequence</AlertDialogTitle>
            <AlertDialogDescription>
              Delete sequence &ldquo;{deleteTarget?.name}&rdquo;? Any clips that reference it will
              also be removed. This can be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteCompoundClips([deleteTarget.id])
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})
