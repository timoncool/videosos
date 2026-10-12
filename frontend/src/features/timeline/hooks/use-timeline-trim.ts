import { useState, useCallback, useRef, useEffect } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { commitPreviewFrameToCurrentFrame } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { toast } from 'sonner'
import type { SnapTarget } from '../types/drag'
import { useItemsStore } from '../stores/items-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useDragInteractionPreamble } from './use-drag-interaction-preamble'
import { findNearestSnapTargetExcluding } from '../utils/timeline-snap-utils'
import { setActiveSnapTargetIfChanged } from '../utils/snap-target-state'
import { clampTrimAmount, clampToAdjacentItems, type TrimHandle } from '../utils/trim-utils'
import { useTransitionsStore } from '../stores/transitions-store'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store'
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store'
import { useTransitionBreakPreviewStore } from '../stores/transition-break-preview-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import {
  rollingTrimItems,
  rippleTrimItem,
  trimItemEnd as trimSelectedItemEnds,
  trimItemBreakingTransition,
  trimItemStart as trimSelectedItemStarts,
} from '../stores/actions/item-actions'
import {
  buildInsertedGapPreviewUpdatesForSyncLockedTracks,
  buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
} from '../stores/actions/sync-lock-ripple'
import { findHandleNeighborWithTransitions } from '../utils/transition-linked-neighbors'
import {
  buildAttachedCaptionBoundsPreviewUpdates,
  buildSynchronizedLinkedMoveUpdates,
  expandSelectionWithLinkedItems,
  filterUnlockedItemIds,
  getSynchronizedLinkedCounterpartPair,
  getSynchronizedLinkedItems,
} from '../utils/linked-items'
import {
  applyMovePreview,
  applyTrimEndPreview,
  applyTrimStartPreview,
  type PreviewItemUpdate,
} from '../utils/item-edit-preview'
import {
  clampRippleTrimDeltaToPreserveEditState,
  clampRollingTrimDeltaToPreserveEditState,
} from '../utils/trim-edit-constraints'
import { getTransitionBridgeAtHandle } from '../utils/transition-edit-guards'
import { createRafCoalescedCallback } from '../utils/raf-coalesced-callback'

interface TrimState {
  isTrimming: boolean
  handle: TrimHandle | null
  startX: number
  initialFrom: number
  initialDuration: number
  currentDelta: number // Track current delta for visual feedback
  isRollingEdit: boolean
  isRippleEdit: boolean
  neighborId: string | null
  forcedMode: 'rolling' | 'ripple' | null
  isConstrained: boolean
  constraintLabel: string | null
  destroyTransitionAtHandle: boolean
  trimmedItemIds: string[]
}

const TRIM_EDGE_ALIGNMENT_EPSILON = 1e-6

function areTrimEdgesAligned(left: number, right: number): boolean {
  return Math.abs(left - right) <= TRIM_EDGE_ALIGNMENT_EPSILON
}

/**
 * Hook for handling timeline item trimming
 *
 * Optimized approach:
 * - Visual feedback via local state during drag (no store updates)
 * - Only commit to store on mouseup (single undo entry)
 * - Smooth performance with RAF updates
 * - Snapping support for trim edges to grid and item boundaries
 * - Source boundary clamping for accurate visual feedback
 */

interface TrimPointerDrag {
  handle: TrimHandle
  initialFrom: number
  initialDuration: number
  forcedMode: 'rolling' | 'ripple' | null
  trimmedItemIds: string[]
  destroyTransitionAtHandle: boolean
  altKey: boolean
  shiftKey: boolean
}

interface TrimEditModes {
  forcedMode: 'rolling' | 'ripple' | null
  isRollingEdit: boolean
  isRippleEdit: boolean
}

interface TrimClampResult {
  deltaFrames: number
  isConstrained: boolean
  constraintLabel: string | null
}

type SnapFrameResolver = (
  targetFrame: number,
  excludeItemIds?: Set<string>,
) => { snappedFrame: number; snapTarget: SnapTarget | null }

function resolveTrimEditModes(drag: TrimPointerDrag): TrimEditModes {
  const forcedMode = drag.forcedMode
  return {
    forcedMode,
    isRollingEdit:
      forcedMode === 'rolling' || (forcedMode === null && drag.altKey && !drag.shiftKey),
    isRippleEdit: forcedMode === 'ripple' || (forcedMode === null && drag.shiftKey),
  }
}

function resolveNormalTrimItems(
  allItems: TimelineItem[],
  currentItem: TimelineItem,
  trimmedItemIds: string[],
): TimelineItem[] {
  const normalTrimItems = trimmedItemIds
    .map((trimmedItemId) => allItems.find((candidate) => candidate.id === trimmedItemId))
    .filter((candidate): candidate is TimelineItem => candidate !== undefined)
  if (normalTrimItems.length === 0) normalTrimItems.push(currentItem)
  return normalTrimItems
}

function findRollingNeighborId(
  currentItem: TimelineItem,
  handle: TrimHandle,
  allItems: TimelineItem[],
  transitions: Transition[],
): string | null {
  const neighbor = findHandleNeighborWithTransitions(currentItem, handle, allItems, transitions)
  return neighbor ? neighbor.id : null
}

function addSegmentFamilyExclusions(
  snapExcludeIds: Set<string>,
  currentItem: TimelineItem,
  allItems: TimelineItem[],
): void {
  // Split segments from the same origin can create self-referential
  // snap targets during ripple drags; exclude the whole segment family.
  if (!currentItem.originId) return
  for (const other of allItems) {
    if (
      other.id === currentItem.id ||
      other.trackId !== currentItem.trackId ||
      other.originId !== currentItem.originId
    ) {
      continue
    }
    snapExcludeIds.add(other.id)
  }
}

