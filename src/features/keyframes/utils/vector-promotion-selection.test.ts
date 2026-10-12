// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { KeyframeRef, VectorKeyframe } from '@/types/keyframe'
import { remapLegacyVectorPromotionIdentities } from './vector-promotion'

describe('remapLegacyVectorPromotionIdentities', () => {
  it('remaps every selected legacy Position key while preserving scalar selections', () => {
    const vectorKeyframes: VectorKeyframe[] = [
      {
        id: 'position-a',
        frame: 3590,
        value: { x: 0, y: 0 },
        easing: 'linear',
      },
      {
        id: 'position-b',
        frame: 3605,
        value: { x: 100, y: 0 },
        easing: 'linear',
      },
    ]
    const selectedKeyframes: KeyframeRef[] = [
      { itemId: 'clip-1', property: 'x', keyframeId: 'legacy-position-3590' },
      { itemId: 'clip-1', property: 'x', keyframeId: 'legacy-position-3605' },
      { itemId: 'clip-1', property: 'y', keyframeId: 'legacy-position-3590:y' },
      { itemId: 'clip-1', property: 'y', keyframeId: 'legacy-position-3605:y' },
      { itemId: 'clip-1', property: 'opacity', keyframeId: 'opacity-a' },
      { itemId: 'other-clip', property: 'x', keyframeId: 'other-x' },
    ]

    const result = remapLegacyVectorPromotionIdentities({
      itemId: 'clip-1',
      property: 'position',
      vectorKeyframes,
      keyframesByProperty: {
        x: [
          { id: 'legacy-position-3590', frame: 3590, value: 0, easing: 'linear' },
          { id: 'legacy-position-3605', frame: 3605, value: 100, easing: 'linear' },
        ],
        y: [
          { id: 'legacy-position-3590:y', frame: 3590, value: 0, easing: 'linear' },
          { id: 'legacy-position-3605:y', frame: 3605, value: 0, easing: 'linear' },
        ],
      },
      selectedKeyframes,
    })

    expect(Object.fromEntries(result.storedIdByLegacyEditorId)).toEqual({
      'legacy-position-3590': 'position-a',
      'legacy-position-3605': 'position-b',
      'legacy-position-3590:y': 'position-a',
      'legacy-position-3605:y': 'position-b',
    })
    expect(result.selectedKeyframes).toEqual([
      { itemId: 'clip-1', property: 'x', keyframeId: 'position-a' },
      { itemId: 'clip-1', property: 'x', keyframeId: 'position-b' },
      { itemId: 'clip-1', property: 'y', keyframeId: 'position-a:y' },
      { itemId: 'clip-1', property: 'y', keyframeId: 'position-b:y' },
      { itemId: 'clip-1', property: 'opacity', keyframeId: 'opacity-a' },
      { itemId: 'other-clip', property: 'x', keyframeId: 'other-x' },
    ])
  })
})
