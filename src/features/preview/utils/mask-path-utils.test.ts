// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import { insertVertexBetween } from './mask-path-utils'

function cubicPoint(vertices: MaskVertex[], t: number): [number, number] {
  const start = vertices[0]!
  const end = vertices.at(-1)!
  const p0 = start.position
  const p1: [number, number] = [p0[0] + start.outHandle[0], p0[1] + start.outHandle[1]]
  const p3 = end.position
  const p2: [number, number] = [p3[0] + end.inHandle[0], p3[1] + end.inHandle[1]]
  const mt = 1 - t
  return [
    mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0],
    mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1],
  ]
}

describe('insertVertexBetween', () => {
  it('splits a cubic without changing its geometry', () => {
    const path: MaskVertex[] = [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0.25, 0.75] },
      { position: [1, 1], inHandle: [-0.25, 0.5], outHandle: [0, 0] },
    ]
    const originalMidpoint = cubicPoint(path, 0.5)
    const split = insertVertexBetween(path, 0, 0.5)

    expect(split).toHaveLength(3)
    expect(split[1]?.position[0]).toBeCloseTo(originalMidpoint[0])
    expect(split[1]?.position[1]).toBeCloseTo(originalMidpoint[1])
    expect(split[1]?.tangentMode).toBe('continuous')

    const leftMidpoint = cubicPoint(split.slice(0, 2), 0.5)
    const rightMidpoint = cubicPoint(split.slice(1), 0.5)
    expect(leftMidpoint[0]).toBeCloseTo(cubicPoint(path, 0.25)[0])
    expect(leftMidpoint[1]).toBeCloseTo(cubicPoint(path, 0.25)[1])
    expect(rightMidpoint[0]).toBeCloseTo(cubicPoint(path, 0.75)[0])
    expect(rightMidpoint[1]).toBeCloseTo(cubicPoint(path, 0.75)[1])
  })
})
