import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { execute, applyTransitionRepairs } from '../shared'
import {
  getMatchingSynchronizedLinkedCounterpartForEdit,
  getSynchronizedLinkedCounterpartPairForEdit,
  getSynchronizedLinkedItemsForEdit,
} from '../linked-edit'
import { getAttachedCaptionItemIds } from '../../../utils/linked-items'
import { computeClampedSlipDelta } from '../../../utils/slip-utils'
import { computeSlideContinuitySourceDelta } from '../../../utils/slide-utils'
import { clampSlideDeltaToPreserveKeyframes } from '../../../utils/slide-keyframe-constraints'
import { isMediaItem } from '../../../utils/source-calculations'
import {
  clampRippleTrimDeltaToPreserveEditState,
  clampRollingTrimDeltaToPreserveEditState,
} from '../../../utils/trim-edit-constraints'
import { clampToAdjacentItems, clampTrimAmount } from '../../../utils/trim-utils'
import { getTransitionLinkedIds } from '../../items-store-indexes'
import {
  clampSlideDeltaToPreserveTransitions,
  clampSlipDeltaToPreserveTransitions,
} from '../../../utils/transition-utils'
import {
  propagateInsertedGapToSyncLockedTracks,
  propagateRemovedIntervalsToSyncLockedTracks,
} from '../sync-lock-ripple'
import { isLinkedSelectionEnabled, requestPostEditWarmForItems } from './shared'
import type { TimelineItem } from '@/types/timeline'

function keepTightestDelta(requested: number, candidate: number): number {
  return requested < 0 ? Math.max(requested, candidate) : Math.min(requested, candidate)
}

interface SynchronizedTrimOptions {
  forceLinked?: boolean
  itemIds?: readonly string[]
}

function getSynchronizedTrimItems(
  items: TimelineItem[],
  anchorId: string,
  options: SynchronizedTrimOptions,
): TimelineItem[] {
  const linkedSelectionEnabled = options.forceLinked === true || isLinkedSelectionEnabled()
  const requestedIds = [
    anchorId,
    ...(options.itemIds ?? []).filter((itemId) => itemId !== anchorId),
  ]
  const synchronizedById = new Map<string, TimelineItem>()

  if (options.itemIds !== undefined) {
    const itemById = new Map(items.map((item) => [item.id, item]))
    for (const requestedId of requestedIds) {
      const requestedItem = itemById.get(requestedId)
      if (requestedItem) synchronizedById.set(requestedItem.id, requestedItem)
    }
    return Array.from(synchronizedById.values())
  }

  for (const requestedId of requestedIds) {
    for (const synchronizedItem of getSynchronizedLinkedItemsForEdit(
      items,
      requestedId,
      linkedSelectionEnabled,
    )) {
      synchronizedById.set(synchronizedItem.id, synchronizedItem)
    }
  }

  return Array.from(synchronizedById.values())
}

function clampSlideParticipantDelta(
  requestedDelta: number,
  item: TimelineItem,
  leftNeighbor: TimelineItem | null,
  rightNeighbor: TimelineItem | null,
  items: TimelineItem[],
  timelineFps: number,
): number {
  let clamped = Math.max(requestedDelta, -item.from)
  const excludedIds = new Set(
    [item.id, leftNeighbor?.id, rightNeighbor?.id].filter(Boolean) as string[],
  )

  if (leftNeighbor) {
    const sourceClamped = clampTrimAmount(leftNeighbor, 'end', clamped, timelineFps).clampedAmount
    clamped = keepTightestDelta(clamped, sourceClamped)
    clamped = keepTightestDelta(
      clamped,
      clampToAdjacentItems(leftNeighbor, 'end', clamped, items, excludedIds),
    )
  }
  if (rightNeighbor) {
    const sourceClamped = clampTrimAmount(
      rightNeighbor,
      'start',
      clamped,
      timelineFps,
    ).clampedAmount
    clamped = keepTightestDelta(clamped, sourceClamped)
    clamped = keepTightestDelta(
      clamped,
      clampToAdjacentItems(rightNeighbor, 'start', clamped, items, excludedIds),
    )
  }

  for (const other of items) {
    if (other.trackId !== item.trackId || excludedIds.has(other.id)) continue
    const otherEnd = other.from + other.durationInFrames
    if (otherEnd <= item.from && clamped < 0) {
      clamped = Math.max(clamped, otherEnd - item.from)
    }
    const itemEnd = item.from + item.durationInFrames
    if (other.from >= itemEnd && clamped > 0) {
      clamped = Math.min(clamped, other.from - itemEnd)
    }
  }

  return clamped
}