function forEachDownstreamSameTrackItem(
  currentItem: TimelineItem,
  allItems: TimelineItem[],
  visit: (other: TimelineItem) => void,
): void {
  const currentEnd = currentItem.from + currentItem.durationInFrames
  for (const other of allItems) {
    if (other.id === currentItem.id || other.trackId !== currentItem.trackId) continue
    if (other.from >= currentEnd) visit(other)
  }
}

function addDownstreamExclusions(
  snapExcludeIds: Set<string>,
  currentItem: TimelineItem,
  allItems: TimelineItem[],
): void {
  forEachDownstreamSameTrackItem(currentItem, allItems, (other) => {
    snapExcludeIds.add(other.id)
  })
}

function addTransitionExclusions(
  snapExcludeIds: Set<string>,
  currentItem: TimelineItem,
  transitions: Transition[],
): void {
  // Also exclude transition-connected neighbors in both directions — in
  // the overlap model, their `from` can be before currentEnd, but their
  // edges/midpoints still sit on the active edit region.
  for (const t of transitions) {
    if (t.leftClipId === currentItem.id) snapExcludeIds.add(t.rightClipId)
    if (t.rightClipId === currentItem.id) snapExcludeIds.add(t.leftClipId)
  }
}

function buildTrimSnapExclusions(options: {
  trimmedItemIds: string[]
  currentItem: TimelineItem
  neighborId: string | null
  isRippleEdit: boolean
  allItems: TimelineItem[]
  transitions: Transition[]
}): Set<string> {
  const { trimmedItemIds, currentItem, neighborId, isRippleEdit, allItems, transitions } = options
  // During rolling edit, exclude the neighbor from snap targets.
  // During ripple edit, exclude downstream same-track items — their positions
  // are stale because they will shift by the trim amount on commit.
  const snapExcludeIds = new Set<string>(trimmedItemIds)
  snapExcludeIds.add(currentItem.id)
  if (neighborId) snapExcludeIds.add(neighborId)
  if (!isRippleEdit) return snapExcludeIds
  addSegmentFamilyExclusions(snapExcludeIds, currentItem, allItems)
  addDownstreamExclusions(snapExcludeIds, currentItem, allItems)
  addTransitionExclusions(snapExcludeIds, currentItem, transitions)
  return snapExcludeIds
}

function snapTrimDeltaToEdge(options: {
  handle: TrimHandle
  initialFrom: number
  initialEnd: number
  deltaFrames: number
  findSnapForFrame: SnapFrameResolver
  snapExcludeIds: Set<string>
}): { deltaFrames: number; snapTarget: SnapTarget | null } {
  const { handle, initialFrom, initialEnd, findSnapForFrame, snapExcludeIds } = options
  // Snap the edge the user is dragging — always the handle edge,
  // regardless of edit mode. Ripple commit logic (anchor from, move end,
  // shift downstream) is separate from the snap target.
  const targetEdgeFrame =
    handle === 'start' ? initialFrom + options.deltaFrames : initialEnd + options.deltaFrames

  // Find snap target for the edge being trimmed
  const { snappedFrame, snapTarget } = findSnapForFrame(
    targetEdgeFrame,
    snapExcludeIds.size > 0 ? snapExcludeIds : undefined,
  )

  // If snapped, adjust deltaFrames accordingly
  if (!snapTarget) return { deltaFrames: options.deltaFrames, snapTarget }
  if (handle === 'start') {
    return { deltaFrames: snappedFrame - initialFrom, snapTarget }
  }
  return { deltaFrames: snappedFrame - initialEnd, snapTarget }
}

function clampTrimItemToSource(
  prev: TrimClampResult,
  trimConstraintItem: TimelineItem,
  handle: TrimHandle,
  fps: number,
): TrimClampResult {
  // Apply source boundary clamping for media items
  // This ensures visual feedback matches what the store will actually commit
  const { clampedAmount } = clampTrimAmount(trimConstraintItem, handle, prev.deltaFrames, fps)
  if (clampedAmount === prev.deltaFrames) return prev
  return { deltaFrames: clampedAmount, isConstrained: true, constraintLabel: 'no handle' }
}

function clampTrimItemToNeighbors(
  prev: TrimClampResult,
  options: {
    trimConstraintItem: TimelineItem
    currentItem: TimelineItem
    handle: TrimHandle
    isRollingEdit: boolean
    allItems: TimelineItem[]
    transitions: Transition[]
    destroyTransitionAtHandle: boolean
    neighborId: string | null
  },
): TrimClampResult {
  const {
    trimConstraintItem,
    currentItem,
    handle,
    isRollingEdit,
    allItems,
    transitions,
    destroyTransitionAtHandle,
    neighborId,
  } = options
  // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
  const transitionLinkedIds = new Set<string>()
  if (!destroyTransitionAtHandle || trimConstraintItem.id !== currentItem.id) {
    for (const t of transitions) {
      if (t.leftClipId === trimConstraintItem.id) transitionLinkedIds.add(t.rightClipId)
      if (t.rightClipId === trimConstraintItem.id) transitionLinkedIds.add(t.leftClipId)
    }
  }
  // During rolling edit, exclude the neighbor from adjacency constraints —
  // it moves with the edit point, so the rolling edit clamp below handles it.
  if (isRollingEdit && neighborId) {
    transitionLinkedIds.add(neighborId)
  }
  const adjacentClamped = clampToAdjacentItems(
    trimConstraintItem,
    handle,
    prev.deltaFrames,
    allItems,
    transitionLinkedIds,
  )
  if (adjacentClamped === prev.deltaFrames) return prev
  return { deltaFrames: adjacentClamped, isConstrained: true, constraintLabel: 'neighbor limit' }
}

