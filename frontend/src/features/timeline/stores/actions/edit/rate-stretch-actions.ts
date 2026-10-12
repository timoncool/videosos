import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { execute, applyTransitionRepairs } from '../shared'
import { getSynchronizedLinkedItemsForEdit } from '../linked-edit'
import { timelineToSourceFrames, sourceToTimelineFrames } from '../../../utils/source-calculations'
import { expandItemIdsWithAttachedCaptions, getLinkedItemIds } from '../../../utils/linked-items'
import { isLinkedSelectionEnabled, requestPostEditWarmForItems } from './shared'

interface RippleMoveQueue {
  movedIds: Set<string>
  moveUpdates: Array<{ id: string; from: number }>
}

function createRippleMoveQueue(): RippleMoveQueue {
  return { movedIds: new Set(), moveUpdates: [] }
}

function queueRippleMove(
  queue: RippleMoveQueue,
  freshItems: TimelineItem[],
  itemId: string,
  computeFrom: (from: number) => number,
): void {
  if (queue.movedIds.has(itemId)) return
  const item = freshItems.find((i) => i.id === itemId)
  if (!item) return
  queue.movedIds.add(itemId)
  queue.moveUpdates.push({ id: itemId, from: computeFrom(item.from) })

  // Also move linked companions on other tracks
  const linkedIds = expandItemIdsWithAttachedCaptions(
    freshItems,
    getLinkedItemIds(freshItems, itemId),
  )
  for (const linkedId of linkedIds) {
    if (linkedId === itemId || queue.movedIds.has(linkedId)) continue
    const linked = freshItems.find((i) => i.id === linkedId)
    if (linked) {
      queue.movedIds.add(linkedId)
      queue.moveUpdates.push({ id: linkedId, from: computeFrom(linked.from) })
    }
  }
}

function stretchSynchronizedCompanions(
  itemsStore: ReturnType<typeof useItemsStore.getState>,
  synchronizedItems: TimelineItem[],
  id: string,
  fromDelta: number,
  actualDuration: number,
  actualSpeed: number,
): void {
  for (const synchronizedItem of synchronizedItems) {
    if (synchronizedItem.id === id) continue
    itemsStore._rateStretchItem(
      synchronizedItem.id,
      synchronizedItem.from + fromDelta,
      actualDuration,
      actualSpeed,
    )
  }
}

function scaleSynchronizedKeyframes(
  synchronizedItems: TimelineItem[],
  oldDuration: number,
  actualDuration: number,
): void {
  // Scale keyframes proportionally to match new duration
  // This ensures animations maintain their relative timing within the clip.
  // NOTE: synchronizedItems holds pre-stretch snapshots, so scaling runs
  // old duration -> actual duration by design.
  if (oldDuration === actualDuration) return
  for (const synchronizedItem of synchronizedItems) {
    useKeyframesStore
      .getState()
      ._scaleKeyframesForItem(
        synchronizedItem.id,
        synchronizedItem.durationInFrames,
        actualDuration,
      )
  }
}

function collectTouchedTrackIds(
  synchronizedItems: TimelineItem[],
  freshItems: TimelineItem[],
): Set<string> {
  // Collect all track IDs touched by the stretched item + its linked companions
  const touchedTrackIds = new Set<string>()
  for (const si of synchronizedItems) {
    const freshSi = freshItems.find((i) => i.id === si.id)
    if (freshSi) touchedTrackIds.add(freshSi.trackId)
  }
  return touchedTrackIds
}

function shiftDownstreamForStretch(options: {
  queue: RippleMoveQueue
  freshItems: TimelineItem[]
  touchedTrackIds: Set<string>
  allSynchronizedIds: Set<string>
  oldEnd: number
  endDelta: number
}): void {
  const { queue, freshItems, touchedTrackIds, allSynchronizedIds, oldEnd, endDelta } = options
  // End handle changed — shift downstream clips (at or past old end) on touched tracks
  for (const trackId of touchedTrackIds) {
    const downstreamItems = freshItems
      .filter((i) => i.trackId === trackId && !allSynchronizedIds.has(i.id) && i.from >= oldEnd)
      .sort((a, b) => a.from - b.from)

    for (const downstream of downstreamItems) {
      queueRippleMove(queue, freshItems, downstream.id, (from) => from + endDelta)
    }
  }
}