function trimAttachedCaptionsToClipBounds(clipIds: Iterable<string>): string[] {
  const store = useItemsStore.getState()
  const items = store.items
  const captionUpdates: Array<{ id: string; from: number; durationInFrames: number }> = []
  const captionIdsToRemove = new Set<string>()

  for (const clipId of clipIds) {
    const clip = store.itemById[clipId]
    if (!clip || clip.type === 'text') continue

    const clipStart = clip.from
    const clipEnd = clip.from + clip.durationInFrames
    for (const captionId of getAttachedCaptionItemIds(items, clipId)) {
      const caption = store.itemById[captionId]
      if (!caption || caption.type !== 'text') continue

      const captionStart = caption.from
      const captionEnd = caption.from + caption.durationInFrames
      const nextStart = Math.max(captionStart, clipStart)
      const nextEnd = Math.min(captionEnd, clipEnd)

      if (nextEnd <= nextStart) {
        captionIdsToRemove.add(caption.id)
        continue
      }

      const nextDuration = nextEnd - nextStart
      if (nextStart !== caption.from || nextDuration !== caption.durationInFrames) {
        captionUpdates.push({
          id: caption.id,
          from: nextStart,
          durationInFrames: nextDuration,
        })
      }
    }
  }

  if (captionIdsToRemove.size > 0) {
    const removedIds = Array.from(captionIdsToRemove)
    store._removeItems(removedIds)
    useKeyframesStore.getState()._removeKeyframesForItems(removedIds)
  }

  for (const update of captionUpdates) {
    if (captionIdsToRemove.has(update.id)) continue
    store._updateItem(update.id, {
      from: update.from,
      durationInFrames: update.durationInFrames,
    })
  }

  return [...captionUpdates.map((update) => update.id), ...captionIdsToRemove]
}

function applySynchronizedTrim(
  id: string,
  handle: 'start' | 'end',
  trimAmount: number,
  options: SynchronizedTrimOptions,
): void {
  const itemsStore = useItemsStore.getState()
  const itemsBefore = itemsStore.items
  const synchronizedItems = getSynchronizedTrimItems(itemsBefore, id, options)
  const anchorBefore = synchronizedItems.find((item) => item.id === id)
  if (!anchorBefore) return

  const timelineFps = useTimelineSettingsStore.getState().fps
  let synchronizedTrimAmount = trimAmount
  for (const synchronizedItem of synchronizedItems) {
    const sourceClampedAmount = clampTrimAmount(
      synchronizedItem,
      handle,
      synchronizedTrimAmount,
      timelineFps,
    ).clampedAmount
    synchronizedTrimAmount = keepTightestDelta(
      synchronizedTrimAmount,
      clampToAdjacentItems(
        synchronizedItem,
        handle,
        sourceClampedAmount,
        itemsBefore,
        getTransitionLinkedIds(synchronizedItem.id),
      ),
    )
  }

  if (handle === 'start') {
    itemsStore._trimItemStart(id, synchronizedTrimAmount, { skipAdjacentClamp: true })
  } else {
    itemsStore._trimItemEnd(id, synchronizedTrimAmount, { skipAdjacentClamp: true })
  }

  const anchorAfter = useItemsStore.getState().itemById[id]
  const actualTrimAmount =
    handle === 'start'
      ? anchorAfter
        ? anchorAfter.from - anchorBefore.from
        : 0
      : anchorAfter
        ? anchorAfter.durationInFrames - anchorBefore.durationInFrames
        : 0

  if (actualTrimAmount !== 0) {
    for (const synchronizedItem of synchronizedItems) {
      if (synchronizedItem.id === id) continue

      if (handle === 'start') {
        itemsStore._trimItemStart(synchronizedItem.id, actualTrimAmount, {
          skipAdjacentClamp: true,
        })
      } else {
        itemsStore._trimItemEnd(synchronizedItem.id, actualTrimAmount, { skipAdjacentClamp: true })
      }
    }
  }

  const didShrink = handle === 'start' ? actualTrimAmount > 0 : actualTrimAmount < 0
  const affectedCaptionIds = didShrink
    ? trimAttachedCaptionsToClipBounds(synchronizedItems.map((item) => item.id))
    : []
  const affectedIds = synchronizedItems.map((item) => item.id)
  applyTransitionRepairs(affectedIds)
  requestPostEditWarmForItems([...affectedIds, ...affectedCaptionIds])
  useTimelineSettingsStore.getState().markDirty()
}

