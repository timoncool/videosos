import { describe, expect, it } from 'vite-plus/test'
import { getRealtimePreviewRenderSize } from './preview-render-size'

describe('getRealtimePreviewRenderSize', () => {
  it('renders a 4K project near the visible device-pixel size', () => {
    expect(
      getRealtimePreviewRenderSize({ width: 3840, height: 2160 }, { width: 984, height: 554 }, 1.5),
    ).toEqual({ width: 1504, height: 846 })
  })

  it('does not upscale projects that already fit the realtime budget', () => {
    expect(
      getRealtimePreviewRenderSize({ width: 1280, height: 720 }, { width: 1600, height: 900 }, 2),
    ).toEqual({ width: 1280, height: 720 })
  })

  it('caps a large fullscreen preview to roughly 1080p', () => {
    const result = getRealtimePreviewRenderSize(
      { width: 3840, height: 2160 },
      { width: 3000, height: 1688 },
      2,
    )
    expect(result.width * result.height).toBeLessThanOrEqual(1920 * 1080 * 1.02)
    expect(result.width / result.height).toBeCloseTo(16 / 9, 2)
  })
})