function shiftBridgedEndNeighborsForStretch(options: {
  queue: RippleMoveQueue
  freshItems: TimelineItem[]
  synchronizedItems: TimelineItem[]
  transitions: ReturnType<typeof useTransitionsStore.getState>['transitions']
  allSynchronizedIds: Set<string>
  endDelta: number
}): void {
  const { queue, freshItems, synchronizedItems, transitions, allSynchronizedIds, endDelta } =
    options
  // Also shift transition-connected neighbors that aren't downstream by position
  // but are directly bridged to the stretched clip's end
  for (const si of synchronizedItems) {
    for (const t of transitions) {
      if (
        t.leftClipId === si.id &&
        !allSynchronizedIds.has(t.rightClipId) &&
        !queue.movedIds.has(t.rightClipId)
      ) {
        queueRippleMove(queue, freshItems, t.rightClipId, (from) => from + endDelta)
      }
    }
  }
}

function shiftUpstreamForStretch(options: {
  queue: RippleMoveQueue
  freshItems: TimelineItem[]
  touchedTrackIds: Set<string>
  allSynchronizedIds: Set<string>
  oldFrom: number
  fromDelta: number
}): void {
  const { queue, freshItems, touchedTrackIds, allSynchronizedIds, oldFrom, fromDelta } = options
  // Start handle changed — shift upstream clips (ending at or before old from) on touched tracks
  for (const trackId of touchedTrackIds) {
    const upstreamItems = freshItems
      .filter((i) => {
        if (i.trackId !== trackId || allSynchronizedIds.has(i.id)) return false
        const iEnd = i.from + i.durationInFrames
        return iEnd <= oldFrom
      })
      .sort((a, b) => a.from - b.from)

    for (const upstream of upstreamItems) {
      queueRippleMove(queue, freshItems, upstream.id, (from) => Math.max(0, from + fromDelta))
    }
  }
}

function shiftBridgedStartNeighborsForStretch(options: {
  queue: RippleMoveQueue
  freshItems: TimelineItem[]
  synchronizedItems: TimelineItem[]
  transitions: ReturnType<typeof useTransitionsStore.getState>['transitions']
  allSynchronizedIds: Set<string>
  fromDelta: number
}): void {
  const { queue, freshItems, synchronizedItems, transitions, allSynchronizedIds, fromDelta } =
    options
  // Also shift transition-connected neighbors bridged to the stretched clip's start
  for (const si of synchronizedItems) {
    for (const t of transitions) {
      if (
        t.rightClipId === si.id &&
        !allSynchronizedIds.has(t.leftClipId) &&
        !queue.movedIds.has(t.leftClipId)
      ) {
        queueRippleMove(queue, freshItems, t.leftClipId, (from) => Math.max(0, from + fromDelta))
      }
    }
  }
}

function commitRippleMoveResult(allSynchronizedIds: Set<string>, queue: RippleMoveQueue): void {
  if (queue.moveUpdates.length > 0) {
    useItemsStore.getState()._moveItems(queue.moveUpdates)
  }

  // Repair transitions for all affected clips
  const allAffectedIds = [...allSynchronizedIds, ...queue.movedIds]
  applyTransitionRepairs(allAffectedIds)
  requestPostEditWarmForItems(allAffectedIds)

  useTimelineSettingsStore.getState().markDirty()
}

interface RateStretchOp {
  id: string
  trackId: string
  oldEnd: number
  newDuration: number
  synchronizedIds: string[]
}