function clampTrimDeltaToSourcesAndNeighbors(
  prev: TrimClampResult,
  options: {
    normalTrimItems: TimelineItem[]
    currentItem: TimelineItem
    handle: TrimHandle
    fps: number
    isRollingEdit: boolean
    isRippleEdit: boolean
    allItems: TimelineItem[]
    transitions: Transition[]
    destroyTransitionAtHandle: boolean
    neighborId: string | null
  },
): TrimClampResult {
  const {
    normalTrimItems,
    currentItem,
    handle,
    fps,
    isRollingEdit,
    isRippleEdit,
    allItems,
    transitions,
    destroyTransitionAtHandle,
    neighborId,
  } = options
  let result = prev
  const trimConstraintItems = isRollingEdit || isRippleEdit ? [currentItem] : normalTrimItems
  for (const trimConstraintItem of trimConstraintItems) {
    result = clampTrimItemToSource(result, trimConstraintItem, handle, fps)
    // During ripple edit, skip adjacency clamping — downstream clips shift with the trim.
    if (isRippleEdit) continue
    result = clampTrimItemToNeighbors(result, {
      trimConstraintItem,
      currentItem,
      handle,
      isRollingEdit,
      allItems,
      transitions,
      destroyTransitionAtHandle,
      neighborId,
    })
  }
  return result
}

function clampRollingEditDelta(
  prev: TrimClampResult,
  options: {
    currentItem: TimelineItem
    handle: TrimHandle
    neighborId: string
    allItems: TimelineItem[]
    transitions: Transition[]
    keyframesByItemId: ReturnType<typeof useKeyframesStore.getState>['keyframesByItemId']
    fps: number
  },
): TrimClampResult {
  const { currentItem, handle, neighborId, allItems, transitions, keyframesByItemId, fps } = options
  let { deltaFrames, isConstrained, constraintLabel } = prev
  // Rolling edit: clamp to both clips' source limits
  const neighbor = allItems.find((i) => i.id === neighborId)!
  if (handle === 'end') {
    // Neighbor's start is trimmed by the same delta (positive = shrink start)
    const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'start', deltaFrames, fps)
    // Use tighter constraint of both clips
    if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
      isConstrained = true
      constraintLabel = 'cut limit'
      deltaFrames = neighborClamped
    }
  } else {
    // For the left neighbor's end, pass deltaFrames directly to clampTrimAmount
    // delta > 0 (shrink this item's start, edit point moves right) → neighbor extends end (positive for trimEnd = extend)
    // delta < 0 (extend this item's start, edit point moves left) → neighbor shrinks end (negative for trimEnd = shrink)
    const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'end', deltaFrames, fps)
    if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
      isConstrained = true
      constraintLabel = 'cut limit'
      deltaFrames = neighborClamped
    }
  }

  const transitionClamped = clampRollingTrimDeltaToPreserveEditState(
    currentItem,
    handle,
    deltaFrames,
    neighbor,
    allItems,
    transitions,
    keyframesByItemId,
    fps,
  )
  if (transitionClamped !== deltaFrames) {
    isConstrained = true
    constraintLabel = 'transition limit'
    deltaFrames = transitionClamped
  }
  return { deltaFrames, isConstrained, constraintLabel }
}

function clampRippleEditDelta(
  prev: TrimClampResult,
  options: {
    currentItem: TimelineItem
    handle: TrimHandle
    allItems: TimelineItem[]
    transitions: Transition[]
    keyframesByItemId: ReturnType<typeof useKeyframesStore.getState>['keyframesByItemId']
    fps: number
    destroyTransitionAtHandle: boolean
  },
): TrimClampResult {
  const {
    currentItem,
    handle,
    allItems,
    transitions,
    keyframesByItemId,
    fps,
    destroyTransitionAtHandle,
  } = options
  let { deltaFrames, isConstrained, constraintLabel } = prev
  const transitionAtHandle = destroyTransitionAtHandle
    ? getTransitionBridgeAtHandle(transitions, currentItem.id, handle)
    : null
  const preservedTransitions = transitionAtHandle
    ? transitions.filter((transition) => transition.id !== transitionAtHandle.id)
    : transitions
  const transitionClamped = clampRippleTrimDeltaToPreserveEditState(
    currentItem,
    handle,
    deltaFrames,
    allItems,
    preservedTransitions,
    keyframesByItemId,
    fps,
  )
  if (transitionClamped !== deltaFrames) {
    isConstrained = true
    constraintLabel = 'transition limit'
    deltaFrames = transitionClamped
  }
  return { deltaFrames, isConstrained, constraintLabel }
}

function syncRollingEditPreview(options: {
  itemId: string
  neighborId: string | null
  handle: TrimHandle
  deltaFrames: number
  isConstrained: boolean
}): void {
  const { itemId, neighborId, handle, deltaFrames, isConstrained } = options
  // Update rolling edit preview store
  if (neighborId) {
    const previewStore = useRollingEditPreviewStore.getState()
    if (
      previewStore.trimmedItemId !== itemId ||
      previewStore.neighborItemId !== neighborId ||
      previewStore.handle !== handle
    ) {
      previewStore.setPreview({
        trimmedItemId: itemId,
        neighborItemId: neighborId,
        handle,
        neighborDelta: deltaFrames,
        constrained: isConstrained,
      })
    } else if (
      previewStore.neighborDelta !== deltaFrames ||
      previewStore.constrained !== isConstrained
    ) {
      previewStore.setNeighborDelta(deltaFrames, isConstrained)
    }
  } else {
    // Clear preview when Alt is released or no neighbor found
    const previewStore = useRollingEditPreviewStore.getState()
    if (previewStore.trimmedItemId) {
      previewStore.clearPreview()
    }
  }
}

function computeRippleShift(handle: TrimHandle, deltaFrames: number): number {
  // Start handle: anchor-from model — downstream shifts by -delta
  return handle === 'end' ? deltaFrames : -deltaFrames
}

