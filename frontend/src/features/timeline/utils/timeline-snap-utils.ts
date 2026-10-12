import type { SnapTarget } from '../types/drag'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'

/**
 * Snap utility functions for timeline drag-and-drop
 * Pure functions for snap calculations - no side effects
 */

/** Minimal snap edge returned by the shared builder. Compatible with SnapTarget and RazorSnapTarget. */
export interface ItemSnapEdge {
  frame: number
  type: 'item-start' | 'item-end'
  itemId?: string
}

/**
 * Build filtered item snap edges from items, tracks, and transitions.
 *
 * Handles:
 * - Filtering items to visible tracks only (via `visibleTrackIds`)
 * - Suppressing transition inner edges (left clip end / right clip start)
 * - Adding transition visual midpoints as snap targets
 * - Optionally excluding specific item IDs (e.g. the item being dragged)
 *
 * Returns edges + midpoints only. Callers add grid, playhead, and marker
 * targets themselves.
 */
export function getFilteredItemSnapEdges(
  items: TimelineItem[],
  transitions: Transition[],
  visibleTrackIds: Set<string>,
  excludeItemIds?: string[],
  options: {
    includeTransitionMidpoints?: boolean
  } = {},
): ItemSnapEdge[] {
  const edges: ItemSnapEdge[] = []
  const excludedIds = excludeItemIds ? new Set(excludeItemIds) : null
  const includeTransitionMidpoints = options.includeTransitionMidpoints ?? true

  // Index items by ID for O(1) lookup in the transitions loop below
  const itemById = new Map(items.map((i) => [i.id, i]))

  // Build suppress sets from transitions
  const suppressEnd = new Set<string>()
  const suppressStart = new Set<string>()

  for (const t of transitions) {
    suppressEnd.add(t.leftClipId)
    suppressStart.add(t.rightClipId)

    // Add transition visual midpoint (only for visible tracks).
    // Tag with rightClipId so it can be excluded during drag filtering.
    // If either side of the transition is excluded, skip midpoint entirely
    // to avoid leaked "phantom" snap points from excluded segment families.
    const leftClip = itemById.get(t.leftClipId)
    const rightClip = itemById.get(t.rightClipId)
    if (
      includeTransitionMidpoints &&
      leftClip &&
      rightClip &&
      visibleTrackIds.has(leftClip.trackId) &&
      visibleTrackIds.has(rightClip.trackId) &&
      !excludedIds?.has(leftClip.id) &&
      !excludedIds?.has(rightClip.id)
    ) {
      const midpoint = rightClip.from + Math.ceil(t.durationInFrames / 2)
      edges.push({ frame: midpoint, type: 'item-start', itemId: t.rightClipId })
    }
  }

  // Item edges - filtered by visible tracks, transition suppression, and exclusions
  for (const item of items) {
    if (!visibleTrackIds.has(item.trackId)) continue
    if (excludedIds?.has(item.id)) continue

    if (!suppressStart.has(item.id)) {
      edges.push({ frame: item.from, type: 'item-start', itemId: item.id })
    }
    if (!suppressEnd.has(item.id)) {
      edges.push({ frame: item.from + item.durationInFrames, type: 'item-end', itemId: item.id })
    }
  }

  return edges
}

/**
 * Generate grid snap points based on timeline scale and zoom level
 * Returns frame numbers for major time intervals
 *
 * @param durationInSeconds - Total timeline duration in seconds
 * @param fps - Frames per second
 * @param zoomLevel - Current zoom level (affects grid density)
 * @returns Array of frame numbers where grid lines appear
 */
export function generateGridSnapPoints(
  durationInSeconds: number,
  fps: number,
  zoomLevel: number,
): number[] {
  const snapPoints: number[] = []

  // Determine interval based on zoom level
  // At high zoom (>2x), show every second
  // At normal zoom (1x-2x), show every 5 seconds
  // At low zoom (<1x), show every 10 seconds
  let intervalSeconds: number
  if (zoomLevel > 2) {
    intervalSeconds = 1 // Every second
  } else if (zoomLevel > 0.5) {
    intervalSeconds = 5 // Every 5 seconds
  } else {
    intervalSeconds = 10 // Every 10 seconds
  }

  // Generate snap points at regular intervals
  for (let time = 0; time <= durationInSeconds; time += intervalSeconds) {
    snapPoints.push(Math.round(time * fps))
  }

  return snapPoints
}

/**
 * A gesture builds one snap-target array and reuses it on every mouse move. With
 * 30k clips that array holds ~2N edges, so a linear scan per move (twice per
 * move for start+end) is the dominant per-frame cost while dragging. Cache a
 * frame-sorted copy per array identity so each move is a binary search
 * (O(log n)) instead of a full scan.
 */
const sortedSnapTargetsCache = new WeakMap<readonly SnapTarget[], readonly SnapTarget[]>()

function getSortedSnapTargets(snapTargets: SnapTarget[]): readonly SnapTarget[] {
  let sorted = sortedSnapTargetsCache.get(snapTargets)
  if (!sorted) {
    sorted = [...snapTargets].sort((a, b) => a.frame - b.frame)
    sortedSnapTargetsCache.set(snapTargets, sorted)
  }
  return sorted
}

