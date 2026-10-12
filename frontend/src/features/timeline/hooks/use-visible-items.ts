import { useCallback, useEffect, useState, useRef, useSyncExternalStore } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useItemsStore } from '../stores/items-store'
import { useTransitionsStore } from '../stores/transitions-store'
import {
  DEFAULT_TIMELINE_ITEM_CULL_BUFFER_PX,
  DENSE_TIMELINE_TRACK_ITEM_THRESHOLD,
  getTimelineItemCullBufferPx,
} from '../utils/timeline-dom-density'
import { getTimelineItemsForFrameRange } from '../utils/timeline-item-range-index'

/**
 * Pixels of buffer beyond viewport edges for mounting items.
 * 2000px mounts clips well before they enter the viewport, so the mount
 * jank (~100-170ms per clip) happens while the user is looking at content
 * further from the edge. Dense tracks use a smaller stable buffer because
 * their narrow clips remain lightweight DOM shells; mounting thousands of
 * offscreen shells makes every real-pixel zoom layout unnecessarily expensive.
 */

/**
 * Inner buffer (pixels) — recomputation is skipped when the visible frame
 * range shifts by less than this amount. Avoids filtering items/transitions
 * on small scroll deltas that can't change the result. Must be smaller
 * than the active cull buffer to guarantee items mount before they enter the
 * viewport.
 */
const HYSTERESIS_PX = 800
const DEFAULT_CULL_CONTRACTION_QUIET_MS = 600
const DENSE_CULL_CONTRACTION_QUIET_MS = 120

/** Sentinel arrays to avoid re-renders when track has no items */
const EMPTY_TRANSITIONS: Transition[] = []

export interface VisibleFrameRange {
  start: number
  end: number
}

interface VisibleItemsSnapshot {
  visibleItems: TimelineItem[]
  visibleTransitions: Transition[]
}

const detailRangeByTrackId = new Map<string, VisibleFrameRange>()
const detailRangeListenersByTrackId = new Map<string, Set<() => void>>()

function areVisibleRangesEqual(
  previousRange: VisibleFrameRange,
  nextRange: VisibleFrameRange,
): boolean {
  return previousRange.start === nextRange.start && previousRange.end === nextRange.end
}

function publishDetailRange(trackId: string, range: VisibleFrameRange) {
  const previousRange = detailRangeByTrackId.get(trackId)
  if (previousRange && areVisibleRangesEqual(previousRange, range)) {
    return
  }

  detailRangeByTrackId.set(trackId, range)
  for (const listener of detailRangeListenersByTrackId.get(trackId) ?? []) {
    listener()
  }
}

function subscribeToDetailRange(trackId: string, listener: () => void): () => void {
  let listeners = detailRangeListenersByTrackId.get(trackId)
  if (!listeners) {
    listeners = new Set()
    detailRangeListenersByTrackId.set(trackId, listeners)
  }
  listeners.add(listener)
  publishDetailRange(trackId, computeCurrentDetailRange(trackId))

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      detailRangeListenersByTrackId.delete(trackId)
      detailRangeByTrackId.delete(trackId)
    }
  }
}

function getHysteresisFrames(pixelsPerSecond: number, fps: number, cullBufferPx: number): number {
  const hysteresisPx = Math.min(HYSTERESIS_PX, cullBufferPx * 0.4)
  return fps > 0 && pixelsPerSecond > 0 ? (hysteresisPx / pixelsPerSecond) * fps : 0
}

function shouldExpandMountedRange(
  previousRange: VisibleFrameRange,
  nextRange: VisibleFrameRange,
  hysteresisFrames: number,
): boolean {
  return (
    nextRange.start < previousRange.start - hysteresisFrames ||
    nextRange.end > previousRange.end + hysteresisFrames
  )
}

function mergeVisibleRanges(
  previousRange: VisibleFrameRange,
  nextRange: VisibleFrameRange,
): VisibleFrameRange {
  return {
    start: Math.min(previousRange.start, nextRange.start),
    end: Math.max(previousRange.end, nextRange.end),
  }
}

function visibleRangeContains(
  outerRange: VisibleFrameRange,
  innerRange: VisibleFrameRange,
): boolean {
  return outerRange.start <= innerRange.start && outerRange.end >= innerRange.end
}

function visibleRangesOverlap(
  firstRange: VisibleFrameRange,
  secondRange: VisibleFrameRange,
): boolean {
  return firstRange.end > secondRange.start && secondRange.end > firstRange.start
}