function collectRippleDownstreamIds(
  currentItem: TimelineItem,
  allItems: TimelineItem[],
  transitions: Transition[],
): Set<string> {
  // Compute downstream item IDs once — includes transition-connected
  // neighbors whose `from` may be before the trimmed clip's end (overlap model).
  const dsIds = new Set<string>()
  forEachDownstreamSameTrackItem(currentItem, allItems, (other) => {
    dsIds.add(other.id)
  })
  // Transition-connected neighbors in the overlap model
  for (const t of transitions) {
    if (t.leftClipId === currentItem.id) dsIds.add(t.rightClipId)
  }
  return dsIds
}

function syncRippleEditPreview(options: {
  isRippleEdit: boolean
  itemId: string
  handle: TrimHandle
  currentItem: TimelineItem
  deltaFrames: number
  allItems: TimelineItem[]
  transitions: Transition[]
}): void {
  const { isRippleEdit, itemId, handle, currentItem, deltaFrames, allItems, transitions } = options
  // Update ripple edit preview store for downstream item visual feedback.
  // Both the trimmed item's delta and the downstream shift are stored in the
  // same Zustand store so they commit in a single render — preventing a
  // one-frame gap between the extending clip and the shifting neighbours.
  if (!isRippleEdit) {
    // Clear ripple preview when Shift is released or not in ripple mode
    const rippleStore = useRippleEditPreviewStore.getState()
    if (rippleStore.trimmedItemId) {
      rippleStore.clearPreview()
    }
    return
  }
  // Calculate the shift that downstream items would experience
  const rippleShift = computeRippleShift(handle, deltaFrames)

  const rippleStore = useRippleEditPreviewStore.getState()
  if (
    rippleStore.trimmedItemId !== itemId ||
    rippleStore.handle !== handle ||
    rippleStore.trackId !== currentItem.trackId
  ) {
    rippleStore.setPreview({
      trimmedItemId: itemId,
      handle,
      trackId: currentItem.trackId,
      downstreamItemIds: collectRippleDownstreamIds(currentItem, allItems, transitions),
      delta: rippleShift,
      trimDelta: deltaFrames,
    })
  } else if (rippleStore.delta !== rippleShift || rippleStore.trimDelta !== deltaFrames) {
    rippleStore.setDeltas(rippleShift, deltaFrames)
  }
}

function syncTransitionBreakPreview(options: {
  destroyTransitionAtHandle: boolean
  itemId: string
  handle: TrimHandle
  deltaFrames: number
}): void {
  const { destroyTransitionAtHandle, itemId, handle, deltaFrames } = options
  if (destroyTransitionAtHandle && handle) {
    const transitionBreakStore = useTransitionBreakPreviewStore.getState()
    if (transitionBreakStore.itemId !== itemId || transitionBreakStore.handle !== handle) {
      transitionBreakStore.setPreview({
        itemId,
        handle,
        delta: deltaFrames,
      })
    } else if (transitionBreakStore.delta !== deltaFrames) {
      transitionBreakStore.setDelta(deltaFrames)
    }
  } else {
    const transitionBreakStore = useTransitionBreakPreviewStore.getState()
    if (transitionBreakStore.itemId) {
      transitionBreakStore.clearPreview()
    }
  }
}

function buildRollingCounterpartUpdates(options: {
  linkedSelectionEnabled: boolean
  handle: TrimHandle
  allItems: TimelineItem[]
  currentItemId: string
  neighborId: string
  deltaFrames: number
  fps: number
}): PreviewItemUpdate[] {
  const { linkedSelectionEnabled, handle, allItems, currentItemId, neighborId, deltaFrames, fps } =
    options
  const counterpartPair = linkedSelectionEnabled
    ? handle === 'end'
      ? getSynchronizedLinkedCounterpartPair(allItems, currentItemId, neighborId)
      : getSynchronizedLinkedCounterpartPair(allItems, neighborId, currentItemId)
    : null
  if (!counterpartPair) return []
  return [
    applyTrimEndPreview(counterpartPair.leftCounterpart, deltaFrames, fps),
    applyTrimStartPreview(counterpartPair.rightCounterpart, deltaFrames, fps),
  ]
}

function buildRippleCompanionUpdates(
  synchronizedItems: TimelineItem[],
  currentItem: TimelineItem,
  handle: TrimHandle,
  deltaFrames: number,
  fps: number,
): PreviewItemUpdate[] {
  const linkedCompanions = synchronizedItems.filter(
    (linkedItem) => linkedItem.id !== currentItem.id,
  )
  return linkedCompanions.map((linkedItem) =>
    handle === 'end'
      ? applyTrimEndPreview(linkedItem, deltaFrames, fps)
      : {
          ...applyTrimStartPreview(linkedItem, deltaFrames, fps),
          from: linkedItem.from,
        },
  )
}

function collectTransitionRightIds(transitions: Transition[], itemId: string): Set<string> {
  const ids = new Set<string>()
  for (const transition of transitions) {
    if (transition.leftClipId === itemId) ids.add(transition.rightClipId)
  }
  return ids
}

function isRippleShiftTarget(
  candidate: TimelineItem,
  synchronizedItem: TimelineItem,
  synchronizedIds: Set<string>,
  transitionNeighborIds: Set<string>,
): boolean {
  if (synchronizedIds.has(candidate.id)) return false
  if (candidate.trackId !== synchronizedItem.trackId) return false
  const synchronizedOldEnd = synchronizedItem.from + synchronizedItem.durationInFrames
  return candidate.from >= synchronizedOldEnd || transitionNeighborIds.has(candidate.id)
}

function collectRippleShiftTargets(
  synchronizedItems: TimelineItem[],
  allItems: TimelineItem[],
  transitions: Transition[],
  rippleShift: number,
): Map<string, number> {
  const synchronizedIds = new Set(synchronizedItems.map((linkedItem) => linkedItem.id))
  const baseDeltaByItemId = new Map<string, number>()
  for (const synchronizedItem of synchronizedItems) {
    const transitionNeighborIds = collectTransitionRightIds(transitions, synchronizedItem.id)
    for (const candidate of allItems) {
      if (
        isRippleShiftTarget(candidate, synchronizedItem, synchronizedIds, transitionNeighborIds)
      ) {
        baseDeltaByItemId.set(candidate.id, rippleShift)
      }
    }
  }
  return baseDeltaByItemId
}