export function trimItemStart(
  id: string,
  trimAmount: number,
  options: SynchronizedTrimOptions = {},
): void {
  execute(
    'TRIM_ITEM_START',
    () => {
      applySynchronizedTrim(id, 'start', trimAmount, options)
    },
    { id, trimAmount, itemIds: options.itemIds },
  )
}

export function trimItemEnd(
  id: string,
  trimAmount: number,
  options: SynchronizedTrimOptions = {},
): void {
  execute(
    'TRIM_ITEM_END',
    () => {
      applySynchronizedTrim(id, 'end', trimAmount, options)
    },
    { id, trimAmount, itemIds: options.itemIds },
  )
}

export function trimItemBreakingTransition(
  id: string,
  handle: 'start' | 'end',
  trimAmount: number,
  transitionIdsToRemove: string[],
  options: Pick<SynchronizedTrimOptions, 'itemIds'> = {},
): void {
  execute(
    handle === 'start' ? 'TRIM_ITEM_START' : 'TRIM_ITEM_END',
    () => {
      if (transitionIdsToRemove.length > 0) {
        useTransitionsStore.getState()._removeTransitions(transitionIdsToRemove)
      }

      applySynchronizedTrim(id, handle, trimAmount, options)
    },
    {
      id,
      handle,
      trimAmount,
      itemIds: options.itemIds,
      removedTransitionCount: transitionIdsToRemove.length,
    },
  )
}

/**
 * Ripple edit: trim a clip and shift all downstream items on the same track.
 *
 * Unlike normal trim which leaves gaps, ripple edit closes or opens gaps by
 * shifting everything after the trim point.
 *
 * End handle: trims the end, shifts downstream items by the change in end position.
 * Start handle: trims the start (changes source/duration), then moves the trimmed
 *   clip back to its original `from` and shifts downstream items by the duration change.
 *
 * @param id - ID of the clip being trimmed
 * @param handle - Which handle is being dragged ('start' or 'end')
 * @param trimDelta - Frames to trim (positive = shrink start / extend end,
 *                    negative = extend start / shrink end)
 */
