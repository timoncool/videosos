import type { BezierControlPoints } from '@/types/keyframe'

function clampX(x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function updateBezierFromHandle(
  currentConfig: BezierControlPoints,
  handleType: 'in' | 'out',
  newX: number,
  newY: number,
): BezierControlPoints {
  if (handleType === 'out') {
    return { ...currentConfig, x1: clampX(newX), y1: newY }
  }

  return { ...currentConfig, x2: clampX(newX), y2: newY }
}
