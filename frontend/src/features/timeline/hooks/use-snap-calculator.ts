import { useCallback } from 'react'
import type { SnapTarget } from '../types/drag'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  generateGridSnapPoints,
  findNearestSnapTarget,
  calculateAdaptiveSnapThreshold,
  getFilteredItemSnapEdges,
} from '../utils/timeline-snap-utils'
import { getVisibleTrackIds } from '../utils/group-utils'
import { BASE_SNAP_THRESHOLD_PIXELS } from '../constants'
import { getZoomLevelNow, getPixelsPerSecondNow } from '../utils/zoom-conversions'

type SnapExclusion = string | string[] | null

function normalizeExcludeIds(excludeItemIds: SnapExclusion): string[] {
  if (!excludeItemIds) return []
  return Array.isArray(excludeItemIds) ? excludeItemIds : [excludeItemIds]
}

/**
 * Advanced snap calculator hook
 *
 * Combines grid snapping (timeline markers) with magnetic snapping (item edges)
 * Magnetic snapping takes priority when both are within threshold
 *
 * Phase 2 enhancement over basic grid snapping
 *
 * @param timelineDuration - Total timeline duration in seconds
 * @param excludeItemIds - Item ID(s) to exclude from snap targets (for dragging items)
 *                         Accepts a single ID string or an array of IDs for group selection
 */
export function useSnapCalculator(
  timelineDuration: number,
  excludeItemIds: SnapExclusion,
  options: {
    includeTransitionMidpoints?: boolean
  } = {},
) {
  const includeTransitionMidpoints = options.includeTransitionMidpoints ?? true

  const getSnapThresholdFrames = useCallback(() => {
    const fps = useTimelineSettingsStore.getState().fps
    return calculateAdaptiveSnapThreshold(
      getZoomLevelNow(),
      BASE_SNAP_THRESHOLD_PIXELS,
      getPixelsPerSecondNow(),
      fps,
    )
  }, [])

  const isSnapEnabled = useCallback(() => {
    return useTimelineSettingsStore.getState().snapEnabled
  }, [])

  /**
   * Generate magnetic targets only when a gesture starts or a caller explicitly queries.
   * An override supports gesture-specific cohorts, including Alt-drag originals.
   */
  const getMagneticSnapTargets = useCallback(
    (excludeItemIdsOverride?: SnapExclusion) => {
      const { items, tracks } = useItemsStore.getState()
      const transitions = useTransitionsStore.getState().transitions
      const visibleTrackIds = getVisibleTrackIds(tracks)
      const resolvedExcludeIds =
        excludeItemIdsOverride === undefined ? excludeItemIds : excludeItemIdsOverride
      const excludeIds = normalizeExcludeIds(resolvedExcludeIds)
      const targets: SnapTarget[] = getFilteredItemSnapEdges(
        items,
        transitions,
        visibleTrackIds,
        excludeIds,
        {
          includeTransitionMidpoints,
        },
      )

      return targets
    },
    [excludeItemIds, includeTransitionMidpoints],
  )

  const generateSnapTargets = useCallback(() => {
    const { fps } = useTimelineSettingsStore.getState()
    const targets: SnapTarget[] = []
    const gridFrames = generateGridSnapPoints(timelineDuration, fps, getZoomLevelNow())

    for (const frame of gridFrames) {
      targets.push({ frame, type: 'grid' })
    }
    targets.push(...getMagneticSnapTargets())

    return targets
  }, [getMagneticSnapTargets, timelineDuration])

  /**
   * Calculate snap for a given position
   * Checks both start and end positions of the item
   * Returns snapped position and snap information
   *
   * @param targetStartFrame - The proposed start frame of the item
   * @param itemDurationInFrames - Duration of the item in frames
   */
  const calculateSnap = useCallback(
    (targetStartFrame: number, itemDurationInFrames: number) => {
      if (!isSnapEnabled()) {
        return {
          snappedFrame: targetStartFrame,
          snapTarget: null,
          didSnap: false,
        }
      }

      // Calculate end frame
      const targetEndFrame = targetStartFrame + itemDurationInFrames
      const snapThresholdFrames = getSnapThresholdFrames()

      // Generate snap targets on-demand and add playhead
      const currentFrame = usePlaybackStore.getState().currentFrame
      const allTargets: SnapTarget[] = [
        ...generateSnapTargets(),
        { frame: currentFrame, type: 'playhead' as const },
      ]

      // Find nearest snap target for start position
      const nearestStartTarget = findNearestSnapTarget(
        targetStartFrame,
        allTargets,
        snapThresholdFrames,
      )

      // Find nearest snap target for end position
      const nearestEndTarget = findNearestSnapTarget(
        targetEndFrame,
        allTargets,
        snapThresholdFrames,
      )

      // Determine which snap is stronger (closer)
      const startDistance = nearestStartTarget
        ? Math.abs(targetStartFrame - nearestStartTarget.frame)
        : Infinity
      const endDistance = nearestEndTarget
        ? Math.abs(targetEndFrame - nearestEndTarget.frame)
        : Infinity

      // Use the closest snap (prioritize magnetic snaps over grid snaps if distances are equal)
      if (startDistance < endDistance) {
        if (nearestStartTarget) {
          return {
            snappedFrame: nearestStartTarget.frame,
            snapTarget: nearestStartTarget,
            didSnap: true,
          }
        }
      } else if (endDistance < Infinity) {
        if (nearestEndTarget) {
          // Snap the end, so adjust start position accordingly
          const adjustedStartFrame = nearestEndTarget.frame - itemDurationInFrames
          return {
            snappedFrame: adjustedStartFrame,
            snapTarget: nearestEndTarget,
            didSnap: true,
          }
        }
      }

      return {
        snappedFrame: targetStartFrame,
        snapTarget: null,
        didSnap: false,
      }
    },
    [generateSnapTargets, getSnapThresholdFrames, isSnapEnabled],
  )

  return {
    calculateSnap,
    getMagneticSnapTargets,
    getSnapThresholdFrames,
    isSnapEnabled,
  }
}