export function rippleTrimItem(id: string, handle: 'start' | 'end', trimDelta: number): void {
  if (trimDelta === 0) return
  execute(
    'RIPPLE_EDIT',
    () => {
      const store = useItemsStore.getState()
      const item = store.items.find((candidate) => candidate.id === id)
      if (!item) return
      const synced = getSynchronizedLinkedItemsForEdit(store.items, id, isLinkedSelectionEnabled())
      const syncedIds = new Set(synced.map((candidate) => candidate.id))
      const oldById = new Map(synced.map((candidate) => [candidate.id, candidate]))
      const transitions = useTransitionsStore.getState().transitions
      const keyframesByItemId = useKeyframesStore.getState().keyframesByItemId
      const timelineFps = useTimelineSettingsStore.getState().fps
      let clampedTrimDelta = trimDelta
      for (const syncedItem of synced) {
        clampedTrimDelta = keepTightestDelta(
          clampedTrimDelta,
          clampRippleTrimDeltaToPreserveEditState(
            syncedItem,
            handle,
            clampedTrimDelta,
            store.items,
            transitions,
            keyframesByItemId,
            timelineFps,
            syncedIds,
            false,
          ),
        )
      }
      if (clampedTrimDelta === 0) return
      const oldFrom = item.from
      const oldEnd = item.from + item.durationInFrames
      if (handle === 'start')
        store._trimItemStart(id, clampedTrimDelta, { skipAdjacentClamp: true })
      else store._trimItemEnd(id, clampedTrimDelta, { skipAdjacentClamp: true })
      const trimmed = useItemsStore.getState().itemById[id]
      if (!trimmed) return
      let shift = 0
      let interval: { start: number; end: number } | null = null
      let insertAt: number | null = null
      if (handle === 'end') {
        const newEnd = trimmed.from + trimmed.durationInFrames
        shift = newEnd - oldEnd
        if (shift < 0) interval = { start: newEnd, end: oldEnd }
        else if (shift > 0) insertAt = oldEnd
        for (const syncedItem of synced) {
          if (syncedItem.id !== id && shift !== 0) {
            store._trimItemEnd(syncedItem.id, shift, { skipAdjacentClamp: true })
          }
        }
      } else {
        const actual = trimmed.from - oldFrom
        if (actual !== 0) {
          store._moveItem(id, oldFrom)
          for (const syncedItem of synced) {
            if (syncedItem.id === id) continue
            store._trimItemStart(syncedItem.id, actual, { skipAdjacentClamp: true })
            const before = oldById.get(syncedItem.id)
            if (before) store._moveItem(syncedItem.id, before.from)
          }
        }
        shift = -actual
        if (shift < 0) interval = { start: oldEnd + shift, end: oldEnd }
        else if (shift > 0) insertAt = oldEnd
      }
      let lockedAffected: string[] = []
      let lockedRemoved: string[] = []
      if (shift !== 0) {
        const fresh = useItemsStore.getState().items
        const deltas = new Map<string, number>()
        for (const syncedItem of synced) {
          const before = oldById.get(syncedItem.id)
          if (!before) continue
          const oldSyncedEnd = before.from + before.durationInFrames
          const neighbors = new Set<string>()
          for (const transition of transitions) {
            if (transition.leftClipId === syncedItem.id) neighbors.add(transition.rightClipId)
          }
          for (const candidate of fresh) {
            if (syncedIds.has(candidate.id) || candidate.trackId !== before.trackId) continue
            if (candidate.from >= oldSyncedEnd || neighbors.has(candidate.id))
              deltas.set(candidate.id, shift)
          }
        }
        const updates = fresh.flatMap((candidate) => {
          const delta = deltas.get(candidate.id) ?? 0
          return delta === 0 ? [] : [{ id: candidate.id, from: candidate.from + delta }]
        })
        if (updates.length > 0) store._moveItems(updates)
        const editedTracks = new Set(synced.map((candidate) => candidate.trackId))
        if (interval) {
          const result = propagateRemovedIntervalsToSyncLockedTracks({
            editedTrackIds: editedTracks,
            intervals: [interval],
          })
          lockedAffected = result.affectedIds
          lockedRemoved = result.removedIds
        } else if (insertAt !== null) {
          const result = propagateInsertedGapToSyncLockedTracks({
            editedTrackIds: editedTracks,
            cutFrame: insertAt,
            amount: shift,
          })
          lockedAffected = result.affectedIds
        }
      }
      const final = useItemsStore.getState().items
      const affected = Array.from(
        new Set([
          ...synced.map((candidate) => candidate.id),
          ...lockedAffected,
          ...final
            .filter(
              (candidate) =>
                !syncedIds.has(candidate.id) &&
                synced.some(
                  (syncedItem) =>
                    candidate.trackId === syncedItem.trackId && candidate.from >= syncedItem.from,
                ),
            )
            .map((candidate) => candidate.id),
        ]),
      )
      if (lockedRemoved.length > 0) {
        useTransitionsStore.getState()._removeTransitionsForItems(lockedRemoved)
        useKeyframesStore.getState()._removeKeyframesForItems(lockedRemoved)
      }
      applyTransitionRepairs(
        affected,
        lockedRemoved.length > 0 ? new Set(lockedRemoved) : undefined,
      )
      requestPostEditWarmForItems(affected)
      useTimelineSettingsStore.getState().markDirty()
    },
    { id, handle, trimDelta },
  )
}