function buildRippleDownstreamMoveUpdates(
  synchronizedItems: TimelineItem[],
  allItems: TimelineItem[],
  currentItem: TimelineItem,
  transitions: Transition[],
  rippleShift: number,
): PreviewItemUpdate[] {
  if (rippleShift === 0 || synchronizedItems.length < 2) return []
  const allItemsById = new Map(allItems.map((item) => [item.id, item]))
  const baseDeltaByItemId = collectRippleShiftTargets(
    synchronizedItems,
    allItems,
    transitions,
    rippleShift,
  )
  return (
    buildSynchronizedLinkedMoveUpdates(allItems, baseDeltaByItemId)
      // Same-track downstream clips already get their live ripple shift from
      // `useRippleEditPreviewStore`; duplicating that here moves them twice,
      // which creates the temporary gap/ghost before mouseup snaps back.
      .filter((update) => allItemsById.get(update.id)?.trackId !== currentItem.trackId)
      .map((update) => {
        const sourceItem = allItemsById.get(update.id)
        return sourceItem ? applyMovePreview(sourceItem, update.from - sourceItem.from) : null
      })
      .filter((update): update is NonNullable<typeof update> => update !== null)
  )
}

function buildRippleSyncLockUpdates(options: {
  synchronizedItems: TimelineItem[]
  currentItem: TimelineItem
  allItems: TimelineItem[]
  tracks: ReturnType<typeof useItemsStore.getState>['tracks']
  rippleShift: number
}): PreviewItemUpdate[] {
  const { synchronizedItems, currentItem, allItems, tracks, rippleShift } = options
  if (rippleShift === 0) return []
  const editedTrackIds = new Set(synchronizedItems.map((linkedItem) => linkedItem.trackId))
  return rippleShift < 0
    ? buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
        items: allItems,
        tracks,
        editedTrackIds,
        intervals: [
          {
            start: currentItem.from + currentItem.durationInFrames + rippleShift,
            end: currentItem.from + currentItem.durationInFrames,
          },
        ],
      })
    : buildInsertedGapPreviewUpdatesForSyncLockedTracks({
        items: allItems,
        tracks,
        editedTrackIds,
        cutFrame: currentItem.from + currentItem.durationInFrames,
        amount: rippleShift,
      })
}

function buildRippleLinkedUpdates(options: {
  linkedSelectionEnabled: boolean
  handle: TrimHandle
  allItems: TimelineItem[]
  currentItem: TimelineItem
  deltaFrames: number
  fps: number
  transitions: Transition[]
  tracks: ReturnType<typeof useItemsStore.getState>['tracks']
}): PreviewItemUpdate[] {
  const {
    linkedSelectionEnabled,
    handle,
    allItems,
    currentItem,
    deltaFrames,
    fps,
    transitions,
    tracks,
  } = options
  const synchronizedItems = linkedSelectionEnabled
    ? getSynchronizedLinkedItems(allItems, currentItem.id)
    : [currentItem]
  const rippleShift = computeRippleShift(handle, deltaFrames)
  return [
    ...buildRippleCompanionUpdates(synchronizedItems, currentItem, handle, deltaFrames, fps),
    ...buildRippleDownstreamMoveUpdates(
      synchronizedItems,
      allItems,
      currentItem,
      transitions,
      rippleShift,
    ),
    ...buildRippleSyncLockUpdates({
      synchronizedItems,
      currentItem,
      allItems,
      tracks,
      rippleShift,
    }),
  ]
}

function buildNormalTrimUpdates(options: {
  handle: TrimHandle
  normalTrimItems: TimelineItem[]
  currentItemId: string
  deltaFrames: number
  fps: number
  allItems: TimelineItem[]
}): PreviewItemUpdate[] {
  const { handle, normalTrimItems, currentItemId, deltaFrames, fps, allItems } = options
  const linkedPreviewUpdates: PreviewItemUpdate[] = []
  const captionClipBounds: Array<{ id: string; from: number; durationInFrames: number }> = []

  for (const linkedItem of normalTrimItems) {
    const previewUpdate =
      handle === 'end'
        ? applyTrimEndPreview(linkedItem, deltaFrames, fps)
        : applyTrimStartPreview(linkedItem, deltaFrames, fps)

    const previewDuration = previewUpdate.durationInFrames ?? linkedItem.durationInFrames
    const isShorter = previewDuration < linkedItem.durationInFrames
    if (isShorter) {
      captionClipBounds.push({
        id: linkedItem.id,
        from: previewUpdate.from ?? linkedItem.from,
        durationInFrames: previewDuration,
      })
    }

    if (linkedItem.id === currentItemId) continue
    linkedPreviewUpdates.push(previewUpdate)
  }

  linkedPreviewUpdates.push(
    ...buildAttachedCaptionBoundsPreviewUpdates(allItems, captionClipBounds),
  )
  return linkedPreviewUpdates
}

interface TrimStartModes {
  forcedMode: 'rolling' | 'ripple' | null
  destroyTransitionAtHandle: boolean
  wantsRolling: boolean
  wantsRipple: boolean
}

function resolveTrimStartModes(
  e: React.MouseEvent,
  options?: {
    forcedMode?: 'rolling' | 'ripple' | null
    destroyTransitionAtHandle?: boolean
  },
): TrimStartModes {
  const forcedMode = options?.forcedMode ?? null
  const modifierRolling = e.altKey && !e.shiftKey
  return {
    forcedMode,
    destroyTransitionAtHandle: options?.destroyTransitionAtHandle ?? false,
    wantsRolling: forcedMode === 'rolling' || (forcedMode === null && modifierRolling),
    wantsRipple: forcedMode === 'ripple' || (forcedMode === null && e.shiftKey),
  }
}