/** Index of the rightmost element whose frame is <= targetFrame, or -1. */
function lowerBoundSnapIndex(sorted: readonly SnapTarget[], targetFrame: number): number {
  let low = 0
  let high = sorted.length - 1
  let position = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (sorted[middle]!.frame <= targetFrame) {
      position = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return position
}

function snapDistance(snapTarget: SnapTarget, targetFrame: number): number {
  return Math.abs(snapTarget.frame - targetFrame)
}

/**
 * Find the nearest snap target within threshold.
 *
 * Binary search over a cached frame-sorted copy of `snapTargets` — O(log n) per
 * query instead of O(n). The snap target is only used for its frame and as an
 * indicator; when a start and end edge are equidistant either result lands on
 * the same snapped frame, so the exact tie-break order is not observable.
 *
 * @param targetFrame - Frame position to snap from
 * @param snapTargets - Array of available snap targets
 * @param thresholdFrames - Maximum distance in frames to snap
 * @returns Nearest snap target or null if none within threshold
 */
export function findNearestSnapTarget(
  targetFrame: number,
  snapTargets: SnapTarget[],
  thresholdFrames: number,
): SnapTarget | null {
  if (snapTargets.length === 0) {
    return null
  }

  const sorted = getSortedSnapTargets(snapTargets)
  const position = lowerBoundSnapIndex(sorted, targetFrame)

  let nearestTarget: SnapTarget | null = null
  let minDistance = thresholdFrames

  const left = position >= 0 ? sorted[position]! : null
  const right = position + 1 < sorted.length ? sorted[position + 1]! : null

  if (left) {
    const distance = snapDistance(left, targetFrame)
    if (distance < minDistance) {
      nearestTarget = left
      minDistance = distance
    }
  }
  if (right) {
    const distance = snapDistance(right, targetFrame)
    if (distance < minDistance) {
      nearestTarget = right
    }
  }

  return nearestTarget
}

/**
 * Nearest snap target within threshold, optionally skipping targets whose
 * `itemId` is in `excludeItemIds` (e.g. the dragged/trimmed clip itself).
 *
 * Binary search finds the closest sorted neighbor, then scans outward while
 * candidates stay within the threshold. Exclusions are rare and the threshold
 * is a handful of frames, so the outward scan is effectively O(1); the total is
 * O(log n + k) where k is the (small) number of in-threshold candidates.
 */
export function findNearestSnapTargetExcluding(
  targetFrame: number,
  snapTargets: SnapTarget[],
  thresholdFrames: number,
  excludeItemIds?: Set<string>,
): SnapTarget | null {
  if (snapTargets.length === 0) {
    return null
  }

  const sorted = getSortedSnapTargets(snapTargets)
  const isExcluded = (target: SnapTarget): boolean =>
    excludeItemIds ? target.itemId !== undefined && excludeItemIds.has(target.itemId) : false

  const position = lowerBoundSnapIndex(sorted, targetFrame)

  let nearestTarget: SnapTarget | null = null
  let minDistance = thresholdFrames

  // The two closest candidates straddle `position`: `position` (<= targetFrame)
  // and `position + 1` (> targetFrame). Scan outward from both, stopping each
  // side once it is beyond the (possibly tightened) best distance so excluded
  // neighbors can't force a full scan.
  let left = position
  let right = position + 1
  while (left >= 0 || right < sorted.length) {
    if (left >= 0) {
      const candidate = sorted[left]!
      const distance = snapDistance(candidate, targetFrame)
      if (distance >= minDistance && distance > 0) {
        left = -1
      } else {
        if (!isExcluded(candidate) && distance < minDistance) {
          nearestTarget = candidate
          minDistance = distance
        }
        left--
      }
    }
    if (right < sorted.length) {
      const candidate = sorted[right]!
      const distance = snapDistance(candidate, targetFrame)
      if (distance >= minDistance && distance > 0) {
        right = sorted.length
      } else {
        if (!isExcluded(candidate) && distance < minDistance) {
          nearestTarget = candidate
          minDistance = distance
        }
        right++
      }
    }
  }

  return nearestTarget
}

/**
 * Calculate adaptive snap threshold based on zoom level
 * Higher zoom = tighter snap threshold (more precise)
 * Lower zoom = looser snap threshold (easier to snap)
 *
 * @param zoomLevel - Current zoom level
 * @param baseThresholdPixels - Base threshold in pixels at 1x zoom
 * @param pixelsPerSecond - Pixels per second at current zoom
 * @param fps - Frames per second
 * @returns Threshold in frames
 */
export function calculateAdaptiveSnapThreshold(
  zoomLevel: number,
  baseThresholdPixels: number,
  pixelsPerSecond: number,
  fps: number,
): number {
  // Calculate threshold in pixels (inversely proportional to zoom)
  const thresholdPixels = baseThresholdPixels / Math.sqrt(zoomLevel)

  // Convert pixels to frames
  const secondsPerPixel = 1 / pixelsPerSecond
  const thresholdSeconds = thresholdPixels * secondsPerPixel
  const thresholdFrames = Math.ceil(thresholdSeconds * fps)

  // Minimum threshold of 1 frame
  return Math.max(1, thresholdFrames)
}
