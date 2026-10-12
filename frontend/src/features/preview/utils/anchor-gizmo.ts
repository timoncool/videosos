import type { Point, Transform } from '../types/gizmo'
import { suppressReleaseClick } from './gizmo-transform-interaction'

function rotateVector(point: Point, angleDegrees: number): Point {
  const radians = (angleDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

/**
 * Move an item's local anchor while preserving its visible world-space pose.
 *
 * The pointer delta is converted into the item's unrotated local basis. Position
 * is compensated by the difference between that local delta and its rotated
 * world-space delta, so moving the pivot does not make the layer jump.
 */
export function calculateAnchorDrag(
  startTransform: Transform,
  startPoint: Point,
  currentPoint: Point,
): Transform {
  const worldDelta = {
    x: currentPoint.x - startPoint.x,
    y: currentPoint.y - startPoint.y,
  }
  const localDelta = rotateVector(worldDelta, -startTransform.rotation)
  return {
    ...startTransform,
    x: startTransform.x + worldDelta.x - localDelta.x,
    y: startTransform.y + worldDelta.y - localDelta.y,
    anchorX: (startTransform.anchorX ?? startTransform.width / 2) + localDelta.x,
    anchorY: (startTransform.anchorY ?? startTransform.height / 2) + localDelta.y,
  }
}

function hasAnchorChanged(
  startTransform: Transform,
  nextTransform: Transform,
  tolerance = 0.01,
): boolean {
  const startAnchorX = startTransform.anchorX ?? startTransform.width / 2
  const startAnchorY = startTransform.anchorY ?? startTransform.height / 2
  const nextAnchorX = nextTransform.anchorX ?? nextTransform.width / 2
  const nextAnchorY = nextTransform.anchorY ?? nextTransform.height / 2
  return (
    Math.abs(nextAnchorX - startAnchorX) > tolerance ||
    Math.abs(nextAnchorY - startAnchorY) > tolerance
  )
}

interface WindowAnchorInteractionOptions {
  startTransform: Transform
  startPoint: Point
  toCanvasPoint: (event: MouseEvent) => Point
  setPreview: (transform: Transform) => void
  restorePreview: (deferred: boolean) => void
  onCommit: (transform: Transform) => void
  onFinish?: () => void
}

/**
 * Owns the complete anchor pointer interaction until release or cancellation.
 * The mouseup sample is flushed synchronously so fast drags commit the same
 * endpoint that the pointer reached.
 */
export function attachWindowAnchorInteraction({
  startTransform,
  startPoint,
  toCanvasPoint,
  setPreview,
  restorePreview,
  onCommit,
  onFinish,
}: WindowAnchorInteractionOptions): () => void {
  let latestTransform = startTransform
  let latestEvent: MouseEvent | null = null
  let animationFrame: number | null = null
  let finished = false

  const updateFromEvent = (event: MouseEvent) => {
    latestTransform = calculateAnchorDrag(startTransform, startPoint, toCanvasPoint(event))
    setPreview(latestTransform)
  }
  const flushLatestEvent = () => {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    if (!latestEvent) return
    updateFromEvent(latestEvent)
    latestEvent = null
  }
  const removeListeners = () => {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }
  const finish = (commit: boolean) => {
    if (finished) return
    finished = true
    if (commit) flushLatestEvent()
    else if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    removeListeners()
    onFinish?.()

    if (!commit || !hasAnchorChanged(startTransform, latestTransform)) {
      restorePreview(false)
      return
    }
    suppressReleaseClick()
    onCommit(latestTransform)
    restorePreview(true)
  }
  const handleMouseMove = (event: MouseEvent) => {
    latestEvent = event
    if (animationFrame !== null) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null
      if (!latestEvent) return
      const eventToApply = latestEvent
      latestEvent = null
      updateFromEvent(eventToApply)
    })
  }
  const handleMouseUp = (event: MouseEvent) => {
    latestEvent = event
    finish(true)
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  return () => finish(false)
}
