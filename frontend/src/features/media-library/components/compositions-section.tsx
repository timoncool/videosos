import { useState, useCallback, useMemo, useRef, useEffect, memo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Trash2, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
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
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  openComposition,
  openCompositionAsTab,
  renameCompoundClip,
  useCompositionsStore,
  useCompositionNavigationStore,
  useSequencesStore,
  type SubComposition,
  wouldCreateCompositionCycle,
} from '@/features/media-library/deps/timeline-stores'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache'
import { GRID_MIN_SIZE_PX, GRID_GAP_BY_SIZE } from './media-grid-constants'
import { CARD_GRID_BASE, CARD_LIST_BASE, CARD_PERF_STYLE } from './card-styles'
import { compoundClipThumbnailService } from '../services/compound-clip-thumbnail-service'

function getSkimIndicatorStyle(progress: number): CSSProperties {
  if (progress >= 0.999) {
    return { right: 0 }
  }

  return {
    left: `${progress * 100}%`,
  }
}

/**
 * Compositions section in the media library.
 * Displays all sub-compositions as reusable assets.
 * Hidden when no compositions exist.
 */
export function CompositionsSection() {
  const { t } = useTranslation()
  const compositions = useCompositionsStore((s) => s.compositions)
  const compositionById = useCompositionsStore((s) => s.compositionById)
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId)
  const topLevelSequenceIds = useSequencesStore((s) => s.topLevelSequenceIds)

  const viewMode = useMediaLibraryStore((s) => s.viewMode)
  const mediaItemSize = useMediaLibraryStore((s) => s.mediaItemSize)
  const selectedCompositionIds = useMediaLibraryStore((s) => s.selectedCompositionIds)
  const isTranscriptionDialogOpen = useEditorStore((s) => s.transcriptionDialogDepth > 0)
  const selectedCompositionIdSet = useMemo(
    () => new Set(selectedCompositionIds),
    [selectedCompositionIds],
  )
  const [open, setOpen] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<SubComposition | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Classic sequences/compound clips and layer-based compositions share the
  // render primitive but open in different editing surfaces.
  const sequenceIdSet = useMemo(() => new Set(topLevelSequenceIds), [topLevelSequenceIds])
  const { sequences, compositeCompositions, compoundClips } = useMemo(() => {
    const seqs: SubComposition[] = []
    const composites: SubComposition[] = []
    const clips: SubComposition[] = []
    for (const comp of compositions) {
      if (comp.editorKind === 'composite-2d') composites.push(comp)
      else if (sequenceIdSet.has(comp.id)) seqs.push(comp)
      else clips.push(comp)
    }
    return { sequences: seqs, compositeCompositions: composites, compoundClips: clips }
  }, [compositions, sequenceIdSet])
  const orderedCompositions = useMemo(
    () => [...sequences, ...compositeCompositions, ...compoundClips],
    [sequences, compositeCompositions, compoundClips],
  )
  // Only show the per-group sub-headers when both groups are populated —
  // otherwise the section header alone is enough and a lone sub-header reads
  // as redundant chrome.
  const showGroupHeaders =
    [sequences, compositeCompositions, compoundClips].filter((group) => group.length > 0).length > 1

  const compositionsRef = useRef(orderedCompositions)
  const editValueRef = useRef(editValue)
  const renameCancelledRef = useRef(false)
  const lastSelectedCompositionIdRef = useRef<string | null>(null)

  useEffect(() => {
    compositionsRef.current = orderedCompositions
  }, [orderedCompositions])

  useEffect(() => {
    editValueRef.current = editValue
  }, [editValue])

  const handleEnter = useCallback((comp: SubComposition) => {
    openComposition(comp.id, comp.name)
  }, [])

  const handleDeleteRequest = useCallback((comp: SubComposition) => {
    setDeleteTarget(comp)
  }, [])

  const handleOpenAsTab = useCallback((comp: SubComposition) => {
    openCompositionAsTab(comp.id)
  }, [])

  const handleCompositionSelect = useCallback((compositionId: string, event?: React.MouseEvent) => {
    const currentCompositions = compositionsRef.current
    const mediaStore = useMediaLibraryStore.getState()

    if (event?.shiftKey && lastSelectedCompositionIdRef.current) {
      const lastIndex = currentCompositions.findIndex(
        (item) => item.id === lastSelectedCompositionIdRef.current,
      )
      const currentIndex = currentCompositions.findIndex((item) => item.id === compositionId)

      if (lastIndex !== -1 && currentIndex !== -1) {
        const startIndex = Math.min(lastIndex, currentIndex)
        const endIndex = Math.max(lastIndex, currentIndex)
        const rangeIds = currentCompositions.slice(startIndex, endIndex + 1).map((item) => item.id)

        if (event.ctrlKey || event.metaKey) {
          mediaStore.setSelection({
            mediaIds: mediaStore.selectedMediaIds,
            compositionIds: [...new Set([...mediaStore.selectedCompositionIds, ...rangeIds])],
          })
        } else {
          mediaStore.setSelection({ mediaIds: [], compositionIds: rangeIds })
        }
        return
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      mediaStore.toggleCompositionSelection(compositionId)
      lastSelectedCompositionIdRef.current = compositionId
      return
    }

    mediaStore.setSelection({ mediaIds: [], compositionIds: [compositionId] })
    lastSelectedCompositionIdRef.current = compositionId
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return
    deleteCompoundClips([deleteTarget.id])
    const mediaStore = useMediaLibraryStore.getState()
    mediaStore.setSelection({
      mediaIds: mediaStore.selectedMediaIds,
      compositionIds: mediaStore.selectedCompositionIds.filter((id) => id !== deleteTarget.id),
    })
    setDeleteTarget(null)
  }, [deleteTarget])

  const handleStartRename = useCallback((comp: SubComposition) => {
    setEditingId(comp.id)
    setEditValue(comp.name)
  }, [])

  const handleCommitRename = useCallback((id: string) => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      setEditingId(null)
      return
    }
    const trimmed = editValueRef.current.trim()
    if (trimmed && trimmed !== useCompositionsStore.getState().getComposition(id)?.name) {
      renameCompoundClip(id, trimmed)
    }
    setEditingId(null)
  }, [])

  const handleCancelRename = useCallback(() => {
    renameCancelledRef.current = true
    setEditingId(null)
  }, [])

  const cardHandlersById = useMemo(
    () =>
      new Map(
        compositions.map((comp) => [
          comp.id,
          {
            onSelect: (event: React.MouseEvent) => handleCompositionSelect(comp.id, event),
            onEnter: () => handleEnter(comp),
            onOpenAsTab: () => handleOpenAsTab(comp),
            onDelete: () => handleDeleteRequest(comp),
            onStartRename: () => handleStartRename(comp),
          },
        ]),
      ),
    [
      compositions,
      handleCompositionSelect,
      handleDeleteRequest,
      handleEnter,
      handleOpenAsTab,
      handleStartRename,
    ],
  )

  const deleteImpact = deleteTarget
    ? getCompoundClipDeletionImpact([deleteTarget.id])
    : { rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 }
  // A sequence is the same primitive as a compound clip — only the label
  // differs (top-level tab vs embed-only). Membership is stable while the
  // dialog is open, so a non-reactive read is fine.
  const isSequenceTarget = deleteTarget
    ? useSequencesStore.getState().isTopLevelSequence(deleteTarget.id)
    : false

  if (compositions.length === 0) return null

  const groupContainerClassName =
    viewMode === 'grid'
      ? `grid ${GRID_GAP_BY_SIZE[mediaItemSize] ?? GRID_GAP_BY_SIZE[3]}`
      : 'space-y-1'
  const groupContainerStyle: CSSProperties | undefined =
    viewMode === 'grid'
      ? {
          gridTemplateColumns: `repeat(auto-fill, minmax(min(${GRID_MIN_SIZE_PX[mediaItemSize] ?? GRID_MIN_SIZE_PX[3]}px, 100%), 1fr))`,
        }
      : undefined

  const renderCard = (comp: SubComposition) => {
    const handlers = cardHandlersById.get(comp.id)
    if (!handlers) return null
    const Card = viewMode === 'grid' ? GridCompositionCard : ListCompositionCard

    return (
      <Card
        key={comp.id}
        composition={comp}
        selected={selectedCompositionIdSet.has(comp.id)}
        isTranscriptionDialogOpen={isTranscriptionDialogOpen}
        dragDisabled={wouldCreateCompositionCycle({
          parentCompositionId: activeCompositionId,
          insertedCompositionId: comp.id,
          compositionById,
        })}
        isEditing={editingId === comp.id}
        editValue={editValue}
        onEditValueChange={setEditValue}
        onSelect={handlers.onSelect}
        onEnter={handlers.onEnter}
        onOpenAsTab={handlers.onOpenAsTab}
        canOpenAsTab={comp.editorKind !== 'composite-2d'}
        onDelete={handlers.onDelete}
        onStartRename={handlers.onStartRename}
        onCommitRename={handleCommitRename}
        onCancelRename={handleCancelRename}
      />
    )
  }

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
          <ChevronRight
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <Layers className="w-3 h-3 text-violet-400" />
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {t('media.compositions.sectionTitle')}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {compositions.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1 pb-2 space-y-2">
          {sequences.length > 0 && (
            <div>
              {showGroupHeaders && (
                <CompositionGroupHeader
                  label={t('media.compositions.sequencesGroup')}
                  count={sequences.length}
                />
              )}
              <div className={groupContainerClassName} style={groupContainerStyle}>
                {sequences.map(renderCard)}
              </div>
            </div>
          )}
          {compositeCompositions.length > 0 && (
            <div>
              {showGroupHeaders && (
                <CompositionGroupHeader
                  label={t('media.compositions.compositionsGroup', {
                    defaultValue: 'Compositions',
                  })}
                  count={compositeCompositions.length}
                />
              )}
              <div className={groupContainerClassName} style={groupContainerStyle}>
                {compositeCompositions.map(renderCard)}
              </div>
            </div>
          )}
          {compoundClips.length > 0 && (
            <div>
              {showGroupHeaders && (
                <CompositionGroupHeader
                  label={t('media.compositions.compoundClipsGroup')}
                  count={compoundClips.length}
                />
              )}
              <div className={groupContainerClassName} style={groupContainerStyle}>
                {compoundClips.map(renderCard)}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                isSequenceTarget
                  ? 'media.compositions.deleteSequenceTitle'
                  : 'media.compositions.deleteTitle',
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {t(
                    isSequenceTarget
                      ? 'media.compositions.deleteSequenceBody'
                      : 'media.compositions.deleteBody',
                    { name: deleteTarget?.name ?? '' },
                  )}
                </p>
                {deleteImpact.totalReferenceCount > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <Trash2 className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">{t('media.compositions.deleteInstancesTitle')}</p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {t(
                          isSequenceTarget
                            ? 'media.compositions.deleteSequenceInstancesDetail'
                            : 'media.compositions.deleteInstancesDetail',
                          {
                            count: deleteImpact.totalReferenceCount,
                          },
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CompositionGroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-1 pb-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground/50">{count}</span>
    </div>
  )
}

interface CompositionCardProps {
  composition: SubComposition
  selected: boolean
  isTranscriptionDialogOpen: boolean
  dragDisabled: boolean
  isEditing: boolean
  editValue: string
  onEditValueChange: (value: string) => void
  onSelect: (event: React.MouseEvent) => void
  onEnter: () => void
  onOpenAsTab: () => void
  canOpenAsTab: boolean
  onDelete: () => void
  onStartRename: () => void
  onCommitRename: (id: string) => void
  onCancelRename: () => void
}

interface CompositionCardInternalProps extends CompositionCardProps {
  layout: 'grid' | 'list'
}

const GridCompositionCard = memo(function GridCompositionCard(props: CompositionCardProps) {
  return <CompositionCardInternal {...props} layout="grid" />
})

const ListCompositionCard = memo(function ListCompositionCard(props: CompositionCardProps) {
  return <CompositionCardInternal {...props} layout="list" />
})

const CompositionCardInternal = memo(function CompositionCardInternal({
  composition,
  layout,
  selected,
  isTranscriptionDialogOpen,
  dragDisabled,
  isEditing,
  editValue,
  onEditValueChange,
  onSelect,
  onEnter,
  onOpenAsTab,
  canOpenAsTab,
  onDelete,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: CompositionCardInternalProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [skimProgress, setSkimProgress] = useState<number | null>(null)
  const skimRafRef = useRef<number | null>(null)
  const pendingSkimClientXRef = useRef<number | null>(null)
  const thisComposition = useCompositionsStore(
    useCallback((s) => s.compositionById[composition.id], [composition.id]),
  )
  const setCompoundClipSkimPreview = useEditorStore((s) => s.setCompoundClipSkimPreview)
  const clearCompoundClipSkimPreview = useEditorStore((s) => s.clearCompoundClipSkimPreview)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    let mounted = true

    const loadThumbnail = async () => {
      const url = await compoundClipThumbnailService.getThumbnailBlobUrl(composition.id)
      if (mounted) {
        setThumbnailUrl(url)
      }
    }

    void loadThumbnail()

    return () => {
      mounted = false
      if (useEditorStore.getState().compoundClipSkimPreviewCompositionId === composition.id) {
        clearCompoundClipSkimPreview()
      }
    }
  }, [clearCompoundClipSkimPreview, composition.id, thisComposition])

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (dragDisabled) {
        e.preventDefault()
        return
      }
      const data = {
        type: 'composition' as const,
        compositionId: composition.id,
        name: composition.name,
        durationInFrames: composition.durationInFrames,
        width: composition.width,
        height: composition.height,
      }
      e.dataTransfer.setData('application/json', JSON.stringify(data))
      e.dataTransfer.effectAllowed = 'copy'
      setMediaDragData(data)
    },
    [composition, dragDisabled],
  )

  const handleDragEnd = useCallback(() => {
    clearMediaDragData()
  }, [])

  const handleDoubleClick = useCallback(() => {
    onEnter()
  }, [onEnter])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onCommitRename(composition.id)
      } else if (e.key === 'Escape') {
        onCancelRename()
      }
    },
    [composition.id, onCommitRename, onCancelRename],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return
      onSelect(e)
    },
    [isEditing, onSelect],
  )

  const canHoverPreview = composition.durationInFrames > 0 && !isTranscriptionDialogOpen

  const updateSkimPreview = useCallback(
    (clientX: number) => {
      const thumbnailContainer = thumbnailContainerRef.current
      if (!thumbnailContainer || !canHoverPreview) return

      const rect = thumbnailContainer.getBoundingClientRect()
      if (rect.width <= 0) return

      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const frame = Math.min(
        composition.durationInFrames - 1,
        Math.max(0, Math.round(progress * Math.max(0, composition.durationInFrames - 1))),
      )

      setSkimProgress(progress)
      setCompoundClipSkimPreview(composition.id, frame)
    },
    [canHoverPreview, composition.durationInFrames, composition.id, setCompoundClipSkimPreview],
  )

  const handleThumbnailPointerEnter = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canHoverPreview || event.pointerType === 'touch') return
      updateSkimPreview(event.clientX)
    },
    [canHoverPreview, updateSkimPreview],
  )

  const flushScheduledSkimPreview = useCallback(() => {
    skimRafRef.current = null
    const clientX = pendingSkimClientXRef.current
    pendingSkimClientXRef.current = null
    if (clientX === null) return
    updateSkimPreview(clientX)
  }, [updateSkimPreview])

  const scheduleSkimPreview = useCallback(
    (clientX: number) => {
      pendingSkimClientXRef.current = clientX
      if (skimRafRef.current !== null) return
      skimRafRef.current = requestAnimationFrame(flushScheduledSkimPreview)
    },
    [flushScheduledSkimPreview],
  )

  const cancelScheduledSkimPreview = useCallback(() => {
    pendingSkimClientXRef.current = null
    if (skimRafRef.current !== null) {
      cancelAnimationFrame(skimRafRef.current)
      skimRafRef.current = null
    }
  }, [])

  const handleThumbnailPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canHoverPreview || event.pointerType === 'touch') return
      scheduleSkimPreview(event.clientX)
    },
    [canHoverPreview, scheduleSkimPreview],
  )

  const handleThumbnailPointerLeave = useCallback(() => {
    if (!canHoverPreview) return
    cancelScheduledSkimPreview()
    setSkimProgress(null)
    clearCompoundClipSkimPreview()
  }, [canHoverPreview, cancelScheduledSkimPreview, clearCompoundClipSkimPreview])

  useEffect(
    () => () => {
      cancelScheduledSkimPreview()
    },
    [cancelScheduledSkimPreview],
  )

  const itemCount = composition.items.length
  const fps = composition.fps || 30
  const durationSecs = composition.durationInFrames / fps
  const durationLabel =
    durationSecs < 60
      ? `${durationSecs.toFixed(1)}s`
      : `${Math.floor(durationSecs / 60)}:${String(Math.floor(durationSecs % 60)).padStart(2, '0')}`

  if (layout === 'grid') {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-composition-id={composition.id}
            draggable={!dragDisabled && !isEditing}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            style={CARD_PERF_STYLE}
            className={cn(
              CARD_GRID_BASE,
              dragDisabled
                ? 'opacity-50 cursor-not-allowed border-border'
                : cn(
                    'cursor-grab',
                    selected
                      ? 'border-violet-500 ring-2 ring-violet-500/20 shadow-lg shadow-violet-500/10'
                      : 'border-border hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10',
                  ),
            )}
          >
            <div
              ref={thumbnailContainerRef}
              className="flex-1 bg-secondary relative overflow-hidden min-h-0 flex items-center justify-center bg-gradient-to-br from-violet-600/20 to-violet-900/30"
              onPointerEnter={handleThumbnailPointerEnter}
              onPointerMove={handleThumbnailPointerMove}
              onPointerLeave={handleThumbnailPointerLeave}
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={composition.name}
                  className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <Layers className="w-8 h-8 text-violet-400/70" />
              )}

              <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between gap-1 pointer-events-none">
                <div className="p-0.5 rounded bg-violet-600/90 text-white">
                  <Layers className="w-2.5 h-2.5" />
                </div>
                <div className="px-1 py-0.5 bg-black/70 border border-white/20 rounded text-[8px] font-mono text-white">
                  {durationLabel}
                </div>
              </div>
              {skimProgress !== null && (
                <div
                  className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
                  style={getSkimIndicatorStyle(skimProgress)}
                />
              )}
            </div>

            <div className="px-1.5 py-1 bg-panel-bg/50 flex-shrink-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => onEditValueChange(e.target.value)}
                      onBlur={() => onCommitRename(composition.id)}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-transparent border border-primary rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                    />
                  ) : (
                    <h3 className="text-[10px] font-medium text-foreground truncate group-hover:text-violet-400 transition-colors">
                      {composition.name}
                    </h3>
                  )}
                </div>
              </div>
            </div>

            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
            <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={onEnter}>{t('media.compositions.enter')}</ContextMenuItem>
          {canOpenAsTab ? (
            <ContextMenuItem onClick={onOpenAsTab}>
              {t('media.compositions.openAsTab')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onClick={onStartRename}>
            {t('media.compositions.rename')}
          </ContextMenuItem>
          <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            {t('common.delete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-composition-id={composition.id}
          draggable={!dragDisabled && !isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          style={CARD_PERF_STYLE}
          className={cn(
            CARD_LIST_BASE,
            dragDisabled
              ? 'opacity-50 cursor-not-allowed border-border'
              : cn(
                  'cursor-grab',
                  selected
                    ? 'border-violet-500 ring-1 ring-violet-500/20'
                    : 'border-border hover:border-violet-500/50',
                ),
          )}
        >
          <div
            ref={thumbnailContainerRef}
            className="w-16 h-12 bg-secondary rounded overflow-hidden flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-violet-600/20 to-violet-900/30 relative"
            onPointerEnter={handleThumbnailPointerEnter}
            onPointerMove={handleThumbnailPointerMove}
            onPointerLeave={handleThumbnailPointerLeave}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={composition.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <Layers className="w-5 h-5 text-violet-400" />
            )}
            {skimProgress !== null && (
              <div
                className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
                style={getSkimIndicatorStyle(skimProgress)}
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() => onCommitRename(composition.id)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent border border-primary rounded px-1 py-0.5 text-xs text-foreground outline-none"
              />
            ) : (
              <h3 className="text-xs font-medium text-foreground truncate">{composition.name}</h3>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <div className="p-0.5 rounded bg-violet-600/90 text-white flex-shrink-0">
                <Layers className="w-2.5 h-2.5" />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {durationLabel} &middot; {t('media.compositions.itemCount', { count: itemCount })}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={onEnter}>{t('media.compositions.enter')}</ContextMenuItem>
        {canOpenAsTab ? (
          <ContextMenuItem onClick={onOpenAsTab}>
            {t('media.compositions.openAsTab')}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onClick={onStartRename}>{t('media.compositions.rename')}</ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          {t('common.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
