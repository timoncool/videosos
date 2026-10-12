// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import { buildEffectPropertyResetPlan } from './effect-property-reset'

describe('buildEffectPropertyResetPlan', () => {
  it('restores numeric and color parameters to their registered defaults', () => {
    const effect: ItemEffect = {
      id: 'glass-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-fluted-glass',
        params: { colorBack: '#ff0000', shadows: 0.9 },
      },
    }
    const colorProperty = buildEffectAnimatableProperty('gpu-fluted-glass', effect.id, 'colorBack')
    const shadowsProperty = buildEffectAnimatableProperty('gpu-fluted-glass', effect.id, 'shadows')

    const plan = buildEffectPropertyResetPlan([effect], [colorProperty, shadowsProperty])

    expect(plan.resettableProperties).toEqual([colorProperty, shadowsProperty])
    expect(plan.effectUpdates).toHaveLength(1)
    expect(plan.effectUpdates[0]?.effect).toMatchObject({
      params: expect.objectContaining({ colorBack: '#00000000', shadows: 0.25 }),
    })
  })
})