/**
 * Rolling edit
 * Trims the left clip's end and the right clip's start by the same amount,
 * keeping total timeline duration unchanged.
 *
 * @param leftId - ID of the left clip (its end edge is being adjusted)
 * @param rightId - ID of the right clip (its start edge is being adjusted)
 * @param editPointDelta - Frames to move the edit point (positive = right, negative = left)
 */
export function rollingTrimItems(leftId: string, rightId: string, editPointDelta: number): void {
  if (editPointDelta === 0) return

  execute(
    'ROLLING_EDIT',
    () => {
      const itemsStore = useItemsStore.getState()
      const itemsBefore = itemsStore.items
      const counterpartPair = getSynchronizedLinkedCounterpartPairForEdit(
        itemsBefore,
        leftId,
        rightId,
        isLinkedSelectionEnabled(),
      )
      const rightBefore = itemsBefore.find((item) => item.id === rightId)
      const leftBefore = itemsBefore.find((item) => item.id === leftId)
      if (!leftBefore || !rightBefore) return
      const transitions = useTransitionsStore.getState().transitions
      const keyframesByItemId = useKeyframesStore.getState().keyframesByItemId
      const timelineFps = useTimelineSettingsStore.getState().fps
      let clampedEditPointDelta = clampRollingTrimDeltaToPreserveEditState(
        leftBefore,
        'end',
        editPointDelta,
        rightBefore,
        itemsBefore,
        transitions,
        keyframesByItemId,
        timelineFps,
        false,
      )
      if (counterpartPair) {
        clampedEditPointDelta = keepTightestDelta(
          clampedEditPointDelta,
          clampRollingTrimDeltaToPreserveEditState(
            counterpartPair.leftCounterpart,
            'end',
            clampedEditPointDelta,
            counterpartPair.rightCounterpart,
            itemsBefore,
            transitions,
            keyframesByItemId,
            timelineFps,
            false,
          ),
        )
      }
      if (clampedEditPointDelta === 0) return

      // Order matters: shrink first, then extend. The internal _trimItemEnd/_trimItemStart
      // methods have clampToAdjacentItems guards that prevent extending into a neighbor.
      // By shrinking the losing clip first, we free up space for the gaining clip to extend into.
      if (clampedEditPointDelta > 0) {
        // Edit point moves right: right clip shrinks (frees space), then left clip extends
        itemsStore._trimItemStart(rightId, clampedEditPointDelta)
        itemsStore._trimItemEnd(leftId, clampedEditPointDelta)
      } else {
        // Edit point moves left: left clip shrinks (frees space), then right clip extends
        itemsStore._trimItemEnd(leftId, clampedEditPointDelta)
        itemsStore._trimItemStart(rightId, clampedEditPointDelta)
      }

      const rightAfter = useItemsStore.getState().itemById[rightId]
      const actualDelta = rightAfter ? rightAfter.from - rightBefore.from : 0

      if (counterpartPair && actualDelta !== 0) {
        if (actualDelta > 0) {
          itemsStore._trimItemStart(counterpartPair.rightCounterpart.id, actualDelta, {
            skipAdjacentClamp: true,
          })
          itemsStore._trimItemEnd(counterpartPair.leftCounterpart.id, actualDelta, {
            skipAdjacentClamp: true,
          })
        } else {
          itemsStore._trimItemEnd(counterpartPair.leftCounterpart.id, actualDelta, {
            skipAdjacentClamp: true,
          })
          itemsStore._trimItemStart(counterpartPair.rightCounterpart.id, actualDelta, {
            skipAdjacentClamp: true,
          })
        }
      }

      // Repair transitions for both clips
      const affectedIds = counterpartPair
        ? [leftId, rightId, counterpartPair.leftCounterpart.id, counterpartPair.rightCounterpart.id]
        : [leftId, rightId]
      applyTransitionRepairs(affectedIds)
      requestPostEditWarmForItems(affectedIds)

      useTimelineSettingsStore.getState().markDirty()
    },
    { leftId, rightId, editPointDelta },
  )
}

