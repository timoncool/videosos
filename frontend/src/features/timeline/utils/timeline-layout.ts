import { ZOOM_MAX, ZOOM_MIN } from '../constants'

const TIMELINE_ZOOM_TO_FIT_RIGHT_PADDING_PX = 50

const TIMELINE_RIGHT_SCROLL_ROOM_MIN_PX = 240
const TIMELINE_RIGHT_SCROLL_ROOM_MAX_PX = 480
const TIMELINE_RIGHT_SCROLL_ROOM_VIEWPORT_RATIO = 0.35

interface TimelineWidthInput {
  contentWidth: number
  viewportWidth: number
}

interface TimelineContentScrollInput extends TimelineWidthInput {
  scrollLeft: number
  deltaPixels: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function getZoomToFitLevel(containerWidth: number, contentDurationSeconds: number): number {
  const duration = Math.max(10, contentDurationSeconds)
  const targetWidth = Math.max(0, containerWidth - TIMELINE_ZOOM_TO_FIT_RIGHT_PADDING_PX)
  return clamp(targetWidth / (duration * 100), ZOOM_MIN, ZOOM_MAX)
}

export function getTimelineRightScrollRoom(viewportWidth: number): number {
  if (viewportWidth <= 0) {
    return TIMELINE_RIGHT_SCROLL_ROOM_MIN_PX
  }

  return clamp(
    viewportWidth * TIMELINE_RIGHT_SCROLL_ROOM_VIEWPORT_RATIO,
    TIMELINE_RIGHT_SCROLL_ROOM_MIN_PX,
    TIMELINE_RIGHT_SCROLL_ROOM_MAX_PX,
  )
}

export function getTimelineWidth({ contentWidth, viewportWidth }: TimelineWidthInput): number {
  if (viewportWidth <= 0) {
    return Math.max(0, contentWidth)
  }

  return Math.max(viewportWidth, contentWidth + getTimelineRightScrollRoom(viewportWidth))
}

/**
 * Stop edge scrubbing when the real content end reaches the viewport edge.
 * The extra right-side navigation room remains available to deliberate scroll.
 */
export function getContentBoundedEdgeScrollLeft({
  contentWidth,
  viewportWidth,
  scrollLeft,
  deltaPixels,
}: TimelineContentScrollInput): number {
  if (deltaPixels <= 0) {
    return Math.max(0, scrollLeft + deltaPixels)
  }

  const maxContentScrollLeft = Math.max(0, contentWidth - Math.max(0, viewportWidth))
  if (scrollLeft >= maxContentScrollLeft) {
    return scrollLeft
  }

  return Math.min(maxContentScrollLeft, scrollLeft + deltaPixels)
}
