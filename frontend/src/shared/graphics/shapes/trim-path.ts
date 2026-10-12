export interface TrimPathValues {
  trimPathStart?: number
  trimPathEnd?: number
  trimPathOffset?: number
}

export function getTrimPathSvgProps({
  trimPathStart = 0,
  trimPathEnd = 100,
  trimPathOffset = 0,
}: TrimPathValues) {
  const start = Math.max(0, Math.min(100, trimPathStart))
  const end = Math.max(0, Math.min(100, trimPathEnd))
  if (start === 0 && end === 100) return {}

  const visible = (((end - start) % 100) + 100) % 100
  const offsetPercent = (trimPathOffset / 360) * 100
  return {
    pathLength: 100,
    strokeDasharray: `${visible} ${100 - visible}`,
    strokeDashoffset: -(start + offsetPercent),
  }
}
