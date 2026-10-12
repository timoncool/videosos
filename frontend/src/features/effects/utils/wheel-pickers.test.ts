// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  autoBalanceFromFrame,
  blackPointFromPick,
  hexToRgb01,
  luma601,
  whiteBalanceFromPick,
  whitePointFromPick,
} from './wheel-pickers'

describe('wheel-pickers', () => {
  it('parses sRGB hex colors', () => {
    expect(hexToRgb01('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 })
    expect(hexToRgb01('336699')).toEqual({ r: 51 / 255, g: 102 / 255, b: 153 / 255 })
    expect(hexToRgb01('#fff')).toBeNull()
  })

  it('leaves white balance unchanged for a neutral pick', () => {
    const wb = whiteBalanceFromPick({ r: 0.5, g: 0.5, b: 0.5 }, 10, -5)
    expect(wb.temperature).toBe(10)
    expect(wb.tint).toBe(-5)
  })

  it('cools a warm pick and removes a green cast', () => {
    // Warm: more red than blue -> temperature must drop
    const warm = whiteBalanceFromPick({ r: 0.6, g: 0.5, b: 0.4 }, 0, 0)
    expect(warm.temperature).toBeLessThan(0)

    // Green-heavy pick -> positive tint (shader subtracts green)
    const green = whiteBalanceFromPick({ r: 0.5, g: 0.6, b: 0.5 }, 0, 0)
    expect(green.tint).toBeGreaterThan(0)
  })

  it('neutralizes the picked color exactly under the shader model', () => {
    const picked = { r: 0.55, g: 0.48, b: 0.42 }
    const { temperature, tint } = whiteBalanceFromPick(picked, 0, 0)
    const tau = temperature / 100
    const phi = tint / 100
    const r = picked.r + tau * 0.1 + phi * 0.05
    const g = picked.g - phi * 0.1
    const b = picked.b - tau * 0.1 + phi * 0.05
    expect(r).toBeCloseTo(g, 4)
    expect(g).toBeCloseTo(b, 4)
  })

  it('maps the picked luma to black and white points', () => {
    const gray = luma601({ r: 0.5, g: 0.5, b: 0.5 })
    expect(blackPointFromPick(gray, 0)).toBeCloseTo(-0.5, 4)
    expect(whitePointFromPick(0.8, 1)).toBeCloseTo(1.25, 4)
    // Clamped to the param ranges
    expect(whitePointFromPick(0.01, 1)).toBe(16)
  })

  it('auto-balances a flat low-contrast frame toward full range', () => {
    // 4x1 frame: dark gray to light gray with a warm cast
    const data = new Uint8ClampedArray([
      ...[64, 56, 48, 255],
      ...[120, 112, 104, 255],
      ...[180, 172, 164, 255],
      ...[230, 222, 214, 255],
    ])
    const result = autoBalanceFromFrame(
      { data, width: 4, height: 1 },
      { lift: 0, gain: 1, temperature: 0, tint: 0 },
    )
    expect(result.lift).toBeLessThan(0) // raise blacks down to 0
    expect(result.gain).toBeGreaterThan(1) // stretch whites up
    expect(result.temperature).toBeLessThan(0) // cool the warm cast
  })
})
