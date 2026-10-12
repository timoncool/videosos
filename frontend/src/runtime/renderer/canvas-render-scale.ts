import type { ShapeItem, SubtitleSegmentItem, TextItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'

export interface LogicalCanvasSize {
  width: number
  height: number
  logicalWidth?: number
  logicalHeight?: number
}

export interface CanvasRenderScale {
  x: number
  y: number
  uniform: number
}

export function getCanvasRenderScale(canvas: LogicalCanvasSize): CanvasRenderScale {
  const logicalWidth = Math.max(1, canvas.logicalWidth ?? canvas.width)
  const logicalHeight = Math.max(1, canvas.logicalHeight ?? canvas.height)
  const x = canvas.width / logicalWidth
  const y = canvas.height / logicalHeight
  return { x, y, uniform: Math.min(x, y) }
}

export function getLogicalCanvasSize<TCanvas extends LogicalCanvasSize>(canvas: TCanvas): TCanvas {
  if (canvas.logicalWidth === undefined && canvas.logicalHeight === undefined) return canvas
  return {
    ...canvas,
    width: canvas.logicalWidth ?? canvas.width,
    height: canvas.logicalHeight ?? canvas.height,
  }
}

export function scaleResolvedTransformForCanvas(
  transform: ResolvedTransform,
  canvas: LogicalCanvasSize,
): ResolvedTransform {
  const scale = getCanvasRenderScale(canvas)
  if (scale.x === 1 && scale.y === 1) return transform
  return {
    ...transform,
    x: transform.x * scale.x,
    y: transform.y * scale.y,
    width: transform.width * scale.x,
    height: transform.height * scale.y,
    anchorX: transform.anchorX * scale.x,
    anchorY: transform.anchorY * scale.y,
    cornerRadius: transform.cornerRadius * scale.uniform,
  }
}

export function scalePartialTransformForCanvas(
  transform: Partial<ResolvedTransform>,
  canvas: LogicalCanvasSize,
): Partial<ResolvedTransform> {
  const scale = getCanvasRenderScale(canvas)
  if (scale.x === 1 && scale.y === 1) return transform
  return {
    ...transform,
    x: scaleOptional(transform.x, scale.x),
    y: scaleOptional(transform.y, scale.y),
    width: scaleOptional(transform.width, scale.x),
    height: scaleOptional(transform.height, scale.y),
    anchorX: scaleOptional(transform.anchorX, scale.x),
    anchorY: scaleOptional(transform.anchorY, scale.y),
    cornerRadius: scaleOptional(transform.cornerRadius, scale.uniform),
  }
}

function scaleOptional(value: number | undefined, scale: number): number | undefined {
  return value === undefined ? undefined : value * scale
}

function scaleTextStyleForCanvas<TItem extends TextItem | SubtitleSegmentItem>(
  item: TItem,
  canvas: LogicalCanvasSize,
): TItem {
  const scale = getCanvasRenderScale(canvas)
  if (scale.x === 1 && scale.y === 1) return item

  return {
    ...item,
    fontSize: scaleOptional(item.fontSize, scale.uniform),
    letterSpacing: scaleOptional(item.letterSpacing, scale.uniform),
    backgroundRadius: scaleOptional(item.backgroundRadius, scale.uniform),
    textPadding: scaleOptional(item.textPadding, scale.uniform),
    ...('textSpans' in item
      ? {
          textSpans: item.textSpans?.map((span) => ({
            ...span,
            fontSize: scaleOptional(span.fontSize, scale.uniform),
            letterSpacing: scaleOptional(span.letterSpacing, scale.uniform),
          })),
        }
      : {}),
    textShadow: item.textShadow
      ? {
          ...item.textShadow,
          offsetX: item.textShadow.offsetX * scale.x,
          offsetY: item.textShadow.offsetY * scale.y,
          blur: item.textShadow.blur * scale.uniform,
        }
      : item.textShadow,
    stroke: item.stroke
      ? { ...item.stroke, width: item.stroke.width * scale.uniform }
      : item.stroke,
  }
}

export function scaleTextItemForCanvas(item: TextItem, canvas: LogicalCanvasSize): TextItem {
  return scaleTextStyleForCanvas(item, canvas)
}

export function scaleSubtitleItemForCanvas(
  item: SubtitleSegmentItem,
  canvas: LogicalCanvasSize,
): SubtitleSegmentItem {
  return scaleTextStyleForCanvas(item, canvas)
}

export function scaleShapeItemForCanvas(item: ShapeItem, canvas: LogicalCanvasSize): ShapeItem {
  const scale = getCanvasRenderScale(canvas)
  if (scale.uniform === 1) return item
  return {
    ...item,
    strokeWidth: scaleOptional(item.strokeWidth, scale.uniform),
    cornerRadius: scaleOptional(item.cornerRadius, scale.uniform),
    maskFeather: scaleOptional(item.maskFeather, scale.uniform),
  }
}
