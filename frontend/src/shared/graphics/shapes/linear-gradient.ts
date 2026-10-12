import type { ShapeStyleFields } from '@/types/timeline'

const DEFAULT_SHAPE_GRADIENT_START_COLOR = '#3b82f6'
export const DEFAULT_SHAPE_GRADIENT_END_COLOR = '#8b5cf6'
export const DEFAULT_SHAPE_GRADIENT_ANGLE = 0

export interface LinearGradientUnitEndpoints {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export interface ResolvedShapeLinearGradient {
  startColor: string
  endColor: string
  angle: number
}

export type SwappedShapeLinearGradientColors = Pick<
  ShapeStyleFields,
  'fillColor' | 'gradientStartColor' | 'gradientEndColor'
>

export function resolveShapeLinearGradient(
  shape: Pick<
    ShapeStyleFields,
    'fillType' | 'fillColor' | 'gradientStartColor' | 'gradientEndColor' | 'gradientAngle'
  >,
): ResolvedShapeLinearGradient | null {
  if (shape.fillType !== 'linear') return null

  return {
    startColor: shape.gradientStartColor || shape.fillColor || DEFAULT_SHAPE_GRADIENT_START_COLOR,
    endColor: shape.gradientEndColor || DEFAULT_SHAPE_GRADIENT_END_COLOR,
    angle: Number.isFinite(shape.gradientAngle)
      ? (shape.gradientAngle ?? DEFAULT_SHAPE_GRADIENT_ANGLE)
      : DEFAULT_SHAPE_GRADIENT_ANGLE,
  }
}

export function getSwappedShapeLinearGradientColors(
  shape: Pick<
    ShapeStyleFields,
    'fillType' | 'fillColor' | 'gradientStartColor' | 'gradientEndColor' | 'gradientAngle'
  >,
): SwappedShapeLinearGradientColors | null {
  const gradient = resolveShapeLinearGradient(shape)
  if (!gradient) return null

  return {
    fillColor: gradient.endColor,
    gradientStartColor: gradient.endColor,
    gradientEndColor: gradient.startColor,
  }
}

/**
 * Returns endpoints on the edge of a normalized 0-1 box.
 * Zero degrees runs left-to-right and positive angles rotate clockwise.
 */
export function getLinearGradientUnitEndpoints(angleDegrees: number): LinearGradientUnitEndpoints {
  const radians = (angleDegrees * Math.PI) / 180
  const directionX = Math.cos(radians)
  const directionY = Math.sin(radians)
  const extent = 0.5 / Math.max(Math.abs(directionX), Math.abs(directionY), 1e-6)

  return {
    start: {
      x: 0.5 - directionX * extent,
      y: 0.5 - directionY * extent,
    },
    end: {
      x: 0.5 + directionX * extent,
      y: 0.5 + directionY * extent,
    },
  }
}
