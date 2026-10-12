export interface TaperPathValues {
  taperStartWidth?: number
  taperEndWidth?: number
  taperStartLength?: number
  taperEndLength?: number
}

export interface TaperStrokeSegment {
  offset: number
  length: number
  widthScale: number
  isFirst: boolean
  isLast: boolean
}

const SEGMENT_COUNT = 48

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function hasActiveTaper(values: TaperPathValues): boolean {
  return (
    ((values.taperStartLength ?? 0) > 0 && (values.taperStartWidth ?? 100) !== 100) ||
    ((values.taperEndLength ?? 0) > 0 && (values.taperEndWidth ?? 100) !== 100)
  )
}

export function getTaperWidthScale(progress: number, values: TaperPathValues): number {
  const position = clampPercent(progress * 100)
  const startLength = clampPercent(values.taperStartLength ?? 0)
  const endLength = clampPercent(values.taperEndLength ?? 0)
  const startWidth = Math.max(0, values.taperStartWidth ?? 100) / 100
  const endWidth = Math.max(0, values.taperEndWidth ?? 100) / 100

  const startScale =
    startLength > 0 && position < startLength
      ? startWidth + (1 - startWidth) * (position / startLength)
      : 1
  const distanceFromEnd = 100 - position
  const endScale =
    endLength > 0 && distanceFromEnd < endLength
      ? endWidth + (1 - endWidth) * (distanceFromEnd / endLength)
      : 1

  return startScale * endScale
}

export function getTaperStrokeSegments(
  values: TaperPathValues & {
    trimPathStart?: number
    trimPathEnd?: number
    trimPathOffset?: number
  },
): TaperStrokeSegment[] {
  if (!hasActiveTaper(values)) return []

  const start = clampPercent(values.trimPathStart ?? 0)
  const end = clampPercent(values.trimPathEnd ?? 100)
  const fullPath = start === 0 && end === 100
  const visibleLength = fullPath ? 100 : (((end - start) % 100) + 100) % 100
  if (visibleLength === 0) return []

  const offset = ((values.trimPathOffset ?? 0) / 360) * 100
  const segmentLength = visibleLength / SEGMENT_COUNT
  const overlap = Math.min(segmentLength * 0.2, 0.08)

  return Array.from({ length: SEGMENT_COUNT }, (_, index) => {
    const progress = (index + 0.5) / SEGMENT_COUNT
    return {
      offset: start + offset + index * segmentLength,
      length: Math.min(100, segmentLength + overlap),
      widthScale: getTaperWidthScale(progress, values),
      isFirst: index === 0,
      isLast: index === SEGMENT_COUNT - 1,
    }
  })
}
