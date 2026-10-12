import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import { buildSpatialPointEffects } from './spatial-effect-point-overlay-utils'

describe('buildSpatialPointEffects', () => {
  it('updates only the configured coordinates on the target effect', () => {
    const target: ItemEffect = {
      id: 'twirl-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-twirl',
        params: { amount: 0.5, centerX: 0.5, centerY: 0.5 },
      },
    }
    const other: ItemEffect = {
      id: 'other-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-brightness',
        params: { amount: 0.2 },
      },
    }

    const result = buildSpatialPointEffects([target, other], target.id, 'centerX', 'centerY', {
      x: 0.25,
      y: 0.75,
    })

    expect(result[0]?.effect).toMatchObject({
      params: { amount: 0.5, centerX: 0.25, centerY: 0.75 },
    })
    expect(result[1]).toBe(other)
  })
})
