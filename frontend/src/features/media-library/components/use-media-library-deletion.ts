import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/shared/logging/logger'
import {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  removeProjectItems,
  saveTimeline,
  useSequencesStore,
} from '@/features/media-library/deps/timeline-stores'

const logger = createLogger('MediaLibrary')

interface PendingLibraryDeletion {
  mediaIds: string[]
  compositionIds: string[]
}

interface UseMediaLibraryDeletionParams {
  containerRef: React.RefObject<HTMLDivElement | null>
  selectedMediaIds: string[]
  selectedCompositionIds: string[]
  selectedAssetCount: number
  currentProjectId: string | null
  clearSelection: () => void
  deleteMediaBatch: (mediaIds: string[]) => Promise<void>
}

/**
 * Deletion flow for the media library: pending-deletion + dialog state, the
 * Delete-hotkey and focus-scope tracking, the timeline-impact computations
 * (how many timeline clips reference the assets), and the confirm/cancel
 * handlers that remove timeline references, media, and compound clips.
 * Extracted verbatim from `MediaLibrary`.
 */
export function useMediaLibraryDeletion({
  containerRef,
  selectedMediaIds,
  selectedCompositionIds,
  selectedAssetCount,
  currentProjectId,
  clearSelection,
  deleteMediaBatch,
}: UseMediaLibraryDeletionParams) {
  const { t, i18n } = useTranslation()
  const isFocusedRef = useRef(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<PendingLibraryDeletion>({
    mediaIds: [],
    compositionIds: [],
  })

  const deleteAssetCount = pendingDeletion.mediaIds.length + pendingDeletion.compositionIds.length
  const isMediaOnlyDeletion =
    pendingDeletion.mediaIds.length > 0 && pendingDeletion.compositionIds.length === 0

  // Track focus scope for the Delete hotkey. Selection itself is only cleared
  // by explicit user action (empty-area click or marquee), never by focus
  // changes — otherwise selection leaks away when the user clicks the timeline
  // or another panel.
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      isFocusedRef.current = !!containerRef.current?.contains(event.target as Node)
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [containerRef, isFocusedRef])

  // Handle Delete key to delete selected items
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete key
      if (event.key !== 'Delete') return

      // Don't trigger if media library is not focused
      if (!isFocusedRef.current) return

      // Don't trigger if no items selected
      if (selectedAssetCount === 0) return

      // Don't trigger if dialog is already open
      if (showDeleteDialog) return

      // Don't trigger if user is typing in an input or textarea
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Prevent default behavior and trigger delete
      event.preventDefault()
      setPendingDeletion({
        mediaIds: [...selectedMediaIds],
        compositionIds: [...selectedCompositionIds],
      })
      setShowDeleteDialog(true)
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFocusedRef, selectedAssetCount, selectedCompositionIds, selectedMediaIds, showDeleteDialog])

  const deleteSummary = useMemo(() => {
    const parts: string[] = []
    if (pendingDeletion.mediaIds.length > 0) {
      parts.push(t('media.library.mediaItemsCount', { count: pendingDeletion.mediaIds.length }))
    }
    if (pendingDeletion.compositionIds.length > 0) {
      // Sequences and compound clips are the same primitive; only the label
      // differs. Split so the dialog says "sequence" for top-level tabs.
      const isTopLevelSequence = useSequencesStore.getState().isTopLevelSequence
      let sequenceCount = 0
      let compoundClipCount = 0
      for (const id of pendingDeletion.compositionIds) {
        if (isTopLevelSequence(id)) sequenceCount++
        else compoundClipCount++
      }
      if (sequenceCount > 0) {
        parts.push(t('media.library.sequencesCount', { count: sequenceCount }))
      }
      if (compoundClipCount > 0) {
        parts.push(t('media.library.compoundClipsCount', { count: compoundClipCount }))
      }
    }
    // Locale-aware conjunction ("A, B, and C") rather than repeating a joiner,
    // which reads awkwardly for three-or-more parts.
    return new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(parts)
  }, [pendingDeletion.compositionIds, pendingDeletion.mediaIds.length, i18n.language, t])

  const affectedMediaImpact = useMemo(
    () =>
      pendingDeletion.mediaIds.length > 0
        ? getMediaDeletionImpact(pendingDeletion.mediaIds)
        : { itemIds: [], rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 },
    [pendingDeletion.mediaIds],
  )
  const compoundClipDeleteImpact = useMemo(
    () =>
      pendingDeletion.compositionIds.length > 0
        ? getCompoundClipDeletionImpact(pendingDeletion.compositionIds)
        : { rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 },
    [pendingDeletion.compositionIds],
  )
  const affectedAssetInstanceCount =
    affectedMediaImpact.totalReferenceCount + compoundClipDeleteImpact.totalReferenceCount

  const handleDeleteSelected = () => {
    if (selectedAssetCount === 0) return
    // Capture the IDs BEFORE opening dialog (selection may be cleared by click outside)
    setPendingDeletion({
      mediaIds: [...selectedMediaIds],
      compositionIds: [...selectedCompositionIds],
    })
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    setShowDeleteDialog(false)
    try {
      // First remove timeline items that reference selected library assets
      if (affectedMediaImpact.itemIds.length > 0) {
        const removedTimelineReferences = removeProjectItems(affectedMediaImpact.itemIds)
        if (removedTimelineReferences && currentProjectId) {
          await saveTimeline(currentProjectId)
        }
      }

      if (pendingDeletion.mediaIds.length > 0) {
        await deleteMediaBatch(pendingDeletion.mediaIds)
      }

      if (pendingDeletion.compositionIds.length > 0) {
        deleteCompoundClips(pendingDeletion.compositionIds)
      }

      clearSelection()
      setPendingDeletion({ mediaIds: [], compositionIds: [] })
    } catch (error) {
      logger.error('Delete failed:', error)
      setPendingDeletion({ mediaIds: [], compositionIds: [] })
    }
  }

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    pendingDeletion,
    setPendingDeletion,
    deleteAssetCount,
    isMediaOnlyDeletion,
    deleteSummary,
    affectedAssetInstanceCount,
    handleDeleteSelected,
    handleConfirmDelete,
  }
}
