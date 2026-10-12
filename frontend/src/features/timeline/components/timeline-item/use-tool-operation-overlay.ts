import { useMemo } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useEditorStore } from '@/shared/state/editor'
import { frameToPixelsNow } from '../../utils/zoom-conversions'
import { getSynchronizedLinkedItems } from '../../utils/linked-items'
import { findNearestNeighbors } from '../../utils/transition-linked-neighbors'
import {
  getSlideOperationBoundsVisual,
  getSlipOperationBoundsVisual,
  getStretchOperationBoundsVisual,
  getTrimOperationBoundsVisual,
  type OperationBoundsVisual,
} from './tool-operation-overlay-utils'

export interface ToolOperationOverlayInput {
  item: TimelineItemType
  fps: number
  visualLeft: number
  visualWidth: number
  isTrimming: boolean
  trimHandle: 'start' | 'end' | null
  trimConstrained: boolean
  isRollingEdit: boolean
  isRippleEdit: boolean
  isStretching: boolean
  stretchHandle: 'start' | 'end' | null
  stretchConstrained: boolean
  isSlipSlideActive: boolean
  slipSlideMode: 'slip' | 'slide' | null
  slipSlideConstraintEdge: 'start' | 'end' | null
  slipSlideConstrained: boolean
  slideLeftNeighborForSlidItem: TimelineItemType | null
  slideRightNeighborForSlidItem: TimelineItemType | null
  slideRange: { minDelta: number; maxDelta: number } | null
  isLinkedSlideCompanion: boolean
  isLinkedSlipCompanion: boolean
  contentPreviewItem: TimelineItemType
  previewBaseItem: TimelineItemType
}

/**
 * Computes the bounds-box overlay shown while a trim / stretch / slip / slide
 * gesture is active (including linked companion clips). Returns `null` when no
 * such gesture is in progress or the clip has no visible width.
 *
 * Branch order is significant: primary gestures (trim → stretch → slide → slip)
 * are resolved before the linked-companion fallbacks. Keep behaviour-preserving.
 */
