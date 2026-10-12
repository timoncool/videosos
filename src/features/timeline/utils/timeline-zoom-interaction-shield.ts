import { TIMELINE_RULER_HEIGHT } from '../constants'

export function getTimelineZoomInteractionShieldBounds(bounds: {
  left: number
  top: number
  width: number
  height: number
}) {
  const rulerHeight = Math.min(TIMELINE_RULER_HEIGHT, bounds.height)
  return {
    left: bounds.left,
    top: bounds.top + rulerHeight,
    width: bounds.width,
    height: Math.max(0, bounds.height - rulerHeight),
  }
}