function filterVerticallyAlignedTrimItemIds(
  unlockedTrimItemIds: string[],
  currentItem: TimelineItem,
  handle: TrimHandle,
  allItems: TimelineItem[],
): string[] {
  const anchorTrimEdge =
    handle === 'start' ? currentItem.from : currentItem.from + currentItem.durationInFrames
  return unlockedTrimItemIds.filter((trimmedItemId) => {
    if (trimmedItemId === currentItem.id) return true
    const trimmedItem = allItems.find((candidate) => candidate.id === trimmedItemId)
    if (!trimmedItem) return false
    const trimmedItemEdge =
      handle === 'start' ? trimmedItem.from : trimmedItem.from + trimmedItem.durationInFrames
    return areTrimEdgesAligned(anchorTrimEdge, trimmedItemEdge)
  })
}

function resolveTrimItemIds(
  currentItem: TimelineItem,
  handle: TrimHandle,
  allItems: TimelineItem[],
): string[] {
  const selectedItemIds = useSelectionStore.getState().selectedItemIds
  const baseTrimItemIds = selectedItemIds.includes(currentItem.id)
    ? selectedItemIds
    : [currentItem.id]
  const expandedTrimItemIds = useEditorStore.getState().linkedSelectionEnabled
    ? expandSelectionWithLinkedItems(allItems, baseTrimItemIds)
    : baseTrimItemIds
  const unlockedTrimItemIds = filterUnlockedItemIds(
    allItems,
    useItemsStore.getState().tracks,
    expandedTrimItemIds,
  )
  const verticallyAlignedTrimItemIds = filterVerticallyAlignedTrimItemIds(
    unlockedTrimItemIds,
    currentItem,
    handle,
    allItems,
  )
  return verticallyAlignedTrimItemIds.includes(currentItem.id)
    ? verticallyAlignedTrimItemIds
    : [currentItem.id]
}

function initTrimStartPreviews(options: {
  wantsRolling: boolean
  neighborId: string | null
  itemId: string
  handle: TrimHandle
  destroyTransitionAtHandle: boolean
}): void {
  const { wantsRolling, neighborId, itemId, handle, destroyTransitionAtHandle } = options
  if (wantsRolling && neighborId) {
    useRollingEditPreviewStore.getState().setPreview({
      trimmedItemId: itemId,
      neighborItemId: neighborId,
      handle,
      neighborDelta: 0,
    })
  }

  if (destroyTransitionAtHandle) {
    useTransitionBreakPreviewStore.getState().setPreview({
      itemId,
      handle,
      delta: 0,
    })
  } else {
    useTransitionBreakPreviewStore.getState().clearPreview()
  }
}

function resolveBrokenTransitionIds(state: TrimState, itemId: string): string[] {
  if (!state.destroyTransitionAtHandle || !state.handle) return []
  return useTransitionsStore
    .getState()
    .transitions.filter((transition) =>
      state.handle === 'start'
        ? transition.rightClipId === itemId
        : transition.leftClipId === itemId,
    )
    .map((transition) => transition.id)
}

function commitTrimStateToStore(itemId: string, state: TrimState): void {
  const deltaFrames = state.currentDelta
  // Only update store if there was actual change
  if (deltaFrames === 0) return
  if (state.destroyTransitionAtHandle && state.handle) {
    trimItemBreakingTransition(
      itemId,
      state.handle,
      deltaFrames,
      resolveBrokenTransitionIds(state, itemId),
      { itemIds: state.trimmedItemIds },
    )
    return
  }
  if (state.isRippleEdit) {
    // Ripple edit: trim + shift downstream items
    rippleTrimItem(itemId, state.handle!, deltaFrames)
    return
  }
  if (state.isRollingEdit && state.neighborId) {
    // Rolling edit: determine left/right clip IDs and edit point delta
    if (state.handle === 'end') {
      // Trimming end handle: this item is the left clip
      rollingTrimItems(itemId, state.neighborId, deltaFrames)
    } else {
      // Trimming start handle: this item is the right clip, neighbor is left
      // rollingTrimItems convention: positive delta = edit point moves right
      rollingTrimItems(state.neighborId, itemId, deltaFrames)
    }
    return
  }
  // Normal trim
  if (state.handle === 'start') {
    trimSelectedItemStarts(itemId, deltaFrames, { itemIds: state.trimmedItemIds })
  } else if (state.handle === 'end') {
    trimSelectedItemEnds(itemId, deltaFrames, { itemIds: state.trimmedItemIds })
  }
}