/**
 * Grow `current` toward `target` (a superset) by at most `maxAdd` clips,
 * choosing the clips nearest the current edges first. Returns `target` (and the
 * exact count added) when the remaining clips fit within `maxAdd`. Lets a
 * zoom-out gesture trickle clip mounts a few per frame instead of mounting a
 * whole cluster in one commit.
 */
function expandRangeByClipBudget(
  items: TimelineItem[] | undefined,
  current: VisibleFrameRange,
  target: VisibleFrameRange,
  maxAdd: number,
): { range: VisibleFrameRange; added: number } {
  if (!items || items.length === 0) return { range: target, added: 0 }

  const currentItems = getTimelineItemsForFrameRange(items, current)
  const currentItemIds = new Set(currentItems.map((item) => item.id))
  const targetItems = getTimelineItemsForFrameRange(items, target)
  const candidates: { start: number; end: number; distance: number }[] = []
  for (const item of targetItems) {
    const itemStart = item.from
    const itemEnd = item.from + item.durationInFrames
    if (currentItemIds.has(item.id)) continue
    const distance = itemStart >= current.end ? itemStart - current.end : current.start - itemEnd
    candidates.push({ start: itemStart, end: itemEnd, distance })
  }

  if (candidates.length <= maxAdd) {
    const added = Math.max(0, targetItems.length - currentItems.length)
    return { range: target, added }
  }

  candidates.sort((a, b) => a.distance - b.distance)
  let start = current.start
  let end = current.end
  for (let index = 0; index < maxAdd; index++) {
    const candidate = candidates[index]!
    if (candidate.start < start) start = candidate.start
    if (candidate.end > end) end = candidate.end
  }
  const range = { start, end }
  const added = Math.max(
    0,
    getTimelineItemsForFrameRange(items, range).length - currentItems.length,
  )
  return { range, added }
}

/**
 * Shrink `current` toward `target` (a subset) by at most `maxRemove` clips.
 * Clips furthest from the final viewport retire first. Keeping the intermediate
 * range contiguous means transition filtering and the next scroll event can
 * continue using the same range model.
 */
function contractRangeByClipBudget(
  items: TimelineItem[] | undefined,
  current: VisibleFrameRange,
  target: VisibleFrameRange,
  maxRemove: number,
): { range: VisibleFrameRange; removed: number } {
  if (!items || items.length === 0) return { range: target, removed: 0 }

  const currentItems = getTimelineItemsForFrameRange(items, current)
  const targetItems = getTimelineItemsForFrameRange(items, target)
  const targetItemIds = new Set(targetItems.map((item) => item.id))
  const leftCandidates: { boundary: number; distance: number }[] = []
  const rightCandidates: { boundary: number; distance: number }[] = []
  for (const item of currentItems) {
    const itemStart = item.from
    const itemEnd = item.from + item.durationInFrames
    if (targetItemIds.has(item.id)) continue

    if (itemEnd <= target.start) {
      leftCandidates.push({
        boundary: itemEnd,
        distance: target.start - itemEnd,
      })
    } else if (itemStart >= target.end) {
      rightCandidates.push({
        boundary: itemStart,
        distance: itemStart - target.end,
      })
    }
  }

  const candidateCount = leftCandidates.length + rightCandidates.length
  if (candidateCount <= maxRemove) {
    const removed = Math.max(0, currentItems.length - targetItems.length)
    return { range: target, removed }
  }

  leftCandidates.sort((a, b) => b.distance - a.distance)
  rightCandidates.sort((a, b) => b.distance - a.distance)

  let start = current.start
  let end = current.end
  let removed = 0
  while (removed < maxRemove) {
    const left = leftCandidates[0]
    const right = rightCandidates[0]
    if (!left && !right) break

    if (left && (!right || left.distance >= right.distance)) {
      leftCandidates.shift()
      start = Math.max(start, left.boundary)
    } else if (right) {
      rightCandidates.shift()
      end = Math.min(end, right.boundary)
    }
    removed++
  }

  const range = { start, end }
  const actualRemoved = Math.max(
    0,
    currentItems.length - getTimelineItemsForFrameRange(items, range).length,
  )
  return { range, removed: actualRemoved }
}

/**
 * A track's in-flight staged zoom-out expansion. `advance` mounts up to
 * `budget` more clips toward its target and returns how many it actually
 * mounted; it unregisters itself once the target is reached.
 */
