import { describe, expect, it } from 'vite-plus/test'
import { getSpatialPointEffectConfig } from './spatial-point-editor'

describe('spatial point effect configuration', () => {
  it.each([
    'gpu-twirl',
    'gpu-bulge',
    'gpu-trigger-wave',
    'gpu-radial-blur',
    'gpu-zoom-blur',
    'gpu-droste',
  ])('maps %s to center parameters', (effectType) => {
    expect(getSpatialPointEffectConfig(effectType)).toEqual({
      xParam: 'centerX',
      yParam: 'centerY',
    })
  })

  it('maps Ripple Glass to its origin parameters and excludes unsupported effects', () => {
    expect(getSpatialPointEffectConfig('gpu-ripple-glass')).toEqual({
      xParam: 'originX',
      yParam: 'originY',
    })
    expect(getSpatialPointEffectConfig('gpu-dither')).toBeNull()
  })
})