export function useToolOperationOverlay({
  item,
  fps,
  visualLeft,
  visualWidth,
  isTrimming,
  trimHandle,
  trimConstrained,
  isRollingEdit,
  isRippleEdit,
  isStretching,
  stretchHandle,
  stretchConstrained,
  isSlipSlideActive,
  slipSlideMode,
  slipSlideConstraintEdge,
  slipSlideConstrained,
  slideLeftNeighborForSlidItem,
  slideRightNeighborForSlidItem,
  slideRange,
  isLinkedSlideCompanion,
  isLinkedSlipCompanion,
  contentPreviewItem,
  previewBaseItem,
}: ToolOperationOverlayInput): OperationBoundsVisual | null {
  return useMemo(() => {
    if (visualWidth <= 0) return null

    const currentLeftPx = visualLeft
    const currentRightPx = visualLeft + visualWidth

    if (isTrimming && trimHandle) {
      const { items } = useItemsStore.getState()
      const { transitions } = useTransitionsStore.getState()

      return getTrimOperationBoundsVisual({
        item,
        items,
        transitions,
        fps,
        frameToPixels: frameToPixelsNow,
        handle: trimHandle,
        isRollingEdit,
        isRippleEdit,
        constrained: trimConstrained,
        currentLeftPx,
        currentRightPx,
      })
    }

    if (isStretching && stretchHandle) {
      return getStretchOperationBoundsVisual({
        item,
        fps,
        frameToPixels: frameToPixelsNow,
        handle: stretchHandle,
        constrained: stretchConstrained,
        currentLeftPx,
        currentRightPx,
      })
    }

    if (isSlipSlideActive && slipSlideMode === 'slide') {
      const { items } = useItemsStore.getState()
      const { transitions } = useTransitionsStore.getState()

      // Compute wall positions across all participants (primary + companions).
      // Each participant's own adjacent neighbors are excluded (they get trimmed).
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled
      const participants = linkedSelectionEnabled
        ? getSynchronizedLinkedItems(items, item.id)
        : [item]

      let leftWallFrame: number | null = null
      let rightWallFrame: number | null = null
      for (const participant of participants) {
        const pEnd = participant.from + participant.durationInFrames
        const excludeIds = new Set<string>(participants.map((p) => p.id))
        if (slideLeftNeighborForSlidItem) excludeIds.add(slideLeftNeighborForSlidItem.id)
        if (slideRightNeighborForSlidItem) excludeIds.add(slideRightNeighborForSlidItem.id)
        for (const other of items) {
          if (other.trackId !== participant.trackId || other.id === participant.id) continue
          const otherEnd = other.from + other.durationInFrames
          if (otherEnd === participant.from || other.from === pEnd) excludeIds.add(other.id)
        }

        const nearest = findNearestNeighbors(participant, items)
        if (nearest.leftNeighbor && !excludeIds.has(nearest.leftNeighbor.id)) {
          const wall = nearest.leftNeighbor.from + nearest.leftNeighbor.durationInFrames
          const maxLeft = -(participant.from - wall)
          const primaryWall = item.from + maxLeft
          if (leftWallFrame === null || primaryWall > leftWallFrame) leftWallFrame = primaryWall
        }
        if (nearest.rightNeighbor && !excludeIds.has(nearest.rightNeighbor.id)) {
          const wall = nearest.rightNeighbor.from
          const maxRight = wall - pEnd
          const primaryWall = item.from + item.durationInFrames + maxRight
          if (rightWallFrame === null || primaryWall < rightWallFrame) rightWallFrame = primaryWall
        }
      }

      return getSlideOperationBoundsVisual({
        item,
        items,
        transitions,
        fps,
        frameToPixels: frameToPixelsNow,
        leftNeighbor: slideLeftNeighborForSlidItem,
        rightNeighbor: slideRightNeighborForSlidItem,
        constraintEdge: slipSlideConstraintEdge,
        constrained: slipSlideConstrained,
        currentLeftPx,
        currentRightPx,
        leftWallFrame,
        rightWallFrame,
        effectiveMinDelta: slideRange?.minDelta,
        effectiveMaxDelta: slideRange?.maxDelta,
      })
    }

    if (isSlipSlideActive && slipSlideMode === 'slip') {
      return getSlipOperationBoundsVisual({
        item: contentPreviewItem,
        fps,
        frameToPixels: frameToPixelsNow,
        constraintEdge: slipSlideConstraintEdge,
        constrained: slipSlideConstrained,
        currentLeftPx,
        currentRightPx,
      })
    }

    // Linked slide companion: use the same effective range as the primary
    if (isLinkedSlideCompanion && slideRange) {
      return getSlideOperationBoundsVisual({
        item,
        items: [],
        transitions: [],
        fps,
        frameToPixels: frameToPixelsNow,
        leftNeighbor: null,
        rightNeighbor: null,
        constraintEdge: null,
        constrained: false,
        currentLeftPx,
        currentRightPx,
        effectiveMinDelta: slideRange.minDelta,
        effectiveMaxDelta: slideRange.maxDelta,
      })
    }

    // Linked slip companion: show the limit box for this item's own source bounds
    if (isLinkedSlipCompanion) {
      return getSlipOperationBoundsVisual({
        item: previewBaseItem,
        fps,
        frameToPixels: frameToPixelsNow,
        constraintEdge: null,
        constrained: false,
        currentLeftPx,
        currentRightPx,
      })
    }

    return null
  }, [
    fps,
    isRollingEdit,
    isRippleEdit,
    isSlipSlideActive,
    isStretching,
    isTrimming,
    item,
    slideRange,
    slideLeftNeighborForSlidItem,
    slideRightNeighborForSlidItem,
    slipSlideConstrained,
    slipSlideConstraintEdge,
    slipSlideMode,
    stretchConstrained,
    stretchHandle,
    trimConstrained,
    trimHandle,
    visualLeft,
    visualWidth,
    contentPreviewItem,
    isLinkedSlipCompanion,
    isLinkedSlideCompanion,
    previewBaseItem,
  ])
}
