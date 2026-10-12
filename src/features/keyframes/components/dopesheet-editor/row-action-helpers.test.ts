// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { AnimatableProperty } from '@/types/keyframe'
import {
  buildGroupAddEntries,
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  collectInitialFrames,
  getRemovableGroupCurrentKeyframes,
  removeSelectionIds,
  resolveShiftRangeSelection,
  toggleKeyframeInSelection,
  toggleKeyframesInSelection,
} from './row-action-helpers'

describe('row action helpers', () => {
  const rows = [
    {
      property: 'x' as const,
      keyframes: [
        { id: 'kf-x-1', frame: 12, value: 100, easing: 'linear' as const },
        { id: 'kf-x-2', frame: 24, value: 140, easing: 'linear' as const },
      ],
    },
    {
      property: 'y' as const,
      keyframes: [{ id: 'kf-y-1', frame: 12, value: 200, easing: 'linear' as const }],
    },
  ]

  it('builds row-scoped keyframe refs', () => {
    expect(buildRowKeyframeRefs('item-1', rows)).toEqual([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-2' },
      { itemId: 'item-1', property: 'y', keyframeId: 'kf-y-1' },
    ])
  })

  it('builds property-scoped keyframe refs', () => {
    expect(buildPropertyKeyframeRefs('item-1', 'x', rows[0]!.keyframes)).toEqual([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-2' },
    ])
  })

  it('removes deleted ids from the current selection', () => {
    expect(removeSelectionIds(new Set(['kf-x-1', 'kf-y-1']), ['kf-y-1'])).toEqual(
      new Set(['kf-x-1']),
    )
  })

  it('collects add entries only for rows that can add keyframes', () => {
    expect(buildGroupAddEntries(rows, 12, (row) => row.property !== 'y')).toEqual([
      { property: 'x', frame: 12 },
    ])
  })

  it('selects the inclusive range between clicked and anchor keyframes', () => {
    const keyframes = rows[0]!.keyframes
    expect(resolveShiftRangeSelection(keyframes, 'kf-x-2', 'kf-x-1', new Set())).toEqual(
      new Set(['kf-x-1', 'kf-x-2']),
    )
  })

  it('selects just the clicked keyframe when the anchor is missing', () => {
    const keyframes = rows[0]!.keyframes
    expect(resolveShiftRangeSelection(keyframes, 'kf-x-2', undefined, new Set(['kf-x-1']))).toEqual(
      new Set(['kf-x-1', 'kf-x-2']),
    )
  })

  it('toggles a keyframe id in and out of the selection', () => {
    expect(toggleKeyframeInSelection(new Set(['kf-x-1']), 'kf-x-2')).toEqual(
      new Set(['kf-x-1', 'kf-x-2']),
    )
    expect(toggleKeyframeInSelection(new Set(['kf-x-1', 'kf-x-2']), 'kf-x-1')).toEqual(
      new Set(['kf-x-2']),
    )
  })

  it('toggles every id in a group selection', () => {
    expect(toggleKeyframesInSelection(new Set(['kf-x-1']), ['kf-x-1', 'kf-x-2'])).toEqual(
      new Set(['kf-x-2']),
    )
  })

  it('collects drag-start frames while skipping unknown ids', () => {
    const metaById = new Map([
      ['kf-x-1', { property: 'x' as AnimatableProperty, keyframe: rows[0]!.keyframes[0]! }],
      ['kf-x-2', { property: 'x' as AnimatableProperty, keyframe: rows[0]!.keyframes[1]! }],
    ])
    expect(collectInitialFrames(['kf-x-1', 'kf-missing', 'kf-x-2'], metaById)).toEqual(
      new Map([
        ['kf-x-1', 12],
        ['kf-x-2', 24],
      ]),
    )
  })

  it('filters group current keyframes down to unlocked properties', () => {
    expect(
      getRemovableGroupCurrentKeyframes(
        rows.flatMap((row) =>
          row.keyframes.map((keyframe) => ({ property: row.property, keyframe })),
        ),
        (property) => property === 'y',
      ),
    ).toEqual([
      {
        property: 'x',
        keyframe: { id: 'kf-x-1', frame: 12, value: 100, easing: 'linear' },
      },
      {
        property: 'x',
        keyframe: { id: 'kf-x-2', frame: 24, value: 140, easing: 'linear' },
      },
    ])
  })
})
