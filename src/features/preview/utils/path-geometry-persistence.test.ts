// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useTransitionsStore } from '@/features/preview/deps/timeline-store'
import type { ItemKeyframes } from '@/types/keyframe'
import type { MaskVertex } from '@/types/masks'
import type { ShapeItem } from '@/types/timeline'
import { buildPathGeometryPersistence } from './path-geometry-persistence'

const vertices: MaskVertex[] = [
  { position: [0, 0], inHandle: [0, 0], outHandle: [0.25, 0] },
  { position: [1, 1], inHandle: [-0.25, 0], outHandle: [0, 0] },
]

const item: ShapeItem = {
  id: 'path-1',
  type: 'shape',
  trackId: 'track-1',
  from: 10,
  durationInFrames: 60,
  label: 'Path',
  shapeType: 'path',
  pathVertices: vertices,
  fillColor: '#00000000',
  strokeColor: '#ffffff',
  strokeWidth: 4,
}

beforeEach(() => {
  useTransitionsStore.setState({ transitions: [] })
})

describe('buildPathGeometryPersistence', () => {
  it('keeps ordinary path edits in the static item', () => {
    const next = structuredClone(vertices)
    next[0]!.position[0] = 0.2

    const result = buildPathGeometryPersistence({
      item,
      itemKeyframes: undefined,
      nextVertices: next,
      currentFrame: 20,
    })

    expect(result.blocked).toBeNull()
    expect(result.pathVertices?.[0]?.position[0]).toBe(0.2)
    expect(result.autoKeyframeOperations).toEqual([])
  })

  it('adds changed coordinates at the current frame once path animation exists', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'pathVertex:0:positionX',
          keyframes: [{ id: 'start', frame: 0, value: 0, easing: 'linear' }],
        },
      ],
    }
    const next = structuredClone(vertices)
    next[0]!.position[0] = 0.4

    const result = buildPathGeometryPersistence({
      item,
      itemKeyframes,
      nextVertices: next,
      currentFrame: 20,
    })

    expect(result.pathVertices).toBeUndefined()
    expect(result.autoKeyframeOperations).toEqual([
      expect.objectContaining({
        type: 'add',
        property: 'pathVertex:0:positionX',
        frame: 10,
        value: 0.4,
      }),
    ])
  })

  it('blocks topology changes and edits outside the item once animated', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'pathVertex:0:positionX',
          keyframes: [{ id: 'start', frame: 0, value: 0, easing: 'linear' }],
        },
      ],
    }

    expect(
      buildPathGeometryPersistence({
        item,
        itemKeyframes,
        nextVertices: vertices.slice(0, 1),
        currentFrame: 20,
      }).blocked,
    ).toBe('topology')

    const next = structuredClone(vertices)
    next[0]!.position[0] = 0.5
    expect(
      buildPathGeometryPersistence({
        item,
        itemKeyframes,
        nextVertices: next,
        currentFrame: 100,
      }).blocked,
    ).toBe('frame')
  })
})
