import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { useLinkedEditPreviewStore } from '../../stores/linked-edit-preview-store'
import { useRippleEditPreviewStore } from '../../stores/ripple-edit-preview-store'
import { useRollingEditPreviewStore } from '../../stores/rolling-edit-preview-store'
import { useSlideEditPreviewStore } from '../../stores/slide-edit-preview-store'
import { useSlipEditPreviewStore } from '../../stores/slip-edit-preview-store'
import { useTrackPushPreviewStore } from '../../stores/track-push-preview-store'
import { getLinkedItemIds } from '../../utils/linked-items'
import type { PreviewItemUpdate } from '../../utils/item-edit-preview'

interface UseEditPreviewShiftsParams {
  item: TimelineItemType
  linkedItemsForSync: TimelineItemType[]
  isDragging: boolean
  isPartOfDrag: boolean
  gestureMode: string
}

interface SlidePreview {
  activeItemId: string | null
  primaryLeftNeighborId: string | null
  primaryRightNeighborId: string | null
  slideDelta: number
  minDelta: number
  maxDelta: number
  isPrimary: boolean
  isLeftNeighbor: boolean
  isRightNeighbor: boolean
}

export interface EditPreviewShifts {
  linkedEditPreviewUpdate: PreviewItemUpdate | null
  isHiddenByLinkedEditPreview: boolean
  moveDragPreviewFromDelta: number
  previewBaseItem: TimelineItemType
  linkedSyncPreviewUpdatesById: Record<string, PreviewItemUpdate>

  rollingEditDelta: number
  rollingEditHandle: 'start' | 'end' | null
  rollingEditConstrained: boolean

  rippleEditOffset: number
  rippleEdgeDelta: number

  trackPushOffset: number

  slipEditDelta: number
  isLinkedSlipCompanion: boolean

  slidePreview: SlidePreview
  slideEditOffset: number
  slideNeighborDelta: number
  slideNeighborSide: 'left' | 'right' | null
  isLinkedSlideCompanion: boolean
  slideRange: { minDelta: number; maxDelta: number } | null
  slideLeftNeighborIdForSlidItem: string | null
  slideRightNeighborIdForSlidItem: string | null
  slideLeftNeighborForSlidItem: TimelineItemType | null
  slideRightNeighborForSlidItem: TimelineItemType | null
}