/**
 * Slip edit: shift the source window (sourceStart/sourceEnd) within a clip
 * without changing its position or duration on the timeline.
 *
 * Only works on video/audio items that have explicit source bounds.
 *
 * @param id - ID of the clip to slip
 * @param slipDelta - Frames to shift the source window (positive = later in source, negative = earlier)
 */
export function slipItem(id: string, slipDelta: number): void {
  if (slipDelta === 0) return

  execute(
    'SLIP_EDIT',
    () => {
      const itemsStore = useItemsStore.getState()
      const items = itemsStore.items
      const item = items.find((i) => i.id === id)
      if (!item) return
      if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') return
      const synchronizedItems = getSynchronizedLinkedItemsForEdit(
        items,
        id,
        isLinkedSelectionEnabled(),
      )

      const sourceStart = item.sourceStart ?? 0
      const sourceEnd = item.sourceEnd
      if (sourceEnd === undefined) return

      const transitions = useTransitionsStore.getState().transitions
      const timelineFps = useTimelineSettingsStore.getState().fps
      let clamped = slipDelta
      for (const synchronizedItem of synchronizedItems) {
        clamped = computeClampedSlipDelta(
          synchronizedItem.sourceStart ?? 0,
          synchronizedItem.sourceEnd,
          synchronizedItem.sourceDuration,
          clamped,
        )
        clamped = clampSlipDeltaToPreserveTransitions(
          synchronizedItem,
          clamped,
          items,
          transitions,
          timelineFps,
        )
      }

      if (clamped === 0) return

      itemsStore._updateItem(id, {
        sourceStart: sourceStart + clamped,
        sourceEnd: sourceEnd + clamped,
      })

      for (const synchronizedItem of synchronizedItems) {
        if (synchronizedItem.id === id || synchronizedItem.sourceEnd === undefined) continue
        itemsStore._updateItem(synchronizedItem.id, {
          sourceStart: (synchronizedItem.sourceStart ?? 0) + clamped,
          sourceEnd: synchronizedItem.sourceEnd + clamped,
        })
      }

      const affectedIds = synchronizedItems.map((synchronizedItem) => synchronizedItem.id)
      applyTransitionRepairs(affectedIds)
      requestPostEditWarmForItems(affectedIds)

      useTimelineSettingsStore.getState().markDirty()
    },
    { id, slipDelta },
  )
}

/**
 * Slide edit: move a clip on the timeline while adjusting its neighboring clips.
 * The left neighbor's end extends/shrinks and the right neighbor's start extends/shrinks,
 * keeping total timeline duration unchanged.
 *
 * @param id - ID of the clip being slid
 * @param slideDelta - Frames to slide (positive = right, negative = left)
 * @param leftNeighborId - ID of the left adjacent clip (null if none)
 * @param rightNeighborId - ID of the right adjacent clip (null if none)
 */
