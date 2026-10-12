import type { FlattenedPath, FlattenedPathPoint } from './bezier-path'
import { getTaperWidthScale, type TaperPathValues } from './taper-path'

export interface TaperOutlineCap {
  x: number
  y: number
  radius: number
}

export interface TaperOutline {
  path: string
  caps: TaperOutlineCap[]
}

function buildCirclePath({ x, y, radius }: TaperOutlineCap): string {
  return [
    `M ${x + radius} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${x - radius} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${x + radius} ${y}`,
    'Z',
  ].join(' ')
}

/**
 * Return one compound fill path for the tapered body and its round caps.
 * Painting the cap as a separate translucent shape darkens its overlap with
 * the body, so consumers should fill this path in one operation.
 */
export function getTaperedOutlineFillPath(outline: TaperOutline): string {
  return [outline.path, ...outline.caps.map(buildCirclePath)].join(' ')
}

interface TaperOutlineOptions extends TaperPathValues {
  strokeWidth: number
  lineCap?: 'butt' | 'round' | 'square'
  trimPathStart?: number
  trimPathEnd?: number
  trimPathOffset?: number
}

interface VisibleRange {
  start: number
  length: number
  visibleProgressStart: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1
}

function pointAtProgress(points: FlattenedPathPoint[], progress: number): FlattenedPathPoint {
  const target = clamp01(progress)
  if (target <= 0) return { ...points[0]!, progress: target }
  if (target >= 1) return { ...points.at(-1)!, progress: target }

  let low = 0
  let high = points.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle]!.progress < target) low = middle
    else high = middle
  }

  const from = points[low]!
  const to = points[high]!
  const span = Math.max(Number.EPSILON, to.progress - from.progress)
  const amount = (target - from.progress) / span
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    progress: target,
  }
}

function getVisibleRanges(path: FlattenedPath, options: TaperOutlineOptions): VisibleRange[] {
  const start = clamp01((options.trimPathStart ?? 0) / 100)
  const end = clamp01((options.trimPathEnd ?? 100) / 100)
  if (start === 0 && end === 1) {
    return [{ start: 0, length: 1, visibleProgressStart: 0 }]
  }

  const offset = (options.trimPathOffset ?? 0) / 360
  const length = wrap01(end - start)
  if (length <= 0) return []
  const shiftedStart = wrap01(start + offset)
  if (path.closed || shiftedStart + length <= 1) {
    return [{ start: shiftedStart, length, visibleProgressStart: 0 }]
  }

  // An AE-style trim phase is cyclic even on an open path. When the visible
  // interval crosses an endpoint, keep both endpoint fragments instead of
  // clamping/shrinking the stroke or joining the open endpoints together.
  const firstLength = 1 - shiftedStart
  const secondLength = length - firstLength
  return [
    { start: shiftedStart, length: firstLength, visibleProgressStart: 0 },
    {
      start: 0,
      length: secondLength,
      visibleProgressStart: firstLength / length,
    },
  ]
}

function buildSampledCenterlines(
  path: FlattenedPath,
  options: TaperOutlineOptions,
): FlattenedPathPoint[][] {
  const ranges = getVisibleRanges(path, options)
  const totalVisibleLength = ranges.reduce((sum, range) => sum + range.length, 0)
  if (totalVisibleLength <= 0) return []
  const totalSampleCount = Math.max(48, Math.min(256, Math.ceil(path.totalLength / 2)))

  return ranges.map((range) => {
    const sampleCount = Math.max(
      2,
      Math.ceil(totalSampleCount * (range.length / totalVisibleLength)),
    )
    return Array.from({ length: sampleCount + 1 }, (_, index) => {
      const rangeProgress = index / sampleCount
      const visibleProgress =
        range.visibleProgressStart + (rangeProgress * range.length) / totalVisibleLength
      const pathProgress = range.start + rangeProgress * range.length
      const point = pointAtProgress(path.points, path.closed ? wrap01(pathProgress) : pathProgress)
      return { ...point, progress: visibleProgress }
    })
  })
}

function normalize(dx: number, dy: number): [number, number] {
  const length = Math.hypot(dx, dy)
  return length > Number.EPSILON ? [dx / length, dy / length] : [1, 0]
}

function getSquareOffset(
  lineCap: TaperOutlineOptions['lineCap'],
  index: number,
  lastIndex: number,
  radius: number,
): number {
  if (lineCap !== 'square') return 0
  if (index === 0) return -radius
  return index === lastIndex ? radius : 0
}

function buildOutlineEdges(centerline: FlattenedPathPoint[], options: TaperOutlineOptions) {
  const left: Array<[number, number]> = []
  const right: Array<[number, number]> = []
  const radii: number[] = []
  const lastIndex = centerline.length - 1
  for (let index = 0; index < centerline.length; index++) {
    const point = centerline[index]!
    const previous = centerline[Math.max(0, index - 1)]!
    const next = centerline[Math.min(lastIndex, index + 1)]!
    const [tx, ty] = normalize(next.x - previous.x, next.y - previous.y)
    const radius = (options.strokeWidth * getTaperWidthScale(point.progress, options)) / 2
    const squareOffset = getSquareOffset(options.lineCap, index, lastIndex, radius)
    const x = point.x + tx * squareOffset
    const y = point.y + ty * squareOffset
    const nx = -ty
    const ny = tx
    left.push([x + nx * radius, y + ny * radius])
    right.push([x - nx * radius, y - ny * radius])
    radii.push(radius)
  }
  return { left, right, radii }
}

function buildRoundCaps(
  centerline: FlattenedPathPoint[],
  radii: number[],
  lineCap: TaperOutlineOptions['lineCap'],
): TaperOutlineCap[] {
  if (lineCap !== 'round') return []
  const caps: TaperOutlineCap[] = []
  const first = centerline[0]!
  const last = centerline.at(-1)!
  if (radii[0]! > 0) caps.push({ x: first.x, y: first.y, radius: radii[0]! })
  if (radii.at(-1)! > 0) caps.push({ x: last.x, y: last.y, radius: radii.at(-1)! })
  return caps
}

export function buildTaperedOutline(
  path: FlattenedPath,
  options: TaperOutlineOptions,
): TaperOutline | null {
  if (path.points.length < 2 || path.totalLength <= 0 || options.strokeWidth <= 0) return null
  const centerlines = buildSampledCenterlines(path, options).filter(
    (centerline) => centerline.length >= 2,
  )
  if (centerlines.length === 0) return null

  const commands: string[] = []
  const caps: TaperOutlineCap[] = []
  for (const centerline of centerlines) {
    const { left, right, radii } = buildOutlineEdges(centerline, options)
    commands.push(
      `M ${left[0]![0]} ${left[0]![1]}`,
      ...left.slice(1).map(([x, y]) => `L ${x} ${y}`),
      ...right.reverse().map(([x, y]) => `L ${x} ${y}`),
      'Z',
    )
    caps.push(...buildRoundCaps(centerline, radii, options.lineCap))
  }
  return { path: commands.join(' '), caps }
}
