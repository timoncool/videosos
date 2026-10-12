import { describe, expect, it } from 'vite-plus/test'
import { computeFilmstripRenderWindow } from './render-window'

describe('computeFilmstripRenderWindow', () => {
  it('keeps the trailing overscan width covered even when visibility ratios use the real clip width', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 412,
      visibleWidth: 400,
      tileWidth: 80,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
      minimumPadTiles: 0,
      minimumPadPx: 0,
    })

    expect(window.paddedStartX).toBe(0)
    expect(window.paddedEndX).toBe(412)
    expect(window.startTile).toBe(0)
    expect(window.endTile).toBe(6)
  })

  it('adds enough pixel overscan to absorb lagging viewport ratios near the left edge', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 1000,
      visibleWidth: 1000,
      tileWidth: 80,
      visibleStartRatio: 0.32,
      visibleEndRatio: 0.72,
      minimumPadTiles: 2,
      minimumPadPx: 600,
    })

    expect(window.paddedStartX).toBe(0)
    expect(window.startTile).toBe(0)
    expect(window.endTile).toBe(13)
  })

  it('clamps the padded end to the render width after applying overscan', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 500,
      visibleWidth: 480,
      tileWidth: 90,
      visibleStartRatio: 0.55,
      visibleEndRatio: 0.9,
      minimumPadTiles: 2,
      minimumPadPx: 600,
    })

    expect(window.paddedEndX).toBe(500)
    expect(window.endTile).toBe(6)
  })

  it('caps stale zoom geometry to the viewport redraw budget', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 100_000,
      visibleWidth: 100_000,
      tileWidth: 80,
      visibleStartRatio: 0.4,
      visibleEndRatio: 0.6,
      minimumPadPx: 600,
      maxWindowWidth: 2_500,
    })

    expect(window.paddedEndX - window.paddedStartX).toBe(2_500)
    expect(window.startTile).toBe(609)
    expect(window.endTile).toBe(641)
  })

  it('keeps the visible range covered when trailing render overflow exceeds the budget', () => {
    const window = computeFilmstripRenderWindow({
      renderWidth: 200_000,
      visibleWidth: 198_000,
      tileWidth: 80,
      visibleStartRatio: 0.25,
      visibleEndRatio: 52_000 / 198_000,
      minimumPadPx: 600,
      maxWindowWidth: 2_500,
    })

    expect(window.paddedStartX).toBe(49_500)
    expect(window.paddedEndX).toBe(52_000)
  })
})
