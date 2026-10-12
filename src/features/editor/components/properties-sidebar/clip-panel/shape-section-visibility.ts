import type { ShapeItem } from '@/types/timeline'

export interface ShapeSectionControlVisibility {
  isSingleOpenPath: boolean
  isMaskOnly: boolean
  showPathClosure: boolean
  showFill: boolean
  showStroke: boolean
  showLineCap: boolean
  showLineJoin: boolean
  showTrimPaths: boolean
  showTaper: boolean
  showNoAppearanceNotice: boolean
}

function hasEnabledStroke(shape: ShapeItem): boolean {
  const enabled =
    shape.strokeEnabled ?? ((shape.strokeWidth ?? 0) > 0 && shape.strokeColor !== undefined)
  return enabled && (shape.strokeWidth ?? 0) > 0 && !!shape.strokeColor
}

function hasEnabledFill(shape: ShapeItem): boolean {
  if (shape.shapeType === 'path' && shape.pathClosed === false) return false
  return shape.fillEnabled ?? true
}

function pathHasJoin(shape: ShapeItem): boolean {
  if (shape.shapeType === 'circle' || shape.shapeType === 'ellipse') return false
  if (shape.shapeType !== 'path') return true
  return (shape.pathClosed ?? true) || (shape.pathVertices?.length ?? 0) >= 3
}

/**
 * Keeps the inspector aligned with geometry that can visibly use each option.
 * Open paths are stroke-only; masks expose geometry/mask controls only.
 */
export function getShapeSectionControlVisibility(
  shapes: ShapeItem[],
): ShapeSectionControlVisibility {
  const singlePath = shapes.length === 1 && shapes[0]?.shapeType === 'path' ? shapes[0] : null
  const isSingleOpenPath = singlePath?.pathClosed === false
  const isMaskOnly = shapes.length > 0 && shapes.every((shape) => shape.isMask === true)
  const allStrokesVisible = shapes.length > 0 && shapes.every(hasEnabledStroke)
  const hasOpenEndpoint = shapes.some(
    (shape) => shape.shapeType === 'path' && shape.pathClosed === false,
  )
  const hasActiveTrim = shapes.some(
    (shape) => (shape.trimPathStart ?? 0) !== 0 || (shape.trimPathEnd ?? 100) !== 100,
  )
  const appearanceVisible = !isMaskOnly

  return {
    isSingleOpenPath,
    isMaskOnly,
    showPathClosure: singlePath !== null && !isMaskOnly,
    showFill: appearanceVisible && !isSingleOpenPath,
    showStroke: appearanceVisible,
    showLineCap: appearanceVisible && allStrokesVisible && (hasOpenEndpoint || hasActiveTrim),
    showLineJoin:
      appearanceVisible && allStrokesVisible && shapes.length > 0 && shapes.every(pathHasJoin),
    showTrimPaths: appearanceVisible && allStrokesVisible,
    showTaper: appearanceVisible && allStrokesVisible,
    showNoAppearanceNotice:
      appearanceVisible &&
      shapes.length > 0 &&
      shapes.every((shape) => !hasEnabledFill(shape) && !hasEnabledStroke(shape)),
  }
}

/** Preserve visibility when a filled closed path becomes stroke-only. */
export function getPathClosureUpdates(shape: ShapeItem, closed: boolean): Partial<ShapeItem> {
  if (closed) return { pathClosed: true }

  const wasClosed = shape.pathClosed ?? true
  const hadVisibleFill = shape.fillEnabled ?? true
  if (!wasClosed || !hadVisibleFill || hasEnabledStroke(shape)) {
    return { pathClosed: false, fillEnabled: false }
  }

  return {
    pathClosed: false,
    fillEnabled: false,
    strokeEnabled: true,
    strokeColor: shape.strokeColor || '#3b82f6',
    strokeWidth: (shape.strokeWidth ?? 0) > 0 ? shape.strokeWidth : 4,
    strokeLineCap: shape.strokeLineCap ?? 'round',
  }
}
