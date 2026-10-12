// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import {
  getChangedPathVertexValues,
  getPathVertexAnimatableProperties,
  getPathVertexPropertyValue,
  setPathVertexPropertyValue,
} from './path-animatable-properties'

const vertices: MaskVertex[] = [
  {
    position: [0.25, 0.5],
    inHandle: [-0.1, 0],
    outHandle: [0.2, 0.1],
    tangentMode: 'broken',
  },
]

describe('path animatable properties', () => {
  it('maps every vertex coordinate to a stable scalar channel', () => {
    expect(getPathVertexAnimatableProperties(vertices)).toEqual([
      'pathVertex:0:positionX',
      'pathVertex:0:positionY',
      'pathVertex:0:inX',
      'pathVertex:0:inY',
      'pathVertex:0:outX',
      'pathVertex:0:outY',
    ])
    expect(getPathVertexPropertyValue(vertices, 'pathVertex:0:positionY')).toBe(0.5)
  })

  it('updates one channel without mutating the remaining topology', () => {
    const next = structuredClone(vertices)
    expect(setPathVertexPropertyValue(next, 'pathVertex:0:outY', 0.35)).toBe(true)
    expect(next[0]?.outHandle).toEqual([0.2, 0.35])
    expect(next[0]?.position).toEqual(vertices[0]?.position)
  })

  it('reports only coordinates that changed when topology matches', () => {
    const next = structuredClone(vertices)
    next[0]!.position = [0.75, 0.5]
    expect(getChangedPathVertexValues(vertices, next)).toEqual([
      { property: 'pathVertex:0:positionX', value: 0.75 },
    ])
  })
})
