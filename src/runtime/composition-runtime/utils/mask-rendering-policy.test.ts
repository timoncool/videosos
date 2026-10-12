import { describe, expect, it } from 'vite-plus/test'
import { shouldRasterizeSvgMaskForFrame } from './mask-rendering-policy'

describe('shouldRasterizeSvgMaskForFrame', () => {
  it('keeps the high-quality raster mask while paused', () => {
    expect(
      shouldRasterizeSvgMaskForFrame({
        maskType: 'svg-mask',
        hasPaths: true,
        feather: 10,
        isPlaying: false,
      }),
    ).toBe(true)
  })

  it('uses the live SVG mask during playback', () => {
    expect(
      shouldRasterizeSvgMaskForFrame({
        maskType: 'svg-mask',
        hasPaths: true,
        feather: 10,
        isPlaying: true,
      }),
    ).toBe(false)
  })

  it('does not rasterize hard-edge or empty masks', () => {
    expect(
      shouldRasterizeSvgMaskForFrame({
        maskType: 'clip',
        hasPaths: true,
        feather: 10,
        isPlaying: false,
      }),
    ).toBe(false)
    expect(
      shouldRasterizeSvgMaskForFrame({
        maskType: 'svg-mask',
        hasPaths: false,
        feather: 10,
        isPlaying: false,
      }),
    ).toBe(false)
  })
})
