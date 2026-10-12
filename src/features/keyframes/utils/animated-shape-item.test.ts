import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem } from '@/types/timeline'
import { resolveAnimatedShapeItem } from './animated-shape-item'

const shape: ShapeItem = {
  id: 'shape-1',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 60,
  label: 'Path',
  shapeType: 'path',
  fillColor: '#00000000',
  strokeColor: '#ffffff',
  strokeWidth: 4,
}

describe('resolveAnimatedShapeItem', () => {
  it('interpolates path vertices and bezier handles without changing topology', () => {
    const pathShape: ShapeItem = {
      ...shape,
      pathVertices: [
        {
          position: [0, 0],
          inHandle: [0, 0],
          outHandle: [0.25, 0],
          tangentMode: 'broken',
        },
        {
          position: [1, 1],
          inHandle: [-0.25, 0],
          outHandle: [0, 0],
          tangentMode: 'broken',
        },
      ],
    }
    const keyframes: ItemKeyframes = {
      itemId: pathShape.id,
      properties: [
        {
          property: 'pathVertex:0:positionX',
          keyframes: [
            { id: 'path-a', frame: 0, value: 0, easing: 'linear' },
            { id: 'path-b', frame: 30, value: 1, easing: 'linear' },
          ],
        },
        {
          property: 'pathVertex:1:inY',
          keyframes: [
            { id: 'handle-a', frame: 0, value: 0, easing: 'linear' },
            { id: 'handle-b', frame: 30, value: -0.5, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = resolveAnimatedShapeItem(pathShape, keyframes, 15)
    expect(resolved.pathVertices).toHaveLength(2)
    expect(resolved.pathVertices?.[0]?.position).toEqual([0.5, 0])
    expect(resolved.pathVertices?.[1]?.inHandle).toEqual([-0.25, -0.25])
    expect(resolved.pathVertices?.[0]?.tangentMode).toBe('broken')
    expect(pathShape.pathVertices?.[0]?.position).toEqual([0, 0])
  })

  it('interpolates trim-path properties from their After Effects-style defaults', () => {
    const keyframes: ItemKeyframes = {
      itemId: shape.id,
      properties: [
        {
          property: 'trimPathEnd',
          keyframes: [
            { id: 'a', frame: 0, value: 0, easing: 'linear' },
            { id: 'b', frame: 30, value: 100, easing: 'linear' },
          ],
        },
        {
          property: 'trimPathOffset',
          keyframes: [{ id: 'c', frame: 0, value: 45, easing: 'linear' }],
        },
      ],
    }

    const resolved = resolveAnimatedShapeItem(shape, keyframes, 15)
    expect(resolved.trimPathStart).toBeUndefined()
    expect(resolved.trimPathEnd).toBe(50)
    expect(resolved.trimPathOffset).toBe(45)
  })

  it('interpolates taper properties from neutral stroke defaults', () => {
    const keyframes: ItemKeyframes = {
      itemId: shape.id,
      properties: [
        {
          property: 'taperStartWidth',
          keyframes: [
            { id: 'a', frame: 0, value: 100, easing: 'linear' },
            { id: 'b', frame: 30, value: 0, easing: 'linear' },
          ],
        },
        {
          property: 'taperStartLength',
          keyframes: [{ id: 'c', frame: 0, value: 40, easing: 'linear' }],
        },
      ],
    }

    const resolved = resolveAnimatedShapeItem(shape, keyframes, 15)
    expect(resolved.taperStartWidth).toBe(50)
    expect(resolved.taperStartLength).toBe(40)
  })

  it('resolves a shape property linked to a transform property at composition time', () => {
    const source: ShapeItem = {
      ...shape,
      id: 'source-shape',
      from: 10,
      transform: { x: 25 },
    }
    const target: ShapeItem = { ...shape, id: 'target-shape', from: 20 }
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'source-a', frame: 0, value: 20, easing: 'linear' },
            { id: 'source-b', frame: 20, value: 60, easing: 'linear' },
          ],
        },
      ],
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'trimPathEnd',
          sourceItemId: source.id,
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const items = new Map([
      [source.id, source],
      [target.id, target],
    ])
    const keyframes = new Map([
      [source.id, sourceKeyframes],
      [target.id, targetKeyframes],
    ])

    const resolved = resolveAnimatedShapeItem(target, targetKeyframes, 5, {
      globalFrame: 25,
      canvas: { width: 1920, height: 1080, fps: 30 },
      getItem: (itemId) => items.get(itemId),
      getKeyframes: (itemId) => keyframes.get(itemId),
    })

    expect(resolved.trimPathEnd).toBe(50)
  })
})
