import { describe, expect, it } from 'vite-plus/test'
import type { AnimatableProperty, ItemKeyframes, VectorKeyframe } from '@/types/keyframe'
import {
  VECTOR_PROPERTY_PAIRS,
  findStoredVectorKeyframe,
  getEditorVectorKeyframeId,
  getStoredVectorKeyframeId,
  getVectorPropertyProxy,
  toVectorScalePercent,
} from './vector-proxy'

function vectorKeyframe(id: string, frame: number): VectorKeyframe {
  return { id, frame, value: { x: 0, y: 0 }, easing: 'linear' }
}

function keyframesWithPositionKeyframes(keyframes: VectorKeyframe[]): ItemKeyframes {
  return {
    itemId: 'item-1',
    properties: [],
    vectorProperties: [{ property: 'position', keyframes }],
  }
}

describe('vector property proxy', () => {
  it('maps every coupled transform lane to its vector property and axis', () => {
    const lanes: readonly AnimatableProperty[] = [
      'x',
      'y',
      'width',
      'height',
      'anchorX',
      'anchorY',
    ]

    expect(lanes.map((lane) => getVectorPropertyProxy(lane))).toEqual([
      { property: 'position', axis: 'x' },
      { property: 'position', axis: 'y' },
      { property: 'scale', axis: 'x' },
      { property: 'scale', axis: 'y' },
      { property: 'anchor', axis: 'x' },
      { property: 'anchor', axis: 'y' },
    ])
  })

  it('declares a primary/secondary pair for every vector property', () => {
    expect(VECTOR_PROPERTY_PAIRS.map((pair) => [pair.property, pair.primary, pair.secondary])).toEqual(
      [
        ['position', 'x', 'y'],
        ['scale', 'width', 'height'],
        ['anchor', 'anchorX', 'anchorY'],
      ],
    )
  })

  it('rejects uncoupled and non-transform properties', () => {
    expect(getVectorPropertyProxy('rotation')).toBeNull()
    expect(getVectorPropertyProxy('volume')).toBeNull()
    expect(getVectorPropertyProxy('effect:blur:abc:radius')).toBeNull()
  })
})

describe('vector keyframe id axis convention', () => {
  it('addresses the y axis with a :y suffix on the shared stored id', () => {
    expect(getEditorVectorKeyframeId('kf-1', 'x')).toBe('kf-1')
    expect(getEditorVectorKeyframeId('kf-1', 'y')).toBe('kf-1:y')
  })

  it('collapses an editor lane id back to the stored id it came from', () => {
    for (const axis of ['x', 'y'] as const) {
      expect(getStoredVectorKeyframeId(getEditorVectorKeyframeId('kf-1', axis), axis)).toBe('kf-1')
    }

    // The stored row owns the bare id; only the y view carries the suffix.
    expect(getStoredVectorKeyframeId('kf-1', 'y')).toBe('kf-1')
    expect(getStoredVectorKeyframeId('kf-1:y', 'y')).toBe('kf-1')
    expect(getStoredVectorKeyframeId('kf-1:y', 'x')).toBe('kf-1:y')
  })

  it('resolves an editor y-lane reference to its stored keyframe', () => {
    const itemKeyframes = keyframesWithPositionKeyframes([vectorKeyframe('kf-1', 12)])
    const storedYId = getStoredVectorKeyframeId(getEditorVectorKeyframeId('kf-1', 'y'), 'y')

    expect(findStoredVectorKeyframe(itemKeyframes, 'position', storedYId)?.frame).toBe(12)
    expect(findStoredVectorKeyframe(itemKeyframes, 'position', 'missing')).toBeUndefined()
    expect(findStoredVectorKeyframe(undefined, 'position', storedYId)).toBeUndefined()
  })
})

describe('vector scale percent', () => {
  it('reports an unscaled 100% for a zero base instead of dividing by zero', () => {
    expect(toVectorScalePercent(0, 0)).toBe(100)
    expect(toVectorScalePercent(500, 0)).toBe(100)
  })

  it('expresses scale as a percentage of the base transform', () => {
    expect(toVectorScalePercent(960, 1920)).toBe(50)
    expect(toVectorScalePercent(2880, 1920)).toBe(150)
  })
})