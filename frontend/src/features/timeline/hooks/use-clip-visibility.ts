import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useZoomStore } from '../stores/zoom-store'

/**
 * Pixels of margin beyond the viewport for considering a clip "visible".
 * Increased from 200 to 600 to absorb the 50ms viewport store throttle —
 * at fast scroll speeds (~200px/frame × 3 frames), tiles stay pre-rendered
 * 600px ahead, preventing blank flashes at the leading edge.
 */
export const CLIP_VISIBILITY_PREFETCH_MARGIN_PX = 600
const RATIO_EPSILON = 0.002
const subscribeToNothing = () => () => {}
const getNullZoomSnapshot = () => null
const subscribeToZoom = (onStoreChange: () => void) => useZoomStore.subscribe(onStoreChange)
const getStandaloneZoomSnapshot = () => {
  const state = useZoomStore.getState()
  return state.isZoomInteracting ? Number.NaN : state.contentPixelsPerSecond
}

export interface ClipVisibilityState {
  isVisible: boolean
  visibleStartRatio: number
  visibleEndRatio: number
}

/**
 * Hook to detect when a timeline clip is visible in the shared timeline viewport.
 * Uses clip geometry in timeline-content coordinates (left/width) and avoids
 * per-clip scroll listeners/observers.
 *
 * During zoom interaction, clip positions and the viewport temporarily use
 * different coordinate spaces. Keep the last valid bounded window until zoom
 * settles instead of expanding every clip to its full duration.
 */
export function useClipVisibility(
  clipLeftPx: number,
  clipWidthPx: number,
  geometryPixelsPerSecond?: number,
): ClipVisibilityState {
  const committedVisibilityRef = useRef<ClipVisibilityState>(
    computeVisibility(useTimelineViewportStore.getState(), clipLeftPx, clipWidthPx),
  )

  // Standalone consumers that do not provide their geometry scale retain a
  // small settled-zoom subscription. Main-timeline clip content passes the
  // bridged scale, so this selector stays null and cannot create a SyncLane
  // zoom-end fan-out.
  useSyncExternalStore(
    geometryPixelsPerSecond === undefined ? subscribeToZoom : subscribeToNothing,
    geometryPixelsPerSecond === undefined ? getStandaloneZoomSnapshot : getNullZoomSnapshot,
    geometryPixelsPerSecond === undefined ? getStandaloneZoomSnapshot : getNullZoomSnapshot,
  )

  const visibility = useTimelineViewportStore(
    useShallow(
      useCallback(
        (viewport) => {
          const zoom = useZoomStore.getState()
          const bridgedGeometryIsCurrent =
            geometryPixelsPerSecond === undefined ||
            Math.abs(geometryPixelsPerSecond - zoom.contentPixelsPerSecond) < 0.001

          // Live scrollLeft and settled clip pixels use different coordinate
          // spaces. Also remain frozen while the provider's concurrent geometry
          // render is pending after the store itself has settled.
          if (zoom.isZoomInteracting || !bridgedGeometryIsCurrent) {
            return committedVisibilityRef.current
          }

          const next = computeVisibility(viewport, clipLeftPx, clipWidthPx)
          const previous = committedVisibilityRef.current
          if (
            previous.isVisible === next.isVisible &&
            Math.abs(previous.visibleStartRatio - next.visibleStartRatio) < RATIO_EPSILON &&
            Math.abs(previous.visibleEndRatio - next.visibleEndRatio) < RATIO_EPSILON
          ) {
            return previous
          }

          return next
        },
        [clipLeftPx, clipWidthPx, geometryPixelsPerSecond],
      ),
    ),
  )

  // React refs are shared between current and work-in-progress fibers. Publish
  // the frozen baseline only after the selected visibility has committed, so a
  // suspended or abandoned zoom transition cannot leak its geometry into the
  // currently painted timeline.
  useLayoutEffect(() => {
    committedVisibilityRef.current = visibility
  }, [visibility])

  return visibility
}

interface TimelineViewportSnapshot {
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

function computeVisibility(
  viewport: TimelineViewportSnapshot,
  clipLeftPx: number,
  clipWidthPx: number,
  prefetchMarginPx = CLIP_VISIBILITY_PREFETCH_MARGIN_PX,
): ClipVisibilityState {
  if (clipWidthPx <= 0 || viewport.viewportWidth <= 0) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    }
  }

  const viewLeft = viewport.scrollLeft - prefetchMarginPx
  const viewRight = viewport.scrollLeft + viewport.viewportWidth + prefetchMarginPx
  const clipRightPx = clipLeftPx + clipWidthPx

  const overlapLeft = Math.max(clipLeftPx, viewLeft)
  const overlapRight = Math.min(clipRightPx, viewRight)
  const isVisible = overlapRight > overlapLeft

  if (!isVisible) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    }
  }

  const startRatio = Math.max(0, Math.min(1, (overlapLeft - clipLeftPx) / clipWidthPx))
  const endRatio = Math.max(startRatio, Math.min(1, (overlapRight - clipLeftPx) / clipWidthPx))

  return {
    isVisible: true,
    visibleStartRatio: startRatio,
    visibleEndRatio: endRatio,
  }
}
