import { memo } from 'react'
import { useMarkersStore } from '@/features/editor/deps/timeline-store'

/**
 * The two regions an After Effects timeline draws over its layers: the comp's own
 * extent, and the active (work) region inside it.
 *
 * Both matter here because the Motion axis is `max(comp duration, content end)` —
 * a layer is free to run past the end of the comp, where it is simply not
 * rendered. Without the comp end marked, that overhang looks like ordinary
 * timeline. The active region is the in/out range: what a render actually covers.
 *
 * Bands are pure paint (`pointer-events-none`) positioned in `%` of the caller's
 * viewport box, so they line up with the ruler ticks and the layer spans without
 * knowing the pixel width of either.
 */

interface MotionRegionViewport {
  startFrame: number
  endFrame: number
}

function toPercent(frame: number, viewport: MotionRegionViewport): number {
  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  return ((frame - viewport.startFrame) / frameRange) * 100
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent))
}

/** Ruler decoration that dims the inspectable axis past the authored comp end. */
export const MotionCompEndRulerDim = memo(function MotionCompEndRulerDim({
  viewport,
  compositionEndFrame,
}: {
  viewport: MotionRegionViewport
  compositionEndFrame: number
}) {
  const endPercent = clampPercent(toPercent(compositionEndFrame, viewport))

  return (
    <div
      aria-hidden="true"
      data-testid="motion-comp-end-ruler-dim"
      data-from-frame={compositionEndFrame}
      data-motion-viewport-clamp
      className="pointer-events-none absolute inset-y-0 border-l border-border/80 bg-background/60"
      style={{ left: `${endPercent}%`, right: 0 }}
    />
  )
})

/**
 * Layer-row shading: everything outside the active (in/out) region, and
 * everything past the end of the comp.
 */
export const MotionActiveRegionOverlay = memo(function MotionActiveRegionOverlay({
  viewport,
  compositionEndFrame,
  testId = 'motion-active-region-overlay',
  compositionEndTestId = 'motion-comp-end-dim',
}: {
  viewport: MotionRegionViewport
  compositionEndFrame: number | null
  testId?: string
  compositionEndTestId?: string
}) {
  const inPoint = useMarkersStore((s) => s.inPoint)
  const outPoint = useMarkersStore((s) => s.outPoint)

  const hasActiveRegion = inPoint !== null && outPoint !== null && outPoint > inPoint
  const inPercent = hasActiveRegion ? clampPercent(toPercent(inPoint, viewport)) : 0
  const outPercent = hasActiveRegion ? clampPercent(toPercent(outPoint, viewport)) : 100
  const compEndPercent =
    compositionEndFrame === null ? 100 : clampPercent(toPercent(compositionEndFrame, viewport))

  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {hasActiveRegion ? (
        <div
          data-from-frame={0}
          data-to-frame={inPoint ?? 0}
          data-motion-viewport-clamp
          className="absolute inset-y-0 bg-background/45"
          style={{ left: 0, width: `${inPercent}%` }}
        />
      ) : null}

      {hasActiveRegion ? (
        <div
          data-from-frame={outPoint ?? 0}
          data-motion-viewport-clamp
          className="absolute inset-y-0 bg-background/45"
          style={{ left: `${outPercent}%`, right: 0 }}
        />
      ) : null}

      {compositionEndFrame !== null ? (
        <div
          data-testid={compositionEndTestId}
          data-from-frame={compositionEndFrame ?? 0}
          data-motion-viewport-clamp
          className="absolute inset-y-0 border-l border-border/80 bg-background/55"
          style={{ left: `${compEndPercent}%`, right: 0 }}
        />
      ) : null}
    </div>
  )
})
