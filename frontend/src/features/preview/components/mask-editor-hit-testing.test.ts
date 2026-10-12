// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import { hitTestMaskVertices } from './mask-editor-hit-testing'

const vertices: MaskVertex[] = [
  { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
  { position: [100, 0], inHandle: [0, 0], outHandle: [0, 0] },
  { position: [100, 100], inHandle: [0, 0], outHandle: [0, 0] },
]

const baseOptions = {
  vertices,
  screenX: 50,
  screenY: 50,
  hitRadius: 2,
  curveHitTestSteps: 12,
  vertexToScreen: (vertex: MaskVertex): [number, number] => vertex.position,
  handleToScreen: (vertex: MaskVertex, type: 'in' | 'out'): [number, number] => [
    vertex.position[0] + vertex[`${type}Handle`][0],
    vertex.position[1] + vertex[`${type}Handle`][1],
  ],
}

describe('hitTestMaskVertices', () => {
  it('does not invent a closing segment or fill hit for an open path', () => {
    expect(hitTestMaskVertices({ ...baseOptions, closed: false })).toBeNull()
    expect(hitTestMaskVertices({ ...baseOptions, closed: true })).toEqual({
      type: 'segment',
      index: 2,
    })
  })
})
