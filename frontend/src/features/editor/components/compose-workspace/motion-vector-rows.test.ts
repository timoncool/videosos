import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes, VectorKeyframe } from '@/types/keyframe'
import {
  MOTION_VECTOR_ROW_DEFINITIONS,
  buildMotionVectorSeparationProperties,
  canCombineMotionVectorRowWithoutBake,
  isMotionVectorRowSeparated,
  motionVectorSeparationNeedsBake,
  shouldUseMotionVectorRow,
  toMotionVectorProxyKeyframes,
} from './motion-vector-rows'

const positionRow = MOTION_VECTOR_ROW_DEFINITIONS[0]!

function keyframes(overrides: Partial<ItemKeyframes> = {}): ItemKeyframes {
  return { itemId: 'item-1', properties: [], ...overrides }
}

describe('Motion Vector2 rows', () => {
  it('couples untouched transforms and persisted vector lanes', () => {
    expect(shouldUseMotionVectorRow(undefined, positionRow)).toBe(true)
    expect(
      shouldUseMotionVectorRow(
        keyframes({ vectorProperties: [{ property: 'position', keyframes: [] }] }),
        positionRow,
      ),
    ).toBe(true)
  })

  it('preserves genuinely separated legacy axes', () => {
    expect(
      shouldUseMotionVectorRow(
        keyframes({
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'x-1', frame: 0, value: 10, easing: 'linear' }],
            },
          ],
        }),
        positionRow,
      ),
    ).toBe(false)
    expect(
      shouldUseMotionVectorRow(
        keyframes({
          propertyLinks: [
            {
              type: 'link',
              targetProperty: 'y',
              sourceItemId: 'source',
              sourceProperty: 'y',
              enabled: true,
              timeOffsetFrames: 0,
            },
          ],
        }),
        positionRow,
      ),
    ).toBe(false)
  })

  it('persists an explicitly separated empty Position row', () => {
    const itemKeyframes = keyframes({ separatedVectorProperties: ['position'] })
    expect(isMotionVectorRowSeparated(itemKeyframes, positionRow)).toBe(true)
    expect(shouldUseMotionVectorRow(itemKeyframes, positionRow)).toBe(false)
  })

  it('only combines independently animated axes without baking when timing matches', () => {
    const matching = keyframes({
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'x-0', frame: 0, value: 0, easing: 'linear' },
            { id: 'x-10', frame: 10, value: 10, easing: 'ease-in-out' },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { id: 'y-0', frame: 0, value: 0, easing: 'linear' },
            { id: 'y-10', frame: 10, value: 20, easing: 'ease-in-out' },
          ],
        },
      ],
    })
    expect(canCombineMotionVectorRowWithoutBake(matching, positionRow)).toBe(true)
    matching.properties[1]!.keyframes[1]!.frame = 12
    expect(canCombineMotionVectorRowWithoutBake(matching, positionRow)).toBe(false)
  })

  it('detects handle loss and converts simple vector values to scalar lanes', () => {
    const vectorProperty = {
      property: 'position' as const,
      keyframes: [
        {
          id: 'position-1',
          frame: 4,
          value: { x: 20, y: 30 },
          easing: 'linear' as const,
          spatial: {
            inTangent: { x: -2, y: 0 },
            outTangent: { x: 2, y: 0 },
          },
        },
      ],
    }
    expect(motionVectorSeparationNeedsBake(vectorProperty)).toBe(true)
    expect(
      buildMotionVectorSeparationProperties({
        row: positionRow,
        vectorProperty,
        baseTransform: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          anchorX: 0,
          anchorY: 0,
          cornerRadius: 0,
        },
        createId: () => 'scalar',
      }),
    ).toEqual([
      {
        property: 'x',
        keyframes: [expect.objectContaining({ id: 'scalar', frame: 4, value: 20 })],
      },
      {
        property: 'y',
        keyframes: [expect.objectContaining({ id: 'scalar', frame: 4, value: 30 })],
      },
    ])
  })

  it('projects one stored vector key to component-aware graph proxies', () => {
    const stored: VectorKeyframe[] = [
      {
        id: 'position-1',
        frame: 12,
        value: { x: 40, y: 70 },
        easing: 'ease-in-out',
      },
    ]

    expect(toMotionVectorProxyKeyframes(stored, 'x')).toEqual([
      expect.objectContaining({ id: 'position-1', frame: 12, value: 40 }),
    ])
    expect(toMotionVectorProxyKeyframes(stored, 'y')).toEqual([
      expect.objectContaining({ id: 'position-1:y', frame: 12, value: 70 }),
    ])
  })
})