interface StagedExpander {
  advance: (budget: number) => number
}

/**
 * Global per-frame clip-mount budget shared across ALL track hooks. Each
 * useVisibleItems instance stages its own zoom-out expansion, but the mount
 * cost is global (one main thread), so the budget must be global too —
 * otherwise N tracks each mounting their own quota per frame multiplies the
 * per-frame work and re-introduces the spike. A single shared rAF hands out the
 * budget round-robin so no track starves.
 */
const GLOBAL_MOUNT_BUDGET_PER_FRAME = 2
const activeExpanders = new Set<StagedExpander>()
let sharedExpansionRaf: number | null = null
let expanderCursor = 0

function ensureSharedExpansionLoop() {
  if (sharedExpansionRaf === null) {
    sharedExpansionRaf = requestAnimationFrame(runSharedExpansionFrame)
  }
}

function runSharedExpansionFrame() {
  sharedExpansionRaf = null
  const expanders = [...activeExpanders]
  if (expanders.length === 0) return

  let budget = GLOBAL_MOUNT_BUDGET_PER_FRAME
  // Round-robin one clip at a time so no track starves; safety bounds the loop.
  let safety = budget + expanders.length
  while (budget > 0 && activeExpanders.size > 0 && safety-- > 0) {
    const expander = expanders[expanderCursor % expanders.length]!
    expanderCursor++
    if (!activeExpanders.has(expander)) continue
    budget -= expander.advance(1)
  }

  if (activeExpanders.size > 0) ensureSharedExpansionLoop()
}

function registerExpander(expander: StagedExpander) {
  activeExpanders.add(expander)
  ensureSharedExpansionLoop()
}

function unregisterExpander(expander: StagedExpander) {
  activeExpanders.delete(expander)
  if (activeExpanders.size === 0 && sharedExpansionRaf !== null) {
    cancelAnimationFrame(sharedExpansionRaf)
    sharedExpansionRaf = null
  }
}

/**
 * Retiring already-offscreen clips is cheaper than mounting rich clip trees,
 * but it still tears down context-menu/provider subtrees. Keep that cleanup
 * globally bounded too so several tracks cannot create one large settle task.
 */
const GLOBAL_UNMOUNT_BUDGET_PER_FRAME = 4
const activeContractors = new Set<StagedExpander>()
let sharedContractionRaf: number | null = null
let contractorCursor = 0

function ensureSharedContractionLoop() {
  if (sharedContractionRaf === null) {
    sharedContractionRaf = requestAnimationFrame(runSharedContractionFrame)
  }
}

function runSharedContractionFrame() {
  sharedContractionRaf = null
  const contractors = [...activeContractors]
  if (contractors.length === 0) return

  let budget = GLOBAL_UNMOUNT_BUDGET_PER_FRAME
  let safety = budget + contractors.length
  while (budget > 0 && activeContractors.size > 0 && safety-- > 0) {
    const contractor = contractors[contractorCursor % contractors.length]!
    contractorCursor++
    if (!activeContractors.has(contractor)) continue
    budget -= contractor.advance(1)
  }

  if (activeContractors.size > 0) ensureSharedContractionLoop()
}

function registerContractor(contractor: StagedExpander) {
  activeContractors.add(contractor)
  ensureSharedContractionLoop()
}

function unregisterContractor(contractor: StagedExpander) {
  activeContractors.delete(contractor)
  if (activeContractors.size === 0 && sharedContractionRaf !== null) {
    cancelAnimationFrame(sharedContractionRaf)
    sharedContractionRaf = null
  }
}

function quantizeInteractionPixelsPerSecond(pixelsPerSecond: number): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
    return 1
  }

  const logStep = Math.log2(1.2)
  const quantizedLog = Math.round(Math.log2(pixelsPerSecond) / logStep) * logStep
  return Math.pow(2, quantizedLog)
}

function getCullingPixelsPerSecond(zoomState: ReturnType<typeof useZoomStore.getState>): number {
  if (!zoomState.isZoomInteracting) {
    return zoomState.contentPixelsPerSecond
  }

  // During zoom interaction the viewport's scrollLeft is in the LIVE coordinate
  // space (cursor-anchor adjusted), so culling must use the live pps to avoid a
  // coordinate-space mismatch that unmounts visible items.  Quantize in coarse
  // 20% log-steps to avoid recomputing on every single wheel tick.
  return quantizeInteractionPixelsPerSecond(zoomState.pixelsPerSecond)
}

