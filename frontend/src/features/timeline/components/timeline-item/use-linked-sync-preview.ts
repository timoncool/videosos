import { useMemo } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { getLinkedSyncOffsetFrames } from '../../utils/linked-items'
import { supportsVisualFadeControls } from './visual-fade-items'
import { shouldSuppressLinkedSyncBadge } from './linked-sync-badge'
import type { VideoFadeEditState } from './use-fade-editors'

export interface LinkedSyncPreviewInput {
  contentPreviewItem: TimelineItemType
  videoFadeEdit: VideoFadeEditState | null
  linkedItemsForSync: TimelineItemType[]
  fps: number
  linkedSelectionEnabled: boolean
  linkedEditPreviewActive: boolean
  isDragging: boolean
  isPartOfDrag: boolean
  isTrimming: boolean
  isStretching: boolean
  isSlipSlideActive: boolean
  trimHandle: 'start' | 'end' | null
  trimDelta: number
  rollingEditDelta: number
  rollingEditHandle: 'start' | 'end' | null
  rippleEditOffset: number
  rippleEdgeDelta: number
  slipEditDelta: number
  slideEditOffset: number
  slideFromOffset: number
  slideNeighborSide: 'left' | 'right' | null
  slideNeighborDelta: number
  moveDragPreviewFromDelta: number
  linkedSyncPreviewUpdatesById: Parameters<typeof getLinkedSyncOffsetFrames>[3]
}

export interface LinkedSyncPreview {
  /** The clip item to render, with any live video-fade preview applied. */
  contentVisualPreviewItem: TimelineItemType
  /** Frames the clip is out of sync with its linked siblings, or null when the badge is suppressed. */
  linkedSyncOffsetFrames: number | null
}

/**
 * Derives the visual preview item for a clip (folding in a live video-fade edit)
 * and the linked-sync offset used to render the out-of-sync badge.
 *
 * The badge is suppressed during gestures that move linked siblings together, so
 * a transient mid-gesture offset doesn't flash. See `shouldSuppressLinkedSyncBadge`.
 */
export function useLinkedSyncPreview({
  contentPreviewItem,
  videoFadeEdit,
  linkedItemsForSync,
  fps,
  linkedSelectionEnabled,
  linkedEditPreviewActive,
  isDragging,
  isPartOfDrag,
  isTrimming,
  isStretching,
  isSlipSlideActive,
  trimHandle,
  trimDelta,
  rollingEditDelta,
  rollingEditHandle,
  rippleEditOffset,
  rippleEdgeDelta,
  slipEditDelta,
  slideEditOffset,
  slideFromOffset,
  slideNeighborSide,
  slideNeighborDelta,
  moveDragPreviewFromDelta,
  linkedSyncPreviewUpdatesById,
}: LinkedSyncPreviewInput): LinkedSyncPreview {
  const contentVisualPreviewItem = useMemo<TimelineItemType>(() => {
    if (supportsVisualFadeControls(contentPreviewItem) && videoFadeEdit !== null) {
      return {
        ...contentPreviewItem,
        fadeIn: videoFadeEdit.previewFadeIn,
        fadeOut: videoFadeEdit.previewFadeOut,
      }
    }

    if (contentPreviewItem.type !== 'audio') {
      return contentPreviewItem
    }

    return contentPreviewItem
  }, [contentPreviewItem, videoFadeEdit])

  const linkedSyncPreviewItem = useMemo<TimelineItemType>(() => {
    let fromOffset = slideFromOffset + rippleEditOffset + moveDragPreviewFromDelta

    if (isTrimming && trimHandle === 'start') {
      fromOffset += trimDelta
    }

    if (rollingEditDelta !== 0 && rollingEditHandle === 'end') {
      fromOffset += rollingEditDelta
    }

    if (slideNeighborSide === 'right' && slideNeighborDelta !== 0) {
      fromOffset += slideNeighborDelta
    }

    if (fromOffset === 0) {
      return contentVisualPreviewItem
    }

    return {
      ...contentVisualPreviewItem,
      from: contentVisualPreviewItem.from + fromOffset,
    }
  }, [
    contentVisualPreviewItem,
    isTrimming,
    trimHandle,
    trimDelta,
    rollingEditDelta,
    rollingEditHandle,
    slideNeighborSide,
    slideNeighborDelta,
    slideFromOffset,
    rippleEditOffset,
    moveDragPreviewFromDelta,
  ])

  const suppressLinkedSyncBadge = shouldSuppressLinkedSyncBadge({
    linkedSelectionEnabled,
    linkedEditPreviewActive,
    isDragging,
    isPartOfDrag,
    isTrimming,
    isStretching,
    isSlipSlideActive,
    rollingEditDelta,
    rippleEditOffset,
    rippleEdgeDelta,
    slipEditDelta,
    slideEditOffset,
    slideNeighborDelta,
  })

  const linkedSyncOffsetFrames = useMemo(
    () =>
      !suppressLinkedSyncBadge && linkedItemsForSync.length > 0
        ? getLinkedSyncOffsetFrames(
            [linkedSyncPreviewItem, ...linkedItemsForSync],
            linkedSyncPreviewItem.id,
            fps,
            linkedSyncPreviewUpdatesById,
          )
        : null,
    [
      linkedItemsForSync,
      linkedSyncPreviewItem,
      fps,
      linkedSyncPreviewUpdatesById,
      suppressLinkedSyncBadge,
    ],
  )

  return { contentVisualPreviewItem, linkedSyncOffsetFrames }
}
