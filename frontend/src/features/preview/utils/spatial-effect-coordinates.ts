import type { Point } from '../types/gizmo'

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Spatial GPU effects run over the project-sized texture after clip transform
 * and crop composition, so their point parameters are project UVs—not local
 * clip coordinates.
 */
export function canvasPointToSpatialEffectUv(
  point: Point,
  projectSize: { width: number; height: number },
): Point {
  return {
    x: clampUnit(point.x / Math.max(projectSize.width, 1)),
    y: clampUnit(point.y / Math.max(projectSize.height, 1)),
  }
}

export function spatialEffectUvToCanvasPoint(
  point: Point,
  projectSize: { width: number; height: number },
): Point {
  return {
    x: point.x * projectSize.width,
    y: point.y * projectSize.height,
  }
}
