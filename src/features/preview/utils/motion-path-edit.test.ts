// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes, VectorKeyframe } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'
import {
  buildDefaultSpatialTangents,
  updateSpatialTangent,
  worldPointToPositionKeyframeValue,
} from './motion-path-edit'

const keyframes: VectorKeyframe[] = [
  { id: 'a', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' },
  { id: 'b', frame: 10, value: { x: 60, y: 30 }, easing: 'linear' },
  { id: 'c', frame: 20, value: { x: 120, y: 0 }, easing: 'linear' },
]

describe('motion path spatial editing', () => {
  it('builds smooth tangents from neighboring position keys', () => {
    expect(buildDefaultSpatialTangents(keyframes, 'b')).toEqual({
      inTangent: { x: -20, y: 0 },
      outTangent: { x: 20, y: 0 },
      continuous: true,
    })
  })

  it('mirrors the opposite handle for a continuous vertex', () => {
    expect(
      updateSpatialTangent(
        {
          inTangent: { x: -10, y: 0 },
          outTangent: { x: 10, y: 0 },
          continuous: true,
        },
        'out',
        { x: 30, y: 15 },
      ),
    ).toEqual({
      inTangent: { x: -30, y: -15 },
      outTangent: { x: 30, y: 15 },
      continuous: true,
    })
  })

  it('moves only one handle for a broken vertex', () => {
    expect(
      updateSpatialTangent(
        {
          inTangent: { x: -10, y: 0 },
          outTangent: { x: 10, y: 0 },
          continuous: false,
        },
        'in',
        { x: -20, y: 5 },
      ),
    ).toEqual({
      inTangent: { x: -20, y: 5 },
      outTangent: { x: 10, y: 0 },
      continuous: false,
    })
  })

  it('converts a world pointer through a rotated parent into the child position value', () => {
    const parent = {
      id: 'parent',
      type: 'controller',
      controllerKind: 'null',
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 30,
      label: 'Controller',
      transform: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 90,
        opacity: 1,
      },
    } as TimelineItem
    const child = {
      id: 'child',
      type: 'shape',
      trackId: 'child-track',
      from: 0,
      durationInFrames: 30,
      label: 'Child',
      shapeType: 'rectangle',
      fillColor: '#fff',
      transform: {
        x: 10,
        y: 0,
        width: 20,
        height: 20,
        rotation: 0,
        opacity: 1,
      },
      transformParent: createTransformParentBinding({
        parentItemId: parent.id,
        parentWorld: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          anchorX: 50,
          anchorY: 50,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
        childLocal: {
          x: 10,
          y: 0,
          width: 20,
          height: 20,
          anchorX: 10,
          anchorY: 10,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
        childWorld: {
          x: 10,
          y: 0,
          width: 20,
          height: 20,
          anchorX: 10,
          anchorY: 10,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
      }),
    } as TimelineItem
    const itemKeyframes: ItemKeyframes = {
      itemId: child.id,
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [{ id: 'position-1', frame: 0, value: { x: 10, y: 0 }, easing: 'linear' }],
        },
      ],
    }
    const items = new Map([
      [parent.id, parent],
      [child.id, child],
    ])

    const value = worldPointToPositionKeyframeValue({
      item: child,
      itemKeyframes,
      frame: 0,
      worldPoint: { x: 0, y: 30 },
      currentValue: { x: 10, y: 0 },
      canvas: { width: 1920, height: 1080, fps: 30 },
      getItem: (itemId) => items.get(itemId),
      getKeyframes: (itemId) => (itemId === child.id ? itemKeyframes : undefined),
    })

    expect(value.x).toBeCloseTo(30)
    expect(value.y).toBeCloseTo(0)
  })
})
