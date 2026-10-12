// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import {
  buildBezierPathData,
  flattenBezierPath,
  reversePathVertices,
  rotateClosedPathStart,
} from './bezier-path'

const line: MaskVertex[] = [
  { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
  { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
]

describe('bezier path geometry', () => {
  it('keeps open paths open and measures their cumulative length', () => {
    expect(buildBezierPathData(line, 200, 100, false)).toBe('M 0 0 L 200 0')
    const flattened = flattenBezierPath(line, 200, 100, false)
    expect(flattened.totalLength).toBe(200)
    expect(flattened.points.map((point) => point.progress)).toEqual([0, 1])
  })

  it('closes paths only when requested', () => {
    expect(buildBezierPathData(line, 200, 100, true)).toBe('M 0 0 L 200 0 L 0 0 Z')
    expect(flattenBezierPath(line, 200, 100, true).totalLength).toBe(400)
  })

  it('reverses traversal without changing control point positions', () => {
    const curved: MaskVertex[] = [
      { position: [0, 0], inHandle: [-0.1, 0], outHandle: [0.2, 0.3] },
      { position: [1, 1], inHandle: [-0.3, -0.2], outHandle: [0.1, 0] },
    ]
    const reversed = reversePathVertices(curved)
    expect(reversed[0]?.position).toEqual([1, 1])
    expect(reversed[0]?.outHandle).toEqual([-0.3, -0.2])
    expect(reversed[1]?.inHandle).toEqual([0.2, 0.3])
  })

  it('rotates the first vertex without changing the closed path ordering', () => {
    const vertices: MaskVertex[] = [
      ...line,
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ]
    expect(rotateClosedPathStart(vertices, 2).map((vertex) => vertex.position)).toEqual([
      [1, 1],
      [0, 0],
      [1, 0],
    ])
  })
})
