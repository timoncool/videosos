import type { MaskVertex } from '@/types/masks'

export interface FlattenedPathPoint {
  x: number
  y: number
  /** Normalized cumulative arc length at this point. */
  progress: number
}

export interface FlattenedPath {
  points: FlattenedPathPoint[]
  totalLength: number
  closed: boolean
}

type Point = [number, number]

const DEFAULT_FLATNESS_TOLERANCE = 0.35
const MAX_SUBDIVISION_DEPTH = 12

function scaledPosition(vertex: MaskVertex, width: number, height: number): Point {
  return [vertex.position[0] * width, vertex.position[1] * height]
}

function scaledHandle(
  vertex: MaskVertex,
  handle: 'inHandle' | 'outHandle',
  width: number,
  height: number,
): Point {
  return [
    (vertex.position[0] + vertex[handle][0]) * width,
    (vertex.position[1] + vertex[handle][1]) * height,
  ]
}

function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const denominator = Math.hypot(dx, dy)
  if (denominator <= Number.EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1])
  return (
    Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / denominator
  )
}

function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tolerance: number,
  output: Point[],
  depth = 0,
): void {
  const flatness = Math.max(pointLineDistance(p1, p0, p3), pointLineDistance(p2, p0, p3))
  if (flatness <= tolerance || depth >= MAX_SUBDIVISION_DEPTH) {
    output.push(p3)
    return
  }

  const p01 = midpoint(p0, p1)
  const p12 = midpoint(p1, p2)
  const p23 = midpoint(p2, p3)
  const p012 = midpoint(p01, p12)
  const p123 = midpoint(p12, p23)
  const split = midpoint(p012, p123)
  flattenCubic(p0, p01, p012, split, tolerance, output, depth + 1)
  flattenCubic(split, p123, p23, p3, tolerance, output, depth + 1)
}

export function buildBezierPathData(
  vertices: MaskVertex[],
  width: number,
  height: number,
  closed: boolean,
): string {
  if (vertices.length === 0) return ''
  const first = scaledPosition(vertices[0]!, width, height)
  const parts = [`M ${first[0]} ${first[1]}`]
  const segmentCount = closed ? vertices.length : vertices.length - 1

  for (let index = 0; index < segmentCount; index++) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    const end = scaledPosition(next, width, height)
    const isStraight =
      current.outHandle[0] === 0 &&
      current.outHandle[1] === 0 &&
      next.inHandle[0] === 0 &&
      next.inHandle[1] === 0
    if (isStraight) {
      parts.push(`L ${end[0]} ${end[1]}`)
      continue
    }
    const cp1 = scaledHandle(current, 'outHandle', width, height)
    const cp2 = scaledHandle(next, 'inHandle', width, height)
    parts.push(`C ${cp1[0]} ${cp1[1]} ${cp2[0]} ${cp2[1]} ${end[0]} ${end[1]}`)
  }

  if (closed) parts.push('Z')
  return parts.join(' ')
}

export function flattenBezierPath(
  vertices: MaskVertex[],
  width: number,
  height: number,
  closed: boolean,
  tolerance = DEFAULT_FLATNESS_TOLERANCE,
): FlattenedPath {
  if (vertices.length < 2) return { points: [], totalLength: 0, closed }
  const rawPoints: Point[] = [scaledPosition(vertices[0]!, width, height)]
  const segmentCount = closed ? vertices.length : vertices.length - 1

  for (let index = 0; index < segmentCount; index++) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    const p0 = scaledPosition(current, width, height)
    const p3 = scaledPosition(next, width, height)
    const isStraight =
      current.outHandle[0] === 0 &&
      current.outHandle[1] === 0 &&
      next.inHandle[0] === 0 &&
      next.inHandle[1] === 0
    if (isStraight) {
      rawPoints.push(p3)
    } else {
      flattenCubic(
        p0,
        scaledHandle(current, 'outHandle', width, height),
        scaledHandle(next, 'inHandle', width, height),
        p3,
        Math.max(0.01, tolerance),
        rawPoints,
      )
    }
  }

  const cumulative = [0]
  for (let index = 1; index < rawPoints.length; index++) {
    const previous = rawPoints[index - 1]!
    const current = rawPoints[index]!
    cumulative.push(
      cumulative[index - 1]! + Math.hypot(current[0] - previous[0], current[1] - previous[1]),
    )
  }
  const totalLength = cumulative[cumulative.length - 1] ?? 0
  const points = rawPoints.map(([x, y], index) => ({
    x,
    y,
    progress: totalLength > 0 ? cumulative[index]! / totalLength : 0,
  }))
  return { points, totalLength, closed }
}

export function reversePathVertices(vertices: MaskVertex[]): MaskVertex[] {
  return [...vertices].reverse().map((vertex) => ({
    ...vertex,
    position: [...vertex.position] as Point,
    inHandle: [...vertex.outHandle] as Point,
    outHandle: [...vertex.inHandle] as Point,
  }))
}

export function rotateClosedPathStart(vertices: MaskVertex[], firstIndex: number): MaskVertex[] {
  if (vertices.length === 0) return []
  const normalizedIndex = ((firstIndex % vertices.length) + vertices.length) % vertices.length
  return [...vertices.slice(normalizedIndex), ...vertices.slice(0, normalizedIndex)]
}
