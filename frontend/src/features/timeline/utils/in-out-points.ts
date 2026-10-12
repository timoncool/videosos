import type { TimelineItem } from '@/types/timeline'

const MIN_TIMELINE_SECONDS = 10

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeFrame(frame: number | null | undefined): number | null {
  if (frame === null || frame === undefined || !Number.isFinite(frame)) {
    return null
  }

  return Math.round(frame)
}

export function getEffectiveTimelineMaxFrame(
  items: ReadonlyArray<Pick<TimelineItem, 'from' | 'durationInFrames'>>,
  fps: number,
): number {
  const contentMaxFrame = items.reduce(
    (max, item) => Math.max(max, item.from + item.durationInFrames),
    0,
  )
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  const minimumFrame = Math.max(1, Math.floor(MIN_TIMELINE_SECONDS * safeFps))

  return Math.max(contentMaxFrame, minimumFrame)
}

/**
 * In/out bound while a composition is the loaded timeline (Motion, or a drilled
 * compound clip): its authored canvas duration, and nothing else.
 *
 * Neither of the Main-timeline rules applies. The minimum above would let the
 * range be marked past the end of a comp shorter than {@link MIN_TIMELINE_SECONDS},
 * and content extent would do the same for a layer hanging past the canvas — in
 * both cases the range would cover frames the comp does not render or export.
 */
export function getCompositionMaxFrame(durationInFrames: number): number {
  const canvasFrames = Number.isFinite(durationInFrames) ? Math.floor(durationInFrames) : 0
  return Math.max(1, canvasFrames)
}

export function sanitizeInOutPoints(params: {
  inPoint: number | null | undefined
  outPoint: number | null | undefined
  maxFrame: number
}): {
  inPoint: number | null
  outPoint: number | null
} {
  const safeMaxFrame = Number.isFinite(params.maxFrame) ? params.maxFrame : 1
  const maxFrame = Math.max(1, Math.floor(safeMaxFrame))

  let inPoint = normalizeFrame(params.inPoint)
  let outPoint = normalizeFrame(params.outPoint)

  if (inPoint !== null) {
    inPoint = clamp(inPoint, 0, maxFrame)
  }

  if (outPoint !== null) {
    outPoint = clamp(outPoint, 1, maxFrame)
  }

  if (inPoint !== null && outPoint !== null && inPoint >= outPoint) {
    if (inPoint >= maxFrame) {
      return {
        inPoint: Math.max(0, maxFrame - 1),
        outPoint: maxFrame,
      }
    }

    return {
      inPoint,
      outPoint: Math.min(maxFrame, inPoint + 1),
    }
  }

  return { inPoint, outPoint }
}
