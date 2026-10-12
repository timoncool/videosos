import { suppressReleaseClick } from './gizmo-transform-interaction'

const DEFAULT_MOUSE_DRAG_INTENT_THRESHOLD_PX = 4
const BLOCKED_CANVAS_TRANSLATE_CURSOR_CLASS = 'canvas-translate-cursor-not-allowed'

interface MouseDragIntentStart {
  clientX: number
  clientY: number
}

interface MouseDragIntentOptions {
  thresholdPx?: number
  onEnd?: () => void
}

/**
 * Runs a callback only after the pointer moves far enough to represent a drag.
 * A click or mouse-up without movement remains passive.
 */
function notifyOnMouseDragIntent(
  start: MouseDragIntentStart,
  onDragIntent: () => void,
  options: MouseDragIntentOptions = {},
): () => void {
  let active = true
  let dragIntentStarted = false

  const cleanup = () => {
    if (!active) return
    active = false
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', cleanup)
    window.removeEventListener('blur', cleanup)
    if (dragIntentStarted) options.onEnd?.()
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (dragIntentStarted) return
    if (
      Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) <
      (options.thresholdPx ?? DEFAULT_MOUSE_DRAG_INTENT_THRESHOLD_PX)
    ) {
      return
    }
    dragIntentStarted = true
    onDragIntent()
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', cleanup)
  window.addEventListener('blur', cleanup)
  return cleanup
}

/**
 * Presents link-owned translation feedback only for the duration of a real
 * blocked drag attempt.
 */
export function notifyOnBlockedMouseDragIntent(
  start: MouseDragIntentStart,
  onDragIntent: () => void,
): () => void {
  return notifyOnMouseDragIntent(
    start,
    () => {
      document.body.classList.add(BLOCKED_CANVAS_TRANSLATE_CURSOR_CLASS)
      onDragIntent()
    },
    {
      onEnd: () => {
        document.body.classList.remove(BLOCKED_CANVAS_TRANSLATE_CURSOR_CLASS)
        suppressReleaseClick()
      },
    },
  )
}