function resolveRateStretchOp(
  items: TimelineItem[],
  id: string,
  fps: number,
  processedIds: Set<string>,
): RateStretchOp | null {
  const TOLERANCE = 0.01
  if (processedIds.has(id)) return null
  const item = items.find((i) => i.id === id)
  if (!item || (item.type !== 'video' && item.type !== 'audio')) return null

  const currentSpeed = item.speed || 1
  if (Math.abs(currentSpeed - 1) <= TOLERANCE) return null

  const synchronizedItems = getSynchronizedLinkedItemsForEdit(items, id, isLinkedSelectionEnabled())
  for (const si of synchronizedItems) processedIds.add(si.id)

  const sourceFps = item.sourceFps ?? fps
  const effectiveSourceFrames =
    item.sourceEnd !== undefined && item.sourceStart !== undefined
      ? item.sourceEnd - item.sourceStart
      : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps)

  const newDuration = Math.max(1, sourceToTimelineFrames(effectiveSourceFrames, 1, sourceFps, fps))
  return {
    id,
    trackId: item.trackId,
    oldEnd: item.from + item.durationInFrames,
    newDuration,
    synchronizedIds: synchronizedItems.map((si) => si.id),
  }
}

function collectRateStretchOps(
  itemIds: string[],
  items: TimelineItem[],
  fps: number,
): RateStretchOp[] {
  // Collect all items that need resetting (deduplicate via synchronized links)
  const processedIds = new Set<string>()
  const stretchOps: RateStretchOp[] = []

  for (const id of itemIds) {
    const op = resolveRateStretchOp(items, id, fps, processedIds)
    if (op) stretchOps.push(op)
  }
  return stretchOps
}

function pushStretchedItemsRight(
  queue: RippleMoveQueue,
  freshItems: TimelineItem[],
  stretchOps: RateStretchOp[],
  allChangedIds: Set<string>,
): void {
  for (const op of stretchOps) {
    const stretchedItem = freshItems.find((i) => i.id === op.id)
    if (!stretchedItem) continue

    const newEnd = stretchedItem.from + stretchedItem.durationInFrames
    const growth = newEnd - op.oldEnd
    if (growth <= 0) continue

    // Find all track IDs touched by this item + its linked companions
    const touchedTrackIds = new Set<string>()
    for (const siId of op.synchronizedIds) {
      const si = freshItems.find((i) => i.id === siId)
      if (si) touchedTrackIds.add(si.trackId)
    }

    // On each touched track, push subsequent clips right
    for (const trackId of touchedTrackIds) {
      const trackItems = freshItems
        .filter((i) => i.trackId === trackId && !allChangedIds.has(i.id) && i.from >= op.oldEnd)
        .sort((a, b) => a.from - b.from)

      for (const downstream of trackItems) {
        queueRippleMove(queue, freshItems, downstream.id, (from) => from + growth)
      }
    }
  }
}

function applyRateStretchOp(
  itemsStore: ReturnType<typeof useItemsStore.getState>,
  op: RateStretchOp,
): void {
  const anchor = itemsStore.items.find((i) => i.id === op.id)
  if (!anchor) return

  const oldDuration = anchor.durationInFrames
  itemsStore._rateStretchItem(op.id, anchor.from, op.newDuration, 1)

  // Synchronize linked items
  const anchorAfter = useItemsStore.getState().itemById[op.id]
  if (!anchorAfter) return

  const actualDuration = anchorAfter.durationInFrames
  const fromDelta = anchorAfter.from - anchor.from

  for (const siId of op.synchronizedIds) {
    if (siId === op.id) continue
    const si = useItemsStore.getState().items.find((i) => i.id === siId)
    if (!si) continue
    itemsStore._rateStretchItem(siId, si.from + fromDelta, actualDuration, anchorAfter.speed ?? 1)
  }

  // Scale keyframes
  if (oldDuration !== actualDuration) {
    for (const siId of op.synchronizedIds) {
      useKeyframesStore.getState()._scaleKeyframesForItem(siId, oldDuration, actualDuration)
    }
  }
}