export function useEditPreviewShifts({
  item,
  linkedItemsForSync,
  isDragging,
  isPartOfDrag,
  gestureMode,
}: UseEditPreviewShiftsParams): EditPreviewShifts {
  const linkedEditPreviewUpdate = useLinkedEditPreviewStore(
    useCallback((s) => s.updatesById[item.id] ?? null, [item.id]),
  )
  const isHiddenByLinkedEditPreview = linkedEditPreviewUpdate?.hidden === true

  const moveDragPreviewFromDelta = useMemo(() => {
    if (!linkedEditPreviewUpdate || !(isDragging || isPartOfDrag) || gestureMode !== 'none') {
      return 0
    }
    return (linkedEditPreviewUpdate.from ?? item.from) - item.from
  }, [gestureMode, isDragging, isPartOfDrag, item.from, linkedEditPreviewUpdate])

  const previewBaseItem = useMemo<TimelineItemType>(
    () =>
      linkedEditPreviewUpdate && moveDragPreviewFromDelta === 0
        ? ({ ...item, ...linkedEditPreviewUpdate } as TimelineItemType)
        : item,
    [item, linkedEditPreviewUpdate, moveDragPreviewFromDelta],
  )

  const linkedSyncPreviewUpdatesById = useLinkedEditPreviewStore(
    useShallow(
      useCallback(
        (s) => {
          const updatesById: Record<string, PreviewItemUpdate> = {}
          for (const linkedItem of linkedItemsForSync) {
            const linkedPreviewUpdate = s.updatesById[linkedItem.id]
            if (linkedPreviewUpdate) {
              updatesById[linkedItem.id] = linkedPreviewUpdate
            }
          }
          return updatesById
        },
        [linkedItemsForSync],
      ),
    ),
  )

  const rollingEditPreview = useRollingEditPreviewStore(
    useShallow(
      useCallback(
        (s) => {
          const isNeighbor = s.neighborItemId === item.id
          return {
            delta: isNeighbor ? s.neighborDelta : 0,
            handle: isNeighbor ? s.handle : null,
            constrained: isNeighbor && s.constrained,
          }
        },
        [item.id],
      ),
    ),
  )

  const rippleEditOffset = useRippleEditPreviewStore(
    useCallback(
      (s) => {
        if (!s.trimmedItemId) return 0
        if (s.downstreamItemIds.has(item.id)) return s.delta
        return 0
      },
      [item.id],
    ),
  )

  const rippleEdgeDelta = useRippleEditPreviewStore(
    useCallback(
      (s) => {
        if (s.trimmedItemId !== item.id) return 0
        return s.delta
      },
      [item.id],
    ),
  )

  const trackPushOffset = useTrackPushPreviewStore(
    useCallback(
      (s) => {
        if (!s.anchorItemId) return 0
        if (s.shiftedItemIds.has(item.id)) return s.delta
        return 0
      },
      [item.id],
    ),
  )

  const slipEditDelta = useSlipEditPreviewStore(
    useCallback(
      (s) => {
        if (s.itemId !== item.id) return 0
        return s.slipDelta
      },
      [item.id],
    ),
  )

  const isLinkedSlipCompanion =
    useSlipEditPreviewStore(
      useCallback((s) => s.itemId !== null && s.itemId !== item.id, [item.id]),
    ) &&
    linkedEditPreviewUpdate !== null &&
    linkedEditPreviewUpdate.sourceStart !== undefined

  const slidePreview = useSlideEditPreviewStore(
    useShallow(
      useCallback(
        (s): SlidePreview => {
          const isPrimary = s.itemId === item.id
          const isLeftNeighbor = s.leftNeighborId === item.id
          const isRightNeighbor = s.rightNeighborId === item.id
          const isRelated = isPrimary || isLeftNeighbor || isRightNeighbor
          return {
            activeItemId: s.itemId,
            primaryLeftNeighborId: isPrimary ? s.leftNeighborId : null,
            primaryRightNeighborId: isPrimary ? s.rightNeighborId : null,
            slideDelta: isRelated ? s.slideDelta : 0,
            minDelta: s.minDelta,
            maxDelta: s.maxDelta,
            isPrimary,
            isLeftNeighbor,
            isRightNeighbor,
          }
        },
        [item.id],
      ),
    ),
  )

  const slideEditOffset = slidePreview.isPrimary ? slidePreview.slideDelta : 0
  const slideNeighborDelta =
    slidePreview.isLeftNeighbor || slidePreview.isRightNeighbor ? slidePreview.slideDelta : 0
  const slideNeighborSide: 'left' | 'right' | null = slidePreview.isLeftNeighbor
    ? 'left'
    : slidePreview.isRightNeighbor
      ? 'right'
      : null

  const isLinkedSlideCompanion = useMemo(() => {
    if (!slidePreview.activeItemId || slidePreview.isPrimary) return false
    if (slidePreview.isLeftNeighbor || slidePreview.isRightNeighbor) return false
    const items = useItemsStore.getState().items
    const linkedIds = getLinkedItemIds(items, slidePreview.activeItemId)
    return linkedIds.includes(item.id)
  }, [
    item.id,
    slidePreview.activeItemId,
    slidePreview.isPrimary,
    slidePreview.isLeftNeighbor,
    slidePreview.isRightNeighbor,
  ])

  const slideRange = useMemo(
    () =>
      slidePreview.activeItemId !== null
        ? { minDelta: slidePreview.minDelta, maxDelta: slidePreview.maxDelta }
        : null,
    [slidePreview.activeItemId, slidePreview.minDelta, slidePreview.maxDelta],
  )

  const slideLeftNeighborIdForSlidItem = slidePreview.primaryLeftNeighborId
  const slideRightNeighborIdForSlidItem = slidePreview.primaryRightNeighborId

  const slideLeftNeighborForSlidItem = useItemsStore(
    useCallback(
      (s) => {
        if (!slideLeftNeighborIdForSlidItem) return null
        return s.itemById[slideLeftNeighborIdForSlidItem] ?? null
      },
      [slideLeftNeighborIdForSlidItem],
    ),
  )

  const slideRightNeighborForSlidItem = useItemsStore(
    useCallback(
      (s) => {
        if (!slideRightNeighborIdForSlidItem) return null
        return s.itemById[slideRightNeighborIdForSlidItem] ?? null
      },
      [slideRightNeighborIdForSlidItem],
    ),
  )

  return {
    linkedEditPreviewUpdate,
    isHiddenByLinkedEditPreview,
    moveDragPreviewFromDelta,
    previewBaseItem,
    linkedSyncPreviewUpdatesById,
    rollingEditDelta: rollingEditPreview.delta,
    rollingEditHandle: rollingEditPreview.handle,
    rollingEditConstrained: rollingEditPreview.constrained,
    rippleEditOffset,
    rippleEdgeDelta,
    trackPushOffset,
    slipEditDelta,
    isLinkedSlipCompanion,
    slidePreview,
    slideEditOffset,
    slideNeighborDelta,
    slideNeighborSide,
    isLinkedSlideCompanion,
    slideRange,
    slideLeftNeighborIdForSlidItem,
    slideRightNeighborIdForSlidItem,
    slideLeftNeighborForSlidItem,
    slideRightNeighborForSlidItem,
  }
}
