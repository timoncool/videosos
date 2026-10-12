const PLAYHEAD_EDGE_SCROLL_ZONE_PX = 48
const PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND = 720

interface HorizontalBounds {
  left: number
  right: number
}

export function getPlayheadEdgeScrollVelocity(clientX: number, bounds: HorizontalBounds): number {
  const leftDepth = PLAYHEAD_EDGE_SCROLL_ZONE_PX - (clientX - bounds.left)
  if (leftDepth > 0) {
    return (
      -PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND *
      Math.min(1, leftDepth / PLAYHEAD_EDGE_SCROLL_ZONE_PX)
    )
  }

  const rightDepth = PLAYHEAD_EDGE_SCROLL_ZONE_PX - (bounds.right - clientX)
  if (rightDepth > 0) {
    return (
      PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND *
      Math.min(1, rightDepth / PLAYHEAD_EDGE_SCROLL_ZONE_PX)
    )
  }

  return 0
}

export function getEdgeScrollDelta(velocity: number, timestamp: number, previousTimestamp: number) {
  const elapsedSeconds = Math.min(32, Math.max(0, timestamp - previousTimestamp)) / 1000
  return velocity * elapsedSeconds
}
