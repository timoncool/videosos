import type { CropSettings } from '@/types/transform'
import {
  resolveCropSettings,
  type Rect,
  type ResolvedCropSettings,
} from '@/shared/utils/media-crop'
import type { Point } from '../types/gizmo'

export type CropEdge = 'left' | 'right' | 'top' | 'bottom'

export const CROP_EDGE_PROPERTY = {
  left: 'cropLeft',
  right: 'cropRight',
  top: 'cropTop',
  bottom: 'cropBottom',
} as const

const MIN_VISIBLE_RATIO = 0.001

/**
 * Resolve one crop-handle drag in item-local coordinates. Crop is stored as a
 * source ratio, while pointer positions arrive in canvas pixels; the contained
 * media rectangle is the bridge between the two spaces.
 */
export function calculateCropFromDrag({
  edge,
  startCrop,
  startPoint,
  currentPoint,
  rotation,
  mediaRect,
  sourceDimension,
}: {
  edge: CropEdge
  startCrop: CropSettings | undefined
  startPoint: Point
  currentPoint: Point
  rotation: number
  mediaRect: Rect
  /** Intrinsic source width/height for the dragged edge, in pixels. */
  sourceDimension: number
}): ResolvedCropSettings {
  const crop = resolveCropSettings(startCrop)
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const worldDeltaX = currentPoint.x - startPoint.x
  const worldDeltaY = currentPoint.y - startPoint.y

  // Inverse-rotate the pointer delta so a rotated clip still crops along its
  // own horizontal and vertical axes.
  const localDeltaX = worldDeltaX * cos + worldDeltaY * sin
  const localDeltaY = -worldDeltaX * sin + worldDeltaY * cos
  const horizontal = edge === 'left' || edge === 'right'
  const dimension = horizontal ? mediaRect.width : mediaRect.height
  if (
    !Number.isFinite(dimension) ||
    dimension <= 0 ||
    !Number.isFinite(sourceDimension) ||
    sourceDimension <= 0
  ) {
    return crop
  }

  const opposite =
    edge === 'left'
      ? crop.right
      : edge === 'right'
        ? crop.left
        : edge === 'top'
          ? crop.bottom
          : crop.top
  const signedDelta =
    edge === 'left'
      ? localDeltaX
      : edge === 'right'
        ? -localDeltaX
        : edge === 'top'
          ? localDeltaY
          : -localDeltaY
  const startInset = crop[edge] * dimension
  const maxInset = Math.max(0, (1 - opposite - MIN_VISIBLE_RATIO) * dimension)
  const nextInset = Math.min(maxInset, Math.max(0, startInset + signedDelta))
  const requestedSourcePixels = Math.round((nextInset / dimension) * sourceDimension)
  // Keep at least one intrinsic source pixel visible on this axis.
  const maxSourcePixels = Math.max(0, Math.floor((1 - opposite) * sourceDimension) - 1)
  const nextSourcePixels = Math.min(maxSourcePixels, Math.max(0, requestedSourcePixels))

  return { ...crop, [edge]: nextSourcePixels / sourceDimension }
}
