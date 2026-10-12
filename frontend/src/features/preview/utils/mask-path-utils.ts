/**
 * Path utilities for the bezier mask editor used by shape masks.
 */

import type { MaskVertex } from '@/types/masks'

const DEFAULT_BEZIER_HANDLE_SCALE = 0.25

function cloneVertex(vertex: MaskVertex): MaskVertex {
  return {
    ...vertex,
    position: [...vertex.position] as [number, number],
    inHandle: [...vertex.inHandle] as [number, number],
    outHandle: [...vertex.outHandle] as [number, number],
  }
}

function getVectorLength([x, y]: readonly [number, number]): number {
  return Math.hypot(x, y)
}

function normalizeVector([x, y]: readonly [number, number]): [number, number] {
  const length = Math.hypot(x, y)
  if (length <= Number.EPSILON) {
    return [0, 0]
  }
  return [x / length, y / length]
}

function getSmoothTangentDirection(
  prevPosition: readonly [number, number],
  currentPosition: readonly [number, number],
  nextPosition: readonly [number, number],
): [number, number] {
  const incoming = normalizeVector([
    currentPosition[0] - prevPosition[0],
    currentPosition[1] - prevPosition[1],
  ])
  const outgoing = normalizeVector([
    nextPosition[0] - currentPosition[0],
    nextPosition[1] - currentPosition[1],
  ])
  const combined = normalizeVector([incoming[0] + outgoing[0], incoming[1] + outgoing[1]])

  if (combined[0] !== 0 || combined[1] !== 0) {
    return combined
  }

  if (outgoing[0] !== 0 || outgoing[1] !== 0) {
    return outgoing
  }

  return incoming
}

/**
 * Insert a new vertex on the mask path segment between two existing vertices.
 * Returns a new vertices array with the vertex inserted at the midpoint.
 */
export function insertVertexBetween(
  vertices: MaskVertex[],
  afterIndex: number,
  t = 0.5,
): MaskVertex[] {
  const curr = vertices[afterIndex]!
  const next = vertices[(afterIndex + 1) % vertices.length]!

  const clampedT = Math.max(0, Math.min(1, t))
  const lerp = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    a[0] + (b[0] - a[0]) * clampedT,
    a[1] + (b[1] - a[1]) * clampedT,
  ]
  const p0 = curr.position
  const p1: [number, number] = [
    curr.position[0] + curr.outHandle[0],
    curr.position[1] + curr.outHandle[1],
  ]
  const p2: [number, number] = [
    next.position[0] + next.inHandle[0],
    next.position[1] + next.inHandle[1],
  ]
  const p3 = next.position
  const q0 = lerp(p0, p1)
  const q1 = lerp(p1, p2)
  const q2 = lerp(p2, p3)
  const r0 = lerp(q0, q1)
  const r1 = lerp(q1, q2)
  const split = lerp(r0, r1)
  const hasCurve =
    curr.outHandle[0] !== 0 ||
    curr.outHandle[1] !== 0 ||
    next.inHandle[0] !== 0 ||
    next.inHandle[1] !== 0

  const newVertex: MaskVertex = {
    position: split,
    inHandle: hasCurve ? [r0[0] - split[0], r0[1] - split[1]] : [0, 0],
    outHandle: hasCurve ? [r1[0] - split[0], r1[1] - split[1]] : [0, 0],
    tangentMode: hasCurve ? 'continuous' : 'corner',
  }

  const result = vertices.map(cloneVertex)
  result[afterIndex]!.outHandle = hasCurve ? [q0[0] - p0[0], q0[1] - p0[1]] : [0, 0]
  const nextIndex = (afterIndex + 1) % vertices.length
  result[nextIndex]!.inHandle = hasCurve ? [q2[0] - p3[0], q2[1] - p3[1]] : [0, 0]
  result.splice(afterIndex + 1, 0, newVertex)
  return result
}

/**
 * Convert a vertex to a sharp corner by removing both bezier handles.
 */
export function convertVertexToCorner(vertices: MaskVertex[], index: number): MaskVertex[] {
  if (index < 0 || index >= vertices.length) {
    return vertices
  }

  const result = vertices.map(cloneVertex)
  result[index] = {
    ...result[index]!,
    inHandle: [0, 0],
    outHandle: [0, 0],
    tangentMode: 'corner',
  }
  return result
}

/**
 * Convert a vertex to a smooth bezier knot.
 *
 * Existing handle lengths are preserved when present. If the knot is currently
 * a corner, new handle lengths are synthesized from neighboring segment lengths.
 */
// fallow-ignore-next-line complexity
export function convertVertexToBezier(
  vertices: MaskVertex[],
  index: number,
  closed = true,
): MaskVertex[] {
  if (vertices.length < 2 || index < 0 || index >= vertices.length) {
    return vertices
  }

  const result = vertices.map(cloneVertex)
  const vertex = result[index]!
  const prev =
    !closed && index === 0 ? vertex : result[(index - 1 + result.length) % result.length]!
  const next =
    !closed && index === result.length - 1 ? vertex : result[(index + 1) % result.length]!

  const existingInLength = getVectorLength(vertex.inHandle)
  const existingOutLength = getVectorLength(vertex.outHandle)
  const prevDistance = Math.hypot(
    vertex.position[0] - prev.position[0],
    vertex.position[1] - prev.position[1],
  )
  const nextDistance = Math.hypot(
    next.position[0] - vertex.position[0],
    next.position[1] - vertex.position[1],
  )
  const inLength = existingInLength || prevDistance * DEFAULT_BEZIER_HANDLE_SCALE
  const outLength = existingOutLength || nextDistance * DEFAULT_BEZIER_HANDLE_SCALE

  const existingInDirection =
    existingInLength > 0 ? normalizeVector([-vertex.inHandle[0], -vertex.inHandle[1]]) : null
  const existingOutDirection = existingOutLength > 0 ? normalizeVector(vertex.outHandle) : null

  const combinedExistingDirection =
    existingInDirection && existingOutDirection
      ? normalizeVector([
          existingInDirection[0] + existingOutDirection[0],
          existingInDirection[1] + existingOutDirection[1],
        ])
      : null

  const direction =
    combinedExistingDirection &&
    (combinedExistingDirection[0] !== 0 || combinedExistingDirection[1] !== 0)
      ? combinedExistingDirection
      : (existingOutDirection ??
        existingInDirection ??
        getSmoothTangentDirection(prev.position, vertex.position, next.position))

  if (direction[0] === 0 && direction[1] === 0) {
    return convertVertexToCorner(result, index)
  }

  vertex.inHandle = [-direction[0] * inLength, -direction[1] * inLength]
  vertex.outHandle = [direction[0] * outLength, direction[1] * outLength]
  vertex.tangentMode = 'continuous'
  return result
}

/**
 * Remove a vertex from the mask path.
 * Returns null if removing would leave fewer than 3 vertices.
 */
export function removeVertex(
  vertices: MaskVertex[],
  index: number,
  minimumVertices = 3,
): MaskVertex[] | null {
  if (vertices.length <= minimumVertices) return null
  const result = [...vertices]
  result.splice(index, 1)
  return result
}
