// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { calculateContainedMediaDrawLayout, hasCropFeather } from './media-draw'

const CANVAS = { width: 1920, height: 1080, fps: 25 }

describe('calculateContainedMediaDrawLayout', () => {
  it('offsets the crop layout by the container top-left on canvas', () => {
    const { mediaRect, viewportRect } = calculateContainedMediaDrawLayout(
      1000,
      1000,
      { x: 0, y: 0, width: 500, height: 500 },
      CANVAS,
    )
    const containerLeft = 1920 / 2 - 250
    const containerTop = 1080 / 2 - 250
    // Square source in a square box: media fills the box, no letterbox.
    expect(mediaRect).toEqual({ x: containerLeft, y: containerTop, width: 500, height: 500 })
    expect(viewportRect.x).toBeCloseTo(containerLeft, 6)
    expect(viewportRect.width).toBeCloseTo(500, 6)
  })

  it('crop shrinks the viewport but leaves the media rect in place (in-place semantics)', () => {
    const { mediaRect, viewportRect } = calculateContainedMediaDrawLayout(
      1000,
      1000,
      { x: 0, y: 0, width: 500, height: 500 },
      CANVAS,
      { left: 0.2 },
    )
    expect(mediaRect.width).toBeCloseTo(500, 6)
    // 20% of the fitted 500px is cut from the left of the viewport.
    expect(viewportRect.x - mediaRect.x).toBeGreaterThanOrEqual(99) // pixel-rounded
    expect(viewportRect.width).toBeLessThanOrEqual(401)
  })
})

describe('hasCropFeather', () => {
  it('is true only when some edge has feather pixels', () => {
    expect(hasCropFeather({ left: 0, right: 0, top: 0, bottom: 0 })).toBe(false)
    expect(hasCropFeather({ left: 0, right: 2, top: 0, bottom: 0 })).toBe(true)
  })
})