function getTrackVisibleTransitions(trackId: string): Transition[] | undefined {
  const transitionsState = useTransitionsStore.getState()
  return transitionsState.transitionsByTrackId[trackId] ?? EMPTY_TRANSITIONS
}

function computeCurrentDetailRange(trackId: string): VisibleFrameRange {
  const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState()
  const pixelsPerSecond = getCullingPixelsPerSecond(useZoomStore.getState())
  const { fps } = useTimelineSettingsStore.getState()
  const items = useItemsStore.getState().itemsByTrackId[trackId]
  const cullBufferPx = getTimelineItemCullBufferPx(items?.length ?? 0)
  return getVisibleFrameRange(scrollLeft, viewportWidth, pixelsPerSecond, fps, cullBufferPx)
}

function getDetailRangeSnapshot(trackId: string): VisibleFrameRange {
  const currentRange = detailRangeByTrackId.get(trackId)
  if (currentRange) {
    return currentRange
  }

  const initialRange = computeCurrentDetailRange(trackId)
  detailRangeByTrackId.set(trackId, initialRange)
  return initialRange
}

/**
 * The current live viewport + cull buffer, independent from the larger cohort
 * retained temporarily for smooth zoom reversal. Consumers can keep retained
 * roots mounted while suppressing expensive detail outside this range.
 */
