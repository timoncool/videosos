// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { getRasterizedMaskLayerSettingsList } from './mask-preview'

describe('getRasterizedMaskLayerSettingsList', () => {
  it('preserves invert and alpha feather per mask layer', () => {
    const settings = getRasterizedMaskLayerSettingsList([
      {
        maskType: 'clip',
        maskFeather: 24,
        maskInvert: false,
        maskOpacity: 50,
      },
      {
        maskType: 'alpha',
        maskFeather: 18,
        maskInvert: true,
      },
    ])

    expect(settings).toEqual([
      {
        invert: false,
        feather: 0,
        opacity: 0.5,
      },
      {
        invert: true,
        feather: 18,
        opacity: 1,
      },
    ])
  })
})
