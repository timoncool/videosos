import { memo, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useZoomStore } from '../stores/zoom-store'
import { TimelineMarkers } from './timeline-markers'
import { applyTimelineLiveGeometry } from '../utils/timeline-live-geometry'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'

interface TimelineRulerSurfaceProps {
  duration: number
  containerWidth: number
  initialWidth: number
  coordinateSurfaceRef?: RefObject<HTMLDivElement | null>
}

/**
 * Keeps live wheel zoom local to the ruler instead of re-rendering the entire
 * TimelineContent tree. TimelineMarkers still receives live zoom from its own
 * focused store subscription, while this shell updates width imperatively.
 */
export const TimelineRulerSurface = memo(function TimelineRulerSurface({
  duration,
  containerWidth,
  initialWidth,
  coordinateSurfaceRef,
}: TimelineRulerSurfaceProps) {
  const localRulerRef = useRef<HTMLDivElement>(null)
  const rulerRef = coordinateSurfaceRef ?? localRulerRef
  const committedSurfaceRef = useRef<HTMLDivElement>(null)

  const applyRulerZoom = useCallback(() => {
    const outer = rulerRef.current
    const surface = committedSurfaceRef.current
    if (!outer || !surface) return
    const { pixelsPerSecond } = useZoomStore.getState()
    applyTimelineLiveGeometry({
      outer,
      surface,
      duration,
      viewportWidth: containerWidth,
      livePixelsPerSecond: pixelsPerSecond,
    })
  }, [containerWidth, duration, rulerRef])

  useLayoutEffect(() => {
    applyRulerZoom()
  }, [applyRulerZoom])

  useEffect(
    () =>
      useZoomStore.subscribe((state, previousState) => {
        if (state.pixelsPerSecond !== previousState.pixelsPerSecond) {
          applyRulerZoom()
        }
      }),
    [applyRulerZoom],
  )

  return (
    <div
      ref={rulerRef}
      className="relative z-30 shrink-0 timeline-ruler bg-background"
      style={{ width: `${initialWidth}px`, height: EDITOR_LAYOUT_CSS_VALUES.timelineRulerHeight }}
    >
      <div
        ref={committedSurfaceRef}
        data-timeline-committed-surface="ruler"
        className="absolute inset-y-0 left-0"
        style={{
          width: `${initialWidth}px`,
          contain: 'layout style paint',
        }}
      >
        <TimelineMarkers duration={duration} />
      </div>
    </div>
  )
})