export function useVisibleItemDetailRange(trackId: string): VisibleFrameRange {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToDetailRange(trackId, listener),
    [trackId],
  )
  const getSnapshot = useCallback(() => getDetailRangeSnapshot(trackId), [trackId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function computeVisibleItemsSnapshot(trackId: string): VisibleItemsSnapshot {
  const itemsState = useItemsStore.getState()
  const items = itemsState.itemsByTrackId[trackId]
  const transitions = getTrackVisibleTransitions(trackId)
  const visibleFrameRange = computeCurrentDetailRange(trackId)
  publishDetailRange(trackId, visibleFrameRange)
  const visibleItems = getTimelineItemsForFrameRange(items, visibleFrameRange)
  const visibleTransitions = getVisibleTransitionsForRange(
    transitions,
    itemsState.itemById,
    visibleItems,
    visibleFrameRange,
  )
  return { visibleItems, visibleTransitions }
}

/**
 * Returns only the items and transitions that overlap the visible viewport + buffer
 * for a given track. Items fully outside the range are not rendered as React components.
 */
export function useVisibleItems(trackId: string) {
  const [snapshot, setSnapshot] = useState<VisibleItemsSnapshot>(() =>
    computeVisibleItemsSnapshot(trackId),
  )
  // Track the frame range used for the last committed result so we can skip
  // recomputation when scroll hasn't moved enough to change the item set.
  const lastRangeRef = useRef<VisibleFrameRange | null>(null)
  // Track last zoom/settings/data versions to detect non-scroll changes.
  // itemsRef/transRef use array references (not lengths) because the items
  // store preserves references for unchanged tracks — a new reference means
  // at least one item was mutated (move, trim, property change, etc.).
  const lastVersionRef = useRef<{
    pps: number
    fps: number
    itemsRef: TimelineItem[] | undefined
    transRef: Transition[] | undefined
  }>({ pps: 0, fps: 0, itemsRef: undefined, transRef: undefined })

  useEffect(() => {
    // Commit a concrete visible range: filter items/transitions and publish.
    const commit = (range: VisibleFrameRange) => {
      const itemsState = useItemsStore.getState()
      const items = itemsState.itemsByTrackId[trackId]
      const transitions = getTrackVisibleTransitions(trackId)
      const { fps } = useTimelineSettingsStore.getState()
      const cullingPixelsPerSecond = getCullingPixelsPerSecond(useZoomStore.getState())

      const visibleItems = getTimelineItemsForFrameRange(items, range)
      const visibleTransitions = getVisibleTransitionsForRange(
        transitions,
        itemsState.itemById,
        visibleItems,
        range,
      )
      const next: VisibleItemsSnapshot = { visibleItems, visibleTransitions }

      lastRangeRef.current = range
      lastVersionRef.current = {
        pps: cullingPixelsPerSecond,
        fps,
        itemsRef: items,
        transRef: transitions,
      }
      setSnapshot((prevSnap) => (areVisibleSnapshotsEqual(prevSnap, next) ? prevSnap : next))
    }

    // Staged zoom-out expansion. `expansionTarget` is the range we're chasing;
    // the shared coordinator calls `expander.advance` with a slice of the global
    // per-frame mount budget until we reach it.
    let expansionTarget: VisibleFrameRange | null = null
    let retainZoomCohort = false
    let exactRangeAfterZoom: VisibleFrameRange | null = null
    let contractionTarget: VisibleFrameRange | null = null
    let contractionTimeout: ReturnType<typeof setTimeout> | null = null
    let pruneAfterExpansion = false

    const finishZoomRetention = () => {
      retainZoomCohort = false
      exactRangeAfterZoom = null
      contractionTarget = null
      pruneAfterExpansion = false
      unregisterContractor(contractor)
    }

    const contractor: StagedExpander = {
      advance: (budget) => {
        const target = contractionTarget
        if (!target) {
          unregisterContractor(contractor)
          return 0
        }

        const items = useItemsStore.getState().itemsByTrackId[trackId]
        const current = lastRangeRef.current ?? target
        if (!visibleRangeContains(current, target)) {
          contractionTarget = null
          unregisterContractor(contractor)
          pruneAfterExpansion = true
          scheduleStagedExpansion(mergeVisibleRanges(current, target))
          return 0
        }

        const { range, removed } = contractRangeByClipBudget(items, current, target, budget)
        commit(range)
        if (range.start === target.start && range.end === target.end) {
          finishZoomRetention()
        }
        return removed
      },
    }

    const cancelStagedContraction = (keepRetention = false) => {
      if (contractionTimeout !== null) {
        clearTimeout(contractionTimeout)
        contractionTimeout = null
      }
      contractionTarget = null
      pruneAfterExpansion = false
      unregisterContractor(contractor)
      if (!keepRetention) {
        retainZoomCohort = false
        exactRangeAfterZoom = null
      }
    }

    function beginStagedContraction() {
      contractionTimeout = null
      const target = exactRangeAfterZoom
      const current = lastRangeRef.current
      if (!target || !current) {
        finishZoomRetention()
        return
      }
      if (current.start === target.start && current.end === target.end) {
        finishZoomRetention()
        return
      }
      if (!visibleRangeContains(current, target)) {
        pruneAfterExpansion = true
        scheduleStagedExpansion(mergeVisibleRanges(current, target))
        return
      }

      contractionTarget = target
      registerContractor(contractor)
    }

    const scheduleStagedContraction = (target: VisibleFrameRange) => {
      cancelStagedContraction(true)
      retainZoomCohort = true
      exactRangeAfterZoom = target
      const trackItemCount = useItemsStore.getState().itemsByTrackId[trackId]?.length ?? 0
      const quietMs =
        trackItemCount >= DENSE_TIMELINE_TRACK_ITEM_THRESHOLD
          ? DENSE_CULL_CONTRACTION_QUIET_MS
          : DEFAULT_CULL_CONTRACTION_QUIET_MS
      contractionTimeout = setTimeout(beginStagedContraction, quietMs)
    }

    const expander: StagedExpander = {
      advance: (budget) => {
        const target = expansionTarget
        if (!target) {
          unregisterExpander(expander)
          return 0
        }

        const items = useItemsStore.getState().itemsByTrackId[trackId]
        const current = lastRangeRef.current ?? target
        const { range, added } = expandRangeByClipBudget(items, current, target, budget)
        commit(range)

        if (range.start <= target.start && range.end >= target.end) {
          expansionTarget = null
          unregisterExpander(expander)
          if (pruneAfterExpansion && !useZoomStore.getState().isZoomInteracting) {
            pruneAfterExpansion = false
            beginStagedContraction()
          }
        }
        return added
      },
    }

    const cancelStagedExpansion = () => {
      expansionTarget = null
      unregisterExpander(expander)
    }

    const scheduleStagedExpansion = (target: VisibleFrameRange) => {
      expansionTarget = target
      // Register and let the shared coordinator mount the clips under the global
      // budget. Mounting synchronously here would bypass that budget: all tracks
      // schedule within the same store-notify, so N synchronous commits would
      // land in one frame — the exact spike we're avoiding.
      registerExpander(expander)
    }

    const apply = () => {
      const zoomState = useZoomStore.getState()
      const cullingPixelsPerSecond = getCullingPixelsPerSecond(zoomState)
      const { fps } = useTimelineSettingsStore.getState()
      const itemsState = useItemsStore.getState()
      const items = itemsState.itemsByTrackId[trackId]
      const transitions = getTrackVisibleTransitions(trackId)
      const prev = lastVersionRef.current

      const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState()
      const cullBufferPx = getTimelineItemCullBufferPx(items?.length ?? 0)
      const newRange = getVisibleFrameRange(
        scrollLeft,
        viewportWidth,
        cullingPixelsPerSecond,
        fps,
        cullBufferPx,
      )
      // Follow live, quantized geometry even while `lastRange` intentionally
      // retains a larger mounted cohort for immediate zoom reversal. Rich clip
      // detail can stay bounded without root unmount/remount churn.
      publishDetailRange(trackId, newRange)
      const viewportRange = getVisibleFrameRange(
        scrollLeft,
        viewportWidth,
        cullingPixelsPerSecond,
        fps,
        0,
      )
      const lastRange = lastRangeRef.current
      const hysteresisFrames = getHysteresisFrames(cullingPixelsPerSecond, fps, cullBufferPx)

      if (zoomState.isZoomInteracting) {
        retainZoomCohort = true
        exactRangeAfterZoom = newRange
        cancelStagedContraction(true)
      }

      // Keep the mounted cohort monotonic from the first live wheel update
      // through a separate post-settle quiet window. Zoom-in therefore removes
      // nothing. Zoom-out may add only what is needed for real viewport coverage
      // plus globally-budgeted overscan.
      if (lastRange && (zoomState.isZoomInteracting || retainZoomCohort)) {
        if (!visibleRangesOverlap(lastRange, viewportRange)) {
          if (zoomState.isZoomInteracting) {
            // TimelineContent publishes live zoom before it writes the matching
            // anchored scroll offset in the same RAF. The intermediate pair can
            // look disjoint even though the following viewport notification is
            // continuous. Keep the old roots for the whole gesture so a later
            // viewport notification or direction reversal cannot swap cohorts.
            return
          }
          // The retained zoom cohort can still look disjoint at settle when the
          // anchor moved a long way. Preserve it through the quiet window; the
          // staged coordinator will expand/contract under the shared budget.
          if (retainZoomCohort) {
            scheduleStagedContraction(newRange)
            return
          }
          // A scrollbar jump to a disjoint window must replace the range. A
          // union would mount every clip in the potentially enormous gap.
          cancelStagedExpansion()
          commit(newRange)
        } else {
          let retainedRange = lastRange
          if (!visibleRangeContains(retainedRange, viewportRange)) {
            retainedRange = mergeVisibleRanges(retainedRange, viewportRange)
            commit(retainedRange)
          } else if (prev.fps !== fps || prev.itemsRef !== items || prev.transRef !== transitions) {
            // Apply data edits immediately without using the new zoom range to
            // retire unrelated mounted clips.
            commit(retainedRange)
          }

          const isLiveZoomIn =
            zoomState.isZoomInteracting && prev.pps > 0 && cullingPixelsPerSecond > prev.pps
          if (
            !isLiveZoomIn &&
            shouldExpandMountedRange(retainedRange, newRange, hysteresisFrames)
          ) {
            scheduleStagedExpansion(mergeVisibleRanges(retainedRange, newRange))
          } else {
            cancelStagedExpansion()
          }
        }

        if (!zoomState.isZoomInteracting) {
          scheduleStagedContraction(newRange)
        }
        return
      }

      // Any non-interacting recompute (settle, scroll, data/fps change)
      // supersedes an in-flight staged expansion.
      cancelStagedExpansion()

      // Fast path: if only scroll changed and the range shift is within
      // hysteresis, the visible item set is guaranteed unchanged.
      // Array references are compared (not lengths) so in-place mutations
      // (move, trim, property edits) that produce a new array always
      // bypass the fast path and recompute.
      if (
        lastRange &&
        prev.pps === cullingPixelsPerSecond &&
        prev.fps === fps &&
        prev.itemsRef === items &&
        prev.transRef === transitions
      ) {
        if (
          Math.abs(newRange.start - lastRange.start) < hysteresisFrames &&
          Math.abs(newRange.end - lastRange.end) < hysteresisFrames
        ) {
          return // Skip — too small a shift to affect results
        }
      }

      commit(newRange)
    }

    // Zoom-specific subscriber: skip when the quantized culling pps hasn't
    // changed — avoids redundant store reads on every wheel tick.
    let lastCullingPps = getCullingPixelsPerSecond(useZoomStore.getState())
    let wasZoomInteracting = useZoomStore.getState().isZoomInteracting
    const applyZoom = () => {
      const zoomState = useZoomStore.getState()
      const nextPps = getCullingPixelsPerSecond(zoomState)
      if (zoomState.isZoomInteracting) {
        wasZoomInteracting = true
        // Even raw zoom values within one quantized culling bucket extend the
        // quiet window and can reverse an in-flight expansion target.
        cancelStagedContraction(true)
        retainZoomCohort = true
        if (nextPps === lastCullingPps) return
        lastCullingPps = nextPps
        apply()
        return
      }

      if (!wasZoomInteracting && nextPps === lastCullingPps) return
      wasZoomInteracting = false
      lastCullingPps = nextPps
      apply()
    }

    const handleItemsChange = (
      state: ReturnType<typeof useItemsStore.getState>,
      previousState: ReturnType<typeof useItemsStore.getState>,
    ) => {
      if (state.itemsByTrackId[trackId] === previousState.itemsByTrackId[trackId]) {
        return
      }
      apply()
    }

    const handleTransitionsChange = (
      state: ReturnType<typeof useTransitionsStore.getState>,
      previousState: ReturnType<typeof useTransitionsStore.getState>,
    ) => {
      if (state.transitionsByTrackId[trackId] === previousState.transitionsByTrackId[trackId]) {
        return
      }
      apply()
    }

    apply()

    const unsubscribers = [
      useTimelineViewportStore.subscribe(apply),
      useZoomStore.subscribe(applyZoom),
      useTimelineSettingsStore.subscribe(apply),
      useItemsStore.subscribe(handleItemsChange),
      useTransitionsStore.subscribe(handleTransitionsChange),
    ]

    return () => {
      cancelStagedExpansion()
      cancelStagedContraction()
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [trackId])

  return snapshot
}

function getVisibleFrameRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  fps: number,
  bufferPx = DEFAULT_TIMELINE_ITEM_CULL_BUFFER_PX,
): VisibleFrameRange {
  if (pixelsPerSecond <= 0 || fps <= 0) {
    return { start: 0, end: Infinity }
  }

  const leftPx = scrollLeft - bufferPx
  const rightPx = scrollLeft + viewportWidth + bufferPx
  const startFrame = Math.max(0, Math.floor((leftPx / pixelsPerSecond) * fps))
  const endFrame = Math.ceil((rightPx / pixelsPerSecond) * fps)

  return { start: startFrame, end: endFrame }
}

function getVisibleTransitionsForRange(
  transitions: Transition[] | undefined,
  itemById: Record<string, TimelineItem>,
  visibleItems: TimelineItem[],
  visibleFrameRange: VisibleFrameRange,
): Transition[] {
  if (!transitions || transitions.length === 0) {
    return EMPTY_TRANSITIONS
  }

  const { start, end } = visibleFrameRange
  const visibleItemIds = new Set(visibleItems.map((item) => item.id))

  const filtered = transitions.filter((transition) => {
    if (visibleItemIds.has(transition.leftClipId) || visibleItemIds.has(transition.rightClipId)) {
      return true
    }

    const leftClip = itemById[transition.leftClipId]
    const rightClip = itemById[transition.rightClipId]
    if (!leftClip || !rightClip) {
      return false
    }

    const transitionStart = leftClip.from + leftClip.durationInFrames - transition.durationInFrames
    const transitionEnd = rightClip.from + transition.durationInFrames
    return transitionEnd > start && transitionStart < end
  })

  return filtered.length === transitions.length ? transitions : filtered
}

function areVisibleSnapshotsEqual(prev: VisibleItemsSnapshot, next: VisibleItemsSnapshot): boolean {
  return (
    areArraysShallowEqual(prev.visibleItems, next.visibleItems) &&
    areArraysShallowEqual(prev.visibleTransitions, next.visibleTransitions)
  )
}

function areArraysShallowEqual<T>(prev: T[], next: T[]): boolean {
  if (prev === next) {
    return true
  }

  if (prev.length !== next.length) {
    return false
  }

  for (let index = 0; index < prev.length; index++) {
    if (prev[index] !== next[index]) {
      return false
    }
  }

  return true
}