export function useTimelineTrim(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
) {
  const {
    pixelsToTime,
    fps,
    setDragState,
    setActiveSnapTarget,
    getMagneticSnapTargets,
    getSnapThresholdFrames,
    isSnapEnabled,
  } = useDragInteractionPreamble(item, timelineDuration)

  // Get fresh item from store to ensure we have latest values after previous trims
  const getItemFromStore = useCallback(() => {
    return useItemsStore.getState().items.find((i) => i.id === item.id) ?? item
  }, [item])

  const [trimState, setTrimState] = useState<TrimState>({
    isTrimming: false,
    handle: null,
    startX: 0,
    initialFrom: 0,
    initialDuration: 0,
    currentDelta: 0,
    isRollingEdit: false,
    isRippleEdit: false,
    neighborId: null,
    forcedMode: null,
    isConstrained: false,
    constraintLabel: null,
    destroyTransitionAtHandle: false,
    trimmedItemIds: [],
  })

  const trimStateRef = useRef(trimState)
  trimStateRef.current = trimState

  // Track Alt key state for rolling edit
  const altKeyRef = useRef(false)

  // Track Shift key state for ripple edit
  const shiftKeyRef = useRef(false)

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null)
  const magneticSnapTargetsRef = useRef<SnapTarget[]>([])

  /**
   * Find nearest snap target for a given frame position
   * @param excludeItemId - Optional item ID to exclude from snap targets (e.g. rolling edit neighbor)
   */
  const findSnapForFrame = useCallback(
    (
      targetFrame: number,
      excludeItemIds?: Set<string>,
    ): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      if (!isSnapEnabled()) {
        return { snappedFrame: targetFrame, snapTarget: null }
      }

      const targets = magneticSnapTargetsRef.current
      if (targets.length === 0) {
        return { snappedFrame: targetFrame, snapTarget: null }
      }

      const nearestTarget = findNearestSnapTargetExcluding(
        targetFrame,
        targets,
        getSnapThresholdFrames(),
        excludeItemIds,
      )

      if (nearestTarget) {
        return { snappedFrame: nearestTarget.frame, snapTarget: nearestTarget }
      }

      return { snappedFrame: targetFrame, snapTarget: null }
    },
    [getSnapThresholdFrames, isSnapEnabled],
  )

  // Mouse move handler - only updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!trimStateRef.current.isTrimming || trackLocked) return
      const snapshot = trimStateRef.current
      const { handle, initialFrom, initialDuration } = snapshot
      if (!handle) return

      const drag: TrimPointerDrag = {
        handle,
        initialFrom,
        initialDuration,
        forcedMode: snapshot.forcedMode,
        trimmedItemIds: snapshot.trimmedItemIds,
        destroyTransitionAtHandle: snapshot.destroyTransitionAtHandle,
        altKey: altKeyRef.current,
        shiftKey: shiftKeyRef.current,
      }
      const { isRollingEdit, isRippleEdit } = resolveTrimEditModes(drag)
      const allItems = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      const keyframesByItemId = useKeyframesStore.getState().keyframesByItemId
      const tracks = useItemsStore.getState().tracks
      const currentItem = getItemFromStore()
      const normalTrimItems = resolveNormalTrimItems(allItems, currentItem, drag.trimmedItemIds)
      const neighborId = isRollingEdit
        ? findRollingNeighborId(currentItem, handle, allItems, transitions)
        : null

      const snapExcludeIds = buildTrimSnapExclusions({
        trimmedItemIds: drag.trimmedItemIds,
        currentItem,
        neighborId,
        isRippleEdit,
        allItems,
        transitions,
      })
      const initialEnd = initialFrom + initialDuration
      const snapped = snapTrimDeltaToEdge({
        handle,
        initialFrom,
        initialEnd,
        deltaFrames: Math.round(pixelsToTime(e.clientX - snapshot.startX) * fps),
        findSnapForFrame,
        snapExcludeIds,
      })

      let clamped: TrimClampResult = {
        deltaFrames: snapped.deltaFrames,
        isConstrained: false,
        constraintLabel: null,
      }
      clamped = clampTrimDeltaToSourcesAndNeighbors(clamped, {
        normalTrimItems,
        currentItem,
        handle,
        fps,
        isRollingEdit,
        isRippleEdit,
        allItems,
        transitions,
        destroyTransitionAtHandle: drag.destroyTransitionAtHandle,
        neighborId,
      })

      // Rolling edit: clamp to both clips' source limits
      if (isRollingEdit && neighborId) {
        clamped = clampRollingEditDelta(clamped, {
          currentItem,
          handle,
          neighborId,
          allItems,
          transitions,
          keyframesByItemId,
          fps,
        })
      }

      if (isRippleEdit) {
        clamped = clampRippleEditDelta(clamped, {
          currentItem,
          handle,
          allItems,
          transitions,
          keyframesByItemId,
          fps,
          destroyTransitionAtHandle: drag.destroyTransitionAtHandle,
        })
      }
      const { deltaFrames, isConstrained, constraintLabel } = clamped

      syncRollingEditPreview({
        itemId: item.id,
        neighborId,
        handle,
        deltaFrames,
        isConstrained,
      })

      syncRippleEditPreview({
        isRippleEdit,
        itemId: item.id,
        handle,
        currentItem,
        deltaFrames,
        allItems,
        transitions,
      })
      syncTransitionBreakPreview({
        destroyTransitionAtHandle: drag.destroyTransitionAtHandle,
        itemId: item.id,
        handle,
        deltaFrames,
      })

      // Update local state for visual feedback
      const isRolling = isRollingEdit && neighborId !== null
      const linkedPreviewUpdates: PreviewItemUpdate[] = []
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled

      if (isRolling && neighborId) {
        linkedPreviewUpdates.push(
          ...buildRollingCounterpartUpdates({
            linkedSelectionEnabled,
            handle,
            allItems,
            currentItemId: currentItem.id,
            neighborId,
            deltaFrames,
            fps,
          }),
        )
      } else if (isRippleEdit) {
        linkedPreviewUpdates.push(
          ...buildRippleLinkedUpdates({
            linkedSelectionEnabled,
            handle,
            allItems,
            currentItem,
            deltaFrames,
            fps,
            transitions,
            tracks,
          }),
        )
      } else {
        linkedPreviewUpdates.push(
          ...buildNormalTrimUpdates({
            handle,
            normalTrimItems,
            currentItemId: currentItem.id,
            deltaFrames,
            fps,
            allItems,
          }),
        )
      }

      useLinkedEditPreviewStore.getState().setUpdates(linkedPreviewUpdates)

      if (
        deltaFrames !== trimStateRef.current.currentDelta ||
        isRolling !== trimStateRef.current.isRollingEdit ||
        isRippleEdit !== trimStateRef.current.isRippleEdit ||
        neighborId !== trimStateRef.current.neighborId ||
        isConstrained !== trimStateRef.current.isConstrained ||
        constraintLabel !== trimStateRef.current.constraintLabel
      ) {
        const nextTrimState = {
          ...trimStateRef.current,
          currentDelta: deltaFrames,
          isRollingEdit: isRolling,
          isRippleEdit,
          neighborId: neighborId,
          isConstrained,
          constraintLabel,
        }
        trimStateRef.current = nextTrimState
        setTrimState(nextTrimState)
      }

      setActiveSnapTargetIfChanged({
        previousRef: prevSnapTargetRef,
        snapTarget: snapped.snapTarget,
        setActiveSnapTarget,
      })
    },
    [
      pixelsToTime,
      fps,
      trackLocked,
      findSnapForFrame,
      setActiveSnapTarget,
      item.id,
      getItemFromStore,
    ],
  )

  // Mouse up handler - commits changes to store (single update)
  const handleMouseUp = useCallback(() => {
    if (!trimStateRef.current.isTrimming) return
    commitTrimStateToStore(item.id, trimStateRef.current)

    // Clear rolling edit preview
    useRollingEditPreviewStore.getState().clearPreview()

    // Clear ripple edit preview
    useRippleEditPreviewStore.getState().clearPreview()
    useTransitionBreakPreviewStore.getState().clearPreview()
    useLinkedEditPreviewStore.getState().clear()

    // Clear drag state (including snap indicator)
    setActiveSnapTarget(null)
    setDragState(null)
    prevSnapTargetRef.current = null
    magneticSnapTargetsRef.current = []

    // Reset modifier key refs
    altKeyRef.current = false
    shiftKeyRef.current = false

    setTrimState({
      isTrimming: false,
      handle: null,
      startX: 0,
      initialFrom: 0,
      initialDuration: 0,
      currentDelta: 0,
      isRollingEdit: false,
      isRippleEdit: false,
      neighborId: null,
      forcedMode: null,
      isConstrained: false,
      constraintLabel: null,
      destroyTransitionAtHandle: false,
      trimmedItemIds: [],
    })
  }, [item.id, setActiveSnapTarget, setDragState])

  // Setup and cleanup mouse event listeners
  useEffect(() => {
    if (trimState.isTrimming) {
      const coalescedMouseMove = createRafCoalescedCallback(handleMouseMove)
      const handleCoalescedMouseUp = () => {
        coalescedMouseMove.flush()
        handleMouseUp()
      }
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          e.preventDefault() // Prevent browser menu activation on Windows
          altKeyRef.current = true
        }
        if (e.key === 'Shift') {
          shiftKeyRef.current = true
        }
      }
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') altKeyRef.current = false
        if (e.key === 'Shift') shiftKeyRef.current = false
      }

      window.addEventListener('mousemove', coalescedMouseMove.queue)
      window.addEventListener('mouseup', handleCoalescedMouseUp)
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('keyup', handleKeyUp)

      return () => {
        window.removeEventListener('mousemove', coalescedMouseMove.queue)
        window.removeEventListener('mouseup', handleCoalescedMouseUp)
        coalescedMouseMove.cancel()
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('keyup', handleKeyUp)
        useRollingEditPreviewStore.getState().clearPreview()
        useTransitionBreakPreviewStore.getState().clearPreview()
        useLinkedEditPreviewStore.getState().clear()
        magneticSnapTargetsRef.current = []
      }
    }
  }, [trimState.isTrimming, handleMouseMove, handleMouseUp])

  // Start trim drag
  const handleTrimStart = useCallback(
    (
      e: React.MouseEvent,
      handle: TrimHandle,
      options?: {
        forcedMode?: 'rolling' | 'ripple' | null
        destroyTransitionAtHandle?: boolean
      },
    ) => {
      // Only respond to left mouse button
      if (e.button !== 0) return
      if (trackLocked) return

      // Always prevent default trim-handle mouse behavior for all paths,
      // including guardrail early returns.
      e.stopPropagation()
      e.preventDefault()
      commitPreviewFrameToCurrentFrame()

      const { forcedMode, destroyTransitionAtHandle, wantsRolling, wantsRipple } =
        resolveTrimStartModes(e, options)
      const currentItem = getItemFromStore()
      const allItems = useItemsStore.getState().items
      const transitions = useTransitionsStore.getState().transitions
      const neighborId = wantsRolling
        ? findRollingNeighborId(currentItem, handle, allItems, transitions)
        : null
      if (wantsRolling && !neighborId) {
        toast.warning('Rolling edit needs a neighbor on this edge')
        return
      }

      const trimmedItemIds = resolveTrimItemIds(currentItem, handle, allItems)

      magneticSnapTargetsRef.current = getMagneticSnapTargets()
      setDragState({
        isDragging: true,
        // The pointer gesture belongs to the anchor. Other selected items get
        // their culled geometry from linked trim previews, not move-drag shells.
        draggedItemIds: [currentItem.id],
        offset: { x: 0, y: 0 },
      })
      setActiveSnapTarget(null)

      setTrimState({
        isTrimming: true,
        handle,
        startX: e.clientX,
        initialFrom: item.from,
        initialDuration: item.durationInFrames,
        currentDelta: 0,
        isRollingEdit: wantsRolling,
        isRippleEdit: wantsRipple,
        neighborId,
        forcedMode,
        isConstrained: false,
        constraintLabel: null,
        destroyTransitionAtHandle,
        trimmedItemIds,
      })

      initTrimStartPreviews({
        wantsRolling,
        neighborId,
        itemId: item.id,
        handle,
        destroyTransitionAtHandle,
      })
    },
    [
      item.from,
      item.durationInFrames,
      trackLocked,
      getItemFromStore,
      getMagneticSnapTargets,
      item.id,
      setActiveSnapTarget,
      setDragState,
    ],
  )

  return {
    isTrimming: trimState.isTrimming,
    trimHandle: trimState.handle,
    trimDelta: trimState.currentDelta,
    isRollingEdit: trimState.isRollingEdit,
    isRippleEdit: trimState.isRippleEdit,
    trimConstrained: trimState.isConstrained,
    trimConstraintLabel: trimState.constraintLabel,
    handleTrimStart,
  }
}
