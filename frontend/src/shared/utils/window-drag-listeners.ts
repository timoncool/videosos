import type { RefObject } from 'react'

/**
 * Attaches window-level `mousemove`/`mouseup` listeners for a drag gesture.
 * Returns an effect cleanup that detaches the listeners and cancels any
 * pending animation frame held by `rafRef`.
 */
export function attachWindowDragListeners(
  onMouseMove: (event: MouseEvent) => void,
  onMouseUp: (event: MouseEvent) => void,
  rafRef: RefObject<number | null>,
): () => void {
  window.addEventListener('pointermove', onMouseMove)
  window.addEventListener('pointerup', onMouseUp)
  window.addEventListener('pointercancel', onMouseUp)
  return () => {
    window.removeEventListener('pointermove', onMouseMove)
    window.removeEventListener('pointerup', onMouseUp)
    window.removeEventListener('pointercancel', onMouseUp)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }
}
