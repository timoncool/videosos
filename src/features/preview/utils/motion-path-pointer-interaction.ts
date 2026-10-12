export interface MotionPathPointerInteractionOptions {
  pointerId: number
  onMove: (event: PointerEvent) => void
  onCommit: (event: PointerEvent) => void
  onCancel?: () => void
}

/**
 * Own a direct motion-path pointer gesture until release. Pointer cancellation
 * deliberately skips the commit callback so abandoned edits never enter undo
 * history.
 */
export function attachWindowMotionPathPointerInteraction({
  pointerId,
  onMove,
  onCommit,
  onCancel,
}: MotionPathPointerInteractionOptions): () => void {
  const matchesPointer = (event: PointerEvent) => event.pointerId === pointerId

  const cleanup = () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerCancel)
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!matchesPointer(event)) return
    onMove(event)
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (!matchesPointer(event)) return
    cleanup()
    onCommit(event)
  }

  const handlePointerCancel = (event: PointerEvent) => {
    if (!matchesPointer(event)) return
    cleanup()
    onCancel?.()
  }

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerCancel)

  return cleanup
}