export function slideItem(
  id: string,
  slideDelta: number,
  leftNeighborId: string | null,
  rightNeighborId: string | null,
): void {
  if (slideDelta === 0) return

  execute(
    'SLIDE_EDIT',
    () => {
      const itemsStore = useItemsStore.getState()
      const items = itemsStore.items
      const transitions = useTransitionsStore.getState().transitions
      // Verify the target clip exists before mutating neighbors
      const item = items.find((i) => i.id === id)
      if (!item) return
      const leftNeighbor = leftNeighborId
        ? (items.find((i) => i.id === leftNeighborId) ?? null)
        : null
      const rightNeighbor = rightNeighborId
        ? (items.find((i) => i.id === rightNeighborId) ?? null)
        : null
      const synchronizedCounterpart =
        getSynchronizedLinkedItemsForEdit(items, id, isLinkedSelectionEnabled()).find(
          (candidate) => candidate.id !== id,
        ) ?? null
      const leftCounterpart =
        synchronizedCounterpart && leftNeighborId
          ? getMatchingSynchronizedLinkedCounterpartForEdit(
              items,
              leftNeighborId,
              synchronizedCounterpart.trackId,
              synchronizedCounterpart.type,
              isLinkedSelectionEnabled(),
            )
          : null
      const rightCounterpart =
        synchronizedCounterpart && rightNeighborId
          ? getMatchingSynchronizedLinkedCounterpartForEdit(
              items,
              rightNeighborId,
              synchronizedCounterpart.trackId,
              synchronizedCounterpart.type,
              isLinkedSelectionEnabled(),
            )
          : null
      const counterpartEnd = synchronizedCounterpart
        ? synchronizedCounterpart.from + synchronizedCounterpart.durationInFrames
        : 0
      const cpLeftAdj = synchronizedCounterpart
        ? (items.find(
            (candidate) =>
              candidate.trackId === synchronizedCounterpart.trackId &&
              candidate.id !== synchronizedCounterpart.id &&
              candidate.from + candidate.durationInFrames === synchronizedCounterpart.from,
          ) ?? leftCounterpart)
        : null
      const cpRightAdj = synchronizedCounterpart
        ? (items.find(
            (candidate) =>
              candidate.trackId === synchronizedCounterpart.trackId &&
              candidate.id !== synchronizedCounterpart.id &&
              candidate.from === counterpartEnd,
          ) ?? rightCounterpart)
        : null
      const timelineFps = useTimelineSettingsStore.getState().fps
      let clampedSlideDelta = clampSlideParticipantDelta(
        slideDelta,
        item,
        leftNeighbor,
        rightNeighbor,
        items,
        timelineFps,
      )
      if (synchronizedCounterpart) {
        clampedSlideDelta = clampSlideParticipantDelta(
          clampedSlideDelta,
          synchronizedCounterpart,
          cpLeftAdj,
          cpRightAdj,
          items,
          timelineFps,
        )
      }
      clampedSlideDelta = clampSlideDeltaToPreserveTransitions(
        item,
        clampedSlideDelta,
        leftNeighbor,
        rightNeighbor,
        items,
        transitions,
        timelineFps,
      )
      if (synchronizedCounterpart) {
        clampedSlideDelta = clampSlideDeltaToPreserveTransitions(
          synchronizedCounterpart,
          clampedSlideDelta,
          cpLeftAdj,
          cpRightAdj,
          items,
          transitions,
          timelineFps,
        )
      }
      clampedSlideDelta = clampSlideDeltaToPreserveKeyframes(
        clampedSlideDelta,
        [
          { item, leftNeighbor, rightNeighbor },
          ...(synchronizedCounterpart
            ? [
                {
                  item: synchronizedCounterpart,
                  leftNeighbor: cpLeftAdj,
                  rightNeighbor: cpRightAdj,
                },
              ]
            : []),
        ],
        transitions,
        useKeyframesStore.getState().keyframesByItemId,
      )
      if (clampedSlideDelta === 0) return
      const itemFromBefore = item.from
      const itemSourceStartBefore = item.sourceStart ?? 0

      // For split-contiguous A-B-C chains, preserve source continuity by shifting
      // the slid clip's source window by the same source-space delta as slide.
      const continuitySourceDelta = computeSlideContinuitySourceDelta(
        item,
        leftNeighbor,
        rightNeighbor,
        clampedSlideDelta,
        timelineFps,
      )

      // Adjust neighbors (order: shrink first, then extend — same as rolling edit)
      if (clampedSlideDelta > 0) {
        // Sliding right: right neighbor shrinks start (frees space), left neighbor extends end
        if (rightNeighborId) {
          itemsStore._trimItemStart(rightNeighborId, clampedSlideDelta, { skipAdjacentClamp: true })
        }
        if (leftNeighborId) {
          itemsStore._trimItemEnd(leftNeighborId, clampedSlideDelta, { skipAdjacentClamp: true })
        }
      } else {
        // Sliding left: left neighbor shrinks end (frees space), right neighbor extends start
        if (leftNeighborId) {
          itemsStore._trimItemEnd(leftNeighborId, clampedSlideDelta, { skipAdjacentClamp: true })
        }
        if (rightNeighborId) {
          itemsStore._trimItemStart(rightNeighborId, clampedSlideDelta, { skipAdjacentClamp: true })
        }
      }

      // Move the slid clip
      itemsStore._moveItem(id, item.from + clampedSlideDelta)
      if (
        continuitySourceDelta !== 0 &&
        (item.type === 'video' || item.type === 'audio' || item.type === 'composition') &&
        item.sourceEnd !== undefined
      ) {
        itemsStore._updateItem(id, {
          sourceStart: (item.sourceStart ?? 0) + continuitySourceDelta,
          sourceEnd: item.sourceEnd + continuitySourceDelta,
        })
      }

      const updatedItem = useItemsStore.getState().itemById[id]
      const actualSlideDelta = updatedItem ? updatedItem.from - itemFromBefore : 0
      const actualSourceDelta =
        updatedItem && updatedItem.sourceStart !== undefined
          ? updatedItem.sourceStart - itemSourceStartBefore
          : 0

      // Find the companion's own adjacent neighbors — may differ from the
      // primary's linked counterparts (e.g. a solo audio clip next to the
      // companion that has no video counterpart).
      if (synchronizedCounterpart && actualSlideDelta !== 0) {
        if (actualSlideDelta > 0) {
          if (cpRightAdj) {
            itemsStore._trimItemStart(cpRightAdj.id, actualSlideDelta, { skipAdjacentClamp: true })
          }
          if (cpLeftAdj) {
            itemsStore._trimItemEnd(cpLeftAdj.id, actualSlideDelta, { skipAdjacentClamp: true })
          }
        } else {
          if (cpLeftAdj) {
            itemsStore._trimItemEnd(cpLeftAdj.id, actualSlideDelta, { skipAdjacentClamp: true })
          }
          if (cpRightAdj) {
            itemsStore._trimItemStart(cpRightAdj.id, actualSlideDelta, { skipAdjacentClamp: true })
          }
        }

        itemsStore._moveItem(
          synchronizedCounterpart.id,
          synchronizedCounterpart.from + actualSlideDelta,
        )
        if (
          actualSourceDelta !== 0 &&
          isMediaItem(synchronizedCounterpart) &&
          synchronizedCounterpart.sourceEnd !== undefined
        ) {
          itemsStore._updateItem(synchronizedCounterpart.id, {
            sourceStart: (synchronizedCounterpart.sourceStart ?? 0) + actualSourceDelta,
            sourceEnd: synchronizedCounterpart.sourceEnd + actualSourceDelta,
          })
        }
      }

      // Repair transitions for all affected items
      const affectedIds = [id]
      if (leftNeighborId) affectedIds.push(leftNeighborId)
      if (rightNeighborId) affectedIds.push(rightNeighborId)
      if (synchronizedCounterpart) {
        affectedIds.push(synchronizedCounterpart.id)
        if (cpLeftAdj) affectedIds.push(cpLeftAdj.id)
        if (cpRightAdj) affectedIds.push(cpRightAdj.id)
      }
      applyTransitionRepairs(affectedIds)
      requestPostEditWarmForItems(affectedIds)

      useTimelineSettingsStore.getState().markDirty()
    },
    { id, slideDelta, leftNeighborId, rightNeighborId },
  )
}
