import { describe, expect, it } from 'vite-plus/test'

import {
  computeCoverDrawRect,
  computeFilmstripCanvasGeometry,
  computeFilmstripCanvasTiles,
  computeTimelineFilmstripCanvasWindow,
  getFilmstripTileStride,
  MAX_VISIBLE_FILMSTRIP_TILES,
} from './filmstrip-canvas-geometry'

describe('computeFilmstripCanvasGeometry', () => {
  it('bounds the canvas to the visible tile window', () => {
    expect(computeFilmstripCanvasGeometry(100_000, 4_000.2, 6_079.4)).toEqual({
      left: 4_000,
      width: 2_080,
    })
  })

  it('clips the visible window at the clip edge', () => {
    expect(computeFilmstripCanvasGeometry(415, 320, 480)).toEqual({
      left: 320,
      width: 95,
    })
    expect(computeFilmstripCanvasGeometry(122.406, 0, 123)).toEqual({
      left: 0,
      width: 123,
    })
  })
})

describe('computeTimelineFilmstripCanvasWindow', () => {
  it('derives the bounded clip-local window from timeline coordinates', () => {
    expect(
      computeTimelineFilmstripCanvasWindow({
        startFrame: 0,
        durationFrames: 60_000,
        fps: 30,
        pixelsPerSecond: 100,
        scrollLeft: 10_714,
        viewportWidth: 1331,
        overscanPx: 600,
        contentInsetStartPx: 1,
        contentInsetEndPx: 1,
      }),
    ).toEqual({
      renderWidth: 199_998,
      visibleStartPx: 10_113,
      visibleEndPx: 12_644,
    })
  })

  it('rejects invalid arithmetic bounds so callers can retain the DOM fallback', () => {
    expect(
      computeTimelineFilmstripCanvasWindow({
        startFrame: 0,
        durationFrames: 60,
        fps: 0,
        pixelsPerSecond: 100,
        scrollLeft: 0,
        viewportWidth: 1000,
        overscanPx: 600,
      }),
    ).toBeNull()
  })
})

describe('computeFilmstripCanvasTiles', () => {
  const frames = Array.from({ length: 8 }, (_, index) => ({
    index,
    timestamp: index,
    url: `blob:frame-${index}`,
  }))

  it('resamples the visible real-pixel slots at the current zoom', () => {
    const base = {
      frames,
      renderWidth: 320,
      visibleStartPx: 0,
      visibleEndPx: 320,
      tileWidth: 80,
      effectiveStart: 0,
      effectiveEnd: 8,
      speed: 1,
      isReversed: false,
    }

    expect(
      computeFilmstripCanvasTiles({ ...base, pixelsPerSecond: 80 }).map((tile) => tile.frame.index),
    ).toEqual([0, 1, 2, 3])
    expect(
      computeFilmstripCanvasTiles({ ...base, pixelsPerSecond: 160 }).map(
        (tile) => tile.frame.index,
      ),
    ).toEqual([0, 1, 1, 2])
  })

  it('maps the same slots from the source end when playback is reversed', () => {
    expect(
      computeFilmstripCanvasTiles({
        frames,
        renderWidth: 320,
        visibleStartPx: 0,
        visibleEndPx: 320,
        tileWidth: 80,
        pixelsPerSecond: 80,
        effectiveStart: 0,
        effectiveEnd: 8,
        speed: 1,
        isReversed: true,
      }).map((tile) => tile.frame.index),
    ).toEqual([7, 6, 5, 4])
  })

  it('combines dense visible slots into at most 64 painted tiles', () => {
    const tiles = computeFilmstripCanvasTiles({
      frames,
      renderWidth: 10_000,
      visibleStartPx: 0,
      visibleEndPx: 10_000,
      tileWidth: 50,
      pixelsPerSecond: 100,
      effectiveStart: 0,
      effectiveEnd: 100,
      speed: 1,
      isReversed: false,
    })

    expect(tiles).toHaveLength(50)
    expect(tiles.length).toBeLessThanOrEqual(MAX_VISIBLE_FILMSTRIP_TILES)
    expect(tiles[0]).toMatchObject({ x: 0, width: 200 })
    expect(tiles.at(-1)).toMatchObject({ x: 9800, width: 200 })
  })
})

describe('getFilmstripTileStride', () => {
  it('retains readable slots and reduces only windows above the paint budget', () => {
    expect(getFilmstripTileStride(4, 68)).toBe(1)
    expect(getFilmstripTileStride(4, 69)).toBe(2)
    expect(getFilmstripTileStride(20, 220)).toBe(4)
  })
})

describe('computeCoverDrawRect', () => {
  it('center-crops a wide source into a portrait tile', () => {
    expect(computeCoverDrawRect(160, 90, 60, 60)).toEqual({
      x: expect.closeTo(-23.333, 2),
      y: 0,
      width: expect.closeTo(106.667, 2),
      height: 60,
    })
  })
})
