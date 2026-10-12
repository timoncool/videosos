// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes, Keyframe } from '@/types/keyframe'
import { useKeyframesStore } from './keyframes-store'

function makeKeyframe(id: string, frame: number, value = frame): Keyframe {
  return { id, frame, value, easing: 'linear' }
}

describe('useKeyframesStore', () => {
  beforeEach(() => {
    useKeyframesStore.getState().setKeyframes([])
  })

  it('deduplicates same-frame collisions when updating a keyframe frame', () => {
    const initialKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-1',
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-a', frame: 0, value: 0, easing: 'linear' },
              { id: 'kf-b', frame: 10, value: 10, easing: 'linear' },
            ],
          },
        ],
      },
    ]

    useKeyframesStore.getState().setKeyframes(initialKeyframes)
    useKeyframesStore.getState()._updateKeyframe('item-1', 'x', 'kf-a', {
      frame: 10,
      value: 42,
    })

    const updated = useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x')
    expect(updated).toEqual([{ id: 'kf-a', frame: 10, value: 42, easing: 'linear' }])
  })

  it('returns the existing keyframe id when addKeyframes overwrites a same-frame keyframe', () => {
    const initialKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-1',
        properties: [
          {
            property: 'x',
            keyframes: [{ id: 'kf-existing', frame: 12, value: 1, easing: 'linear' }],
          },
        ],
      },
    ]

    useKeyframesStore.getState().setKeyframes(initialKeyframes)
    const ids = useKeyframesStore.getState()._addKeyframes([
      {
        itemId: 'item-1',
        property: 'x',
        frame: 12,
        value: 9,
        easing: 'linear',
      },
    ])

    expect(ids).toEqual(['kf-existing'])
    expect(useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x')).toEqual([
      { id: 'kf-existing', frame: 12, value: 9, easing: 'linear' },
    ])
  })

  describe('_scaleKeyframesForItem', () => {
    it('scales keyframe frames proportionally on rate-stretch', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [
                makeKeyframe('a', 0, 0),
                makeKeyframe('b', 50, 50),
                makeKeyframe('c', 100, 100),
              ],
            },
          ],
        },
      ])

      useKeyframesStore.getState()._scaleKeyframesForItem('item-1', 100, 200)

      const frames = useKeyframesStore
        .getState()
        .getAllKeyframesForProperty('item-1', 'x')
        .map((k) => k.frame)
      expect(frames).toEqual([0, 100, 199])
    })

    it('clamps frames to the new duration range', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [{ property: 'x', keyframes: [makeKeyframe('a', 0), makeKeyframe('b', 99)] }],
        },
      ])

      useKeyframesStore.getState()._scaleKeyframesForItem('item-1', 100, 50)

      const frames = useKeyframesStore
        .getState()
        .getAllKeyframesForProperty('item-1', 'x')
        .map((k) => k.frame)
      expect(Math.max(...frames)).toBeLessThanOrEqual(49)
    })

    it('on collision keeps the originally-later keyframe', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [
                { id: 'early', frame: 10, value: 1, easing: 'linear' },
                { id: 'late', frame: 11, value: 99, easing: 'linear' },
              ],
            },
          ],
        },
      ])

      useKeyframesStore.getState()._scaleKeyframesForItem('item-1', 100, 10)

      const kfs = useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x')
      expect(kfs).toHaveLength(1)
      expect(kfs[0]!.id).toBe('late')
      expect(kfs[0]!.value).toBe(99)
    })

    it('is a no-op when oldDuration equals newDuration', () => {
      const initial: ItemKeyframes[] = [
        {
          itemId: 'item-1',
          properties: [{ property: 'x', keyframes: [makeKeyframe('a', 5), makeKeyframe('b', 25)] }],
        },
      ]
      useKeyframesStore.getState().setKeyframes(initial)
      const before = useKeyframesStore.getState().keyframes

      useKeyframesStore.getState()._scaleKeyframesForItem('item-1', 100, 100)

      expect(useKeyframesStore.getState().keyframes).toBe(before)
    })

    it('retimes coupled vector keyframes with the scalar lanes', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          animationVersion: 2,
          properties: [],
          vectorProperties: [
            {
              property: 'position',
              keyframes: [
                { id: 'p1', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' },
                { id: 'p2', frame: 50, value: { x: 100, y: 200 }, easing: 'linear' },
              ],
            },
          ],
        },
      ])

      useKeyframesStore.getState()._scaleKeyframesForItem('item-1', 100, 200)

      expect(
        useKeyframesStore
          .getState()
          .getVectorKeyframesForProperty('item-1', 'position')
          .map((keyframe) => keyframe.frame),
      ).toEqual([0, 100])
    })
  })

  describe('Animation Core v2 vector mutations', () => {
    it('atomically replaces legacy scalar lanes during vector promotion', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [
            { property: 'x', keyframes: [makeKeyframe('x', 0, 10)] },
            { property: 'y', keyframes: [makeKeyframe('y', 0, 20)] },
            { property: 'rotation', keyframes: [makeKeyframe('r', 0, 45)] },
          ],
        },
      ])

      useKeyframesStore.getState()._replaceScalarPropertiesWithVectorProperty(
        'item-1',
        {
          property: 'position',
          keyframes: [{ id: 'position', frame: 0, value: { x: 10, y: 20 }, easing: 'linear' }],
        },
        ['x', 'y'],
      )

      expect(useKeyframesStore.getState().getKeyframesForItem('item-1')).toMatchObject({
        animationVersion: 2,
        properties: [{ property: 'rotation' }],
        vectorProperties: [{ property: 'position' }],
      })
    })

    it('creates and upserts a coupled Position keyframe at one frame', () => {
      const firstId = useKeyframesStore.getState()._upsertVectorKeyframe('item-1', 'position', {
        frame: 12,
        value: { x: 10, y: 20 },
        easing: 'linear',
      })
      const secondId = useKeyframesStore.getState()._upsertVectorKeyframe('item-1', 'position', {
        frame: 12,
        value: { x: 30, y: 40 },
        easing: 'ease-out',
      })

      expect(secondId).toBe(firstId)
      expect(useKeyframesStore.getState().getKeyframesForItem('item-1')).toMatchObject({
        animationVersion: 2,
        properties: [],
        vectorProperties: [
          {
            property: 'position',
            keyframes: [
              {
                id: firstId,
                frame: 12,
                value: { x: 30, y: 40 },
                easing: 'ease-out',
              },
            ],
          },
        ],
      })
    })

    it('removes an empty vector-only animation record', () => {
      const id = useKeyframesStore.getState()._upsertVectorKeyframe('item-1', 'scale', {
        frame: 0,
        value: { x: 100, y: 100 },
      })

      useKeyframesStore.getState()._removeVectorKeyframe('item-1', 'scale', id)

      expect(useKeyframesStore.getState().getKeyframesForItem('item-1')).toBeUndefined()
    })
  })

  describe('_moveKeyframes', () => {
    it('clamps moves to frame >= 0', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [{ property: 'x', keyframes: [makeKeyframe('a', 10)] }],
        },
      ])

      useKeyframesStore
        .getState()
        ._moveKeyframes([
          { ref: { itemId: 'item-1', property: 'x', keyframeId: 'a' }, newFrame: -5 },
        ])

      expect(useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x')[0]!.frame).toBe(
        0,
      )
    })

    it('dedupes when a moved keyframe collides with another, preferring the moved one', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [
            {
              property: 'x',
              keyframes: [makeKeyframe('a', 0, 0), makeKeyframe('b', 10, 10)],
            },
          ],
        },
      ])

      useKeyframesStore
        .getState()
        ._moveKeyframes([
          { ref: { itemId: 'item-1', property: 'x', keyframeId: 'a' }, newFrame: 10 },
        ])

      const kfs = useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x')
      expect(kfs).toHaveLength(1)
      expect(kfs[0]!.id).toBe('a')
      expect(kfs[0]!.frame).toBe(10)
    })
  })

  describe('_duplicateKeyframes', () => {
    it('copies keyframes with frame offset on the same property', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [{ property: 'x', keyframes: [makeKeyframe('a', 5, 100)] }],
        },
      ])

      const newIds = useKeyframesStore
        .getState()
        ._duplicateKeyframes([{ itemId: 'item-1', property: 'x', keyframeId: 'a' }], 20)

      expect(newIds).toHaveLength(1)
      const frames = useKeyframesStore
        .getState()
        .getAllKeyframesForProperty('item-1', 'x')
        .map((k) => k.frame)
      expect(frames).toEqual([5, 25])
    })

    it('can duplicate to a different property', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [{ property: 'x', keyframes: [makeKeyframe('a', 5, 42)] }],
        },
      ])

      useKeyframesStore
        .getState()
        ._duplicateKeyframes(
          [{ itemId: 'item-1', property: 'x', keyframeId: 'a' }],
          0,
          undefined,
          'y',
        )

      const ykfs = useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'y')
      expect(ykfs).toHaveLength(1)
      expect(ykfs[0]!.value).toBe(42)
    })
  })

  describe('_removeKeyframesForItems', () => {
    it('cascades removal across all keyframes for the given items', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'item-1',
          properties: [{ property: 'x', keyframes: [makeKeyframe('a', 0)] }],
        },
        {
          itemId: 'item-2',
          properties: [{ property: 'y', keyframes: [makeKeyframe('b', 0)] }],
        },
        {
          itemId: 'item-3',
          properties: [{ property: 'opacity', keyframes: [makeKeyframe('c', 0)] }],
        },
      ])

      useKeyframesStore.getState()._removeKeyframesForItems(['item-1', 'item-3'])

      const remaining = useKeyframesStore.getState().keyframes.map((ik) => ik.itemId)
      expect(remaining).toEqual(['item-2'])
    })

    it('removes dependent links when their source item is deleted', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'source',
          properties: [{ property: 'x', keyframes: [makeKeyframe('source-x', 0)] }],
        },
        {
          itemId: 'target',
          properties: [{ property: 'y', keyframes: [makeKeyframe('target-y', 0)] }],
          expressions: [
            {
              type: 'link',
              targetProperty: 'x',
              sourceItemId: 'source',
              sourceProperty: 'x',
              enabled: true,
              timeOffsetFrames: 0,
            },
          ],
        },
      ])

      useKeyframesStore.getState()._removeKeyframesForItems(['source'])

      expect(useKeyframesStore.getState().keyframesByItemId.source).toBeUndefined()
      expect(useKeyframesStore.getState().keyframesByItemId.target?.expressions).toEqual([])
      expect(useKeyframesStore.getState().keyframesByItemId.target?.properties).toHaveLength(1)
    })
  })

  describe('direct property links', () => {
    const expression = {
      type: 'link' as const,
      targetProperty: 'x' as const,
      sourceItemId: 'source',
      sourceProperty: 'rotation' as const,
      enabled: true,
      timeOffsetFrames: 0,
    }

    it('creates, replaces, and removes links without requiring keyframes', () => {
      useKeyframesStore.getState()._setDirectPropertyLink('target', expression)
      expect(useKeyframesStore.getState().keyframesByItemId.target?.propertyLinks).toEqual([
        expression,
      ])

      useKeyframesStore.getState()._setDirectPropertyLink('target', {
        ...expression,
        sourceProperty: 'y',
      })
      expect(useKeyframesStore.getState().keyframesByItemId.target?.propertyLinks).toEqual([
        { ...expression, sourceProperty: 'y' },
      ])

      useKeyframesStore.getState()._removeDirectPropertyLink('target', 'x')
      expect(useKeyframesStore.getState().keyframesByItemId.target).toBeUndefined()
    })

    it('keeps direct links when clearing an item keyframes', () => {
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'target',
          properties: [{ property: 'x', keyframes: [makeKeyframe('x', 0)] }],
          propertyLinks: [expression],
        },
      ])

      useKeyframesStore.getState()._removeKeyframesForItem('target')

      expect(useKeyframesStore.getState().keyframesByItemId.target).toEqual({
        itemId: 'target',
        properties: [],
        propertyLinks: [expression],
      })
    })
  })

  describe('keyframesByItemId index', () => {
    it('stays in sync with the keyframes array after mutations', () => {
      useKeyframesStore.getState()._addKeyframe('item-1', 'x', 0, 0)
      expect(useKeyframesStore.getState().keyframesByItemId['item-1']).toBeDefined()

      useKeyframesStore.getState()._removeKeyframesForItem('item-1')
      expect(useKeyframesStore.getState().keyframesByItemId['item-1']).toBeUndefined()
    })
  })
})
