export function addWindowPointerListeners(
  handlePointerMove: (event: PointerEvent) => void,
  handlePointerUp: (event: PointerEvent) => void,
  handlePointerCancel?: (event: PointerEvent) => void,
): () => void {
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  if (handlePointerCancel) window.addEventListener('pointercancel', handlePointerCancel)

  return () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    if (handlePointerCancel) window.removeEventListener('pointercancel', handlePointerCancel)
  }
}
