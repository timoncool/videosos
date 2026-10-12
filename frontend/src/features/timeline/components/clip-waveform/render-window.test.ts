import { describe, expect, it } from 'vite-plus/test'

import { computeWaveformRenderWindow } from './render-window'

describe('computeWaveformRenderWindow', () => {
  it('bases visibility on the displayed clip width rather than the buffered render width', () => {
    const window = computeWaveformRenderWindow({
      renderWidth: 1010,
      visibleWidth: 980,
      visibleStartRatio: 0.99,
      visibleEndRatio: 1,
    })

    expect(window.visibleStartPx).toBe(970)
    expect(window.visibleEndPx).toBe(980)
  })

  it('defaults the visible width to the render width when no buffer is used', () => {
    const window = computeWaveformRenderWindow({
      renderWidth: 480,
      visibleStartRatio: 0.25,
      visibleEndRatio: 0.75,
    })

    expect(window.visibleStartPx).toBe(120)
    expect(window.visibleEndPx).toBe(360)
  })

  it('caps stale zoom geometry to the viewport redraw budget', () => {
    expect(
      computeWaveformRenderWindow({
        renderWidth: 100_000,
        visibleWidth: 100_000,
        visibleStartRatio: 0.4,
        visibleEndRatio: 0.6,
        maxWindowWidth: 2_500,
      }),
    ).toEqual({
      visibleStartPx: 48_750,
      visibleEndPx: 51_250,
    })
  })
})
