// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { planEffectGizmoCommit } from './effect-gizmo-keyframes'

const item: TimelineItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-1',
  from: 10,
  durationInFrames: 100,
  label: 'Clip',
  src: 'clip.mp4',
}
const effect: ItemEffect = {
  id: 'twirl-1',
  enabled: true,
  effect: {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-twirl',
    params: { centerX: 0.5, centerY: 0.5 },
  },
}

describe('planEffectGizmoCommit', () => {
  it('updates an existing coordinate keyframe without changing that base parameter', () => {
    const centerXProperty = buildEffectAnimatableProperty('gpu-twirl', 'twirl-1', 'centerX')
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: centerXProperty,
          keyframes: [{ id: 'center-x-key', frame: 5, value: 0.5, easing: 'linear' }],
        },
      ],
    }

    expect(
      planEffectGizmoCommit(item, effect, keyframes, 15, { centerX: 0.7, centerY: 0.4 }),
    ).toEqual({
      autoKeyframeOperations: [
        {
          type: 'update',
          itemId: 'clip-1',
          property: centerXProperty,
          keyframeId: 'center-x-key',
          updates: { value: 0.7 },
        },
      ],
      baseParamUpdates: { centerY: 0.4 },
    })
  })
})
