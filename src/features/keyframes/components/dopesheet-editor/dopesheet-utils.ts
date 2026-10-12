export function clampZoomValue(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function setPointerCaptureSafely(target: EventTarget | null, pointerId: number) {
  if (target && 'setPointerCapture' in target && typeof target.setPointerCapture === 'function') {
    target.setPointerCapture(pointerId)
  }
}