export function rateStretchItemWithoutHistory(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number,
): void {
  const itemsStore = useItemsStore.getState()
  const itemsBefore = itemsStore.items
  const synchronizedItems = getSynchronizedLinkedItemsForEdit(
    itemsBefore,
    id,
    isLinkedSelectionEnabled(),
  )
  const anchorBefore = synchronizedItems.find((item) => item.id === id)
  if (!anchorBefore) return

  // Capture old boundaries BEFORE stretch (needed for ripple + keyframe scaling)
  const oldDuration = anchorBefore.durationInFrames
  const oldFrom = anchorBefore.from
  const oldEnd = oldFrom + oldDuration

  itemsStore._rateStretchItem(id, newFrom, newDuration, newSpeed)

  const anchorAfter = useItemsStore.getState().itemById[id]
  if (!anchorAfter) return

  const actualFrom = anchorAfter.from
  const actualDuration = anchorAfter.durationInFrames
  const actualSpeed = anchorAfter.speed ?? newSpeed
  const fromDelta = actualFrom - anchorBefore.from

  stretchSynchronizedCompanions(
    itemsStore,
    synchronizedItems,
    id,
    fromDelta,
    actualDuration,
    actualSpeed,
  )
  scaleSynchronizedKeyframes(synchronizedItems, oldDuration, actualDuration)

  // Ripple phase: push/pull adjacent clips to maintain adjacency and prevent overlaps.
  // End handle: endDelta !== 0 → shift downstream clips.
  // Start handle: fromDelta !== 0, end stays fixed → shift upstream clips.
  const newEnd = actualFrom + actualDuration
  const endDelta = newEnd - oldEnd
  const allSynchronizedIds = new Set(synchronizedItems.map((si) => si.id))
  const freshItems = useItemsStore.getState().items
  const transitions = useTransitionsStore.getState().transitions
  const queue = createRippleMoveQueue()
  const touchedTrackIds = collectTouchedTrackIds(synchronizedItems, freshItems)

  if (endDelta !== 0) {
    shiftDownstreamForStretch({
      queue,
      freshItems,
      touchedTrackIds,
      allSynchronizedIds,
      oldEnd,
      endDelta,
    })
    shiftBridgedEndNeighborsForStretch({
      queue,
      freshItems,
      synchronizedItems,
      transitions,
      allSynchronizedIds,
      endDelta,
    })
  }

  if (fromDelta !== 0) {
    shiftUpstreamForStretch({
      queue,
      freshItems,
      touchedTrackIds,
      allSynchronizedIds,
      oldFrom,
      fromDelta,
    })
    shiftBridgedStartNeighborsForStretch({
      queue,
      freshItems,
      synchronizedItems,
      transitions,
      allSynchronizedIds,
      fromDelta,
    })
  }

  commitRippleMoveResult(allSynchronizedIds, queue)
}

export function rateStretchItem(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number,
): void {
  execute(
    'RATE_STRETCH_ITEM',
    () => {
      rateStretchItemWithoutHistory(id, newFrom, newDuration, newSpeed)
    },
    { id, newFrom, newDuration, newSpeed },
  )
}

/**
 * Reset speed to 1x for the given items and push subsequent clips right to
 * avoid overlaps. Everything happens in a single undo entry.
 *
 * When a variable-speed clip (e.g. 1.23x) is reset to 1x, it gets longer.
 * Without ripple, it would overlap the next clip on the same track. This
 * function shifts all downstream clips (and their linked companions) right
 * by the growth amount.
 */
export function resetSpeedWithRipple(itemIds: string[]): void {
  execute(
    'RESET_SPEED_WITH_RIPPLE',
    () => {
      const itemsStore = useItemsStore.getState()
      const fps = useTimelineSettingsStore.getState().fps
      const stretchOps = collectRateStretchOps(itemIds, itemsStore.items, fps)

      if (stretchOps.length === 0) return

      // Phase 1: Apply all rate stretches
      for (const op of stretchOps) {
        applyRateStretchOp(itemsStore, op)
      }

      // Phase 2: Push subsequent clips right to resolve overlaps
      const freshItems = useItemsStore.getState().items
      const allChangedIds = new Set(stretchOps.flatMap((op) => op.synchronizedIds))
      const queue = createRippleMoveQueue()
      pushStretchedItemsRight(queue, freshItems, stretchOps, allChangedIds)

      // Phase 3: Repair transitions for all affected clips
      commitRippleMoveResult(allChangedIds, queue)
    },
    { itemIds },
  )
}
