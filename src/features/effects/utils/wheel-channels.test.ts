// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { hueAmountFromWheelChannels, wheelChannelsFromHueAmount } from './wheel-channels'

describe('wheel-channels', () => {
  it('returns zero channels for a centered puck', () => {
    expect(wheelChannelsFromHueAmount(0, 0)).toEqual([0, 0, 0])
  })

  it('reads the dominant channel as positive', () => {
    const [r, g, b] = wheelChannelsFromHueAmount(0, 0.3) // pure red push
    expect(r).toBeCloseTo(0.2, 5)
    expect(g).toBeCloseTo(-0.1, 5)
    expect(b).toBeCloseTo(-0.1, 5)
  })

  it('round-trips hue/amount through channels', () => {
    for (const hue of [0, 35, 120, 200, 275, 340]) {
      for (const amount of [0.05, 0.4, 1]) {
        const channels = wheelChannelsFromHueAmount(hue, amount)
        const wheel = hueAmountFromWheelChannels(channels)
        expect(wheel.amount).toBeCloseTo(amount, 5)
        expect(wheel.hue).toBeCloseTo(hue, 3)
      }
    }
  })

  it('treats uniform channel values as neutral', () => {
    expect(hueAmountFromWheelChannels([0.2, 0.2, 0.2])).toEqual({ hue: 0, amount: 0 })
  })

  it('projects a single-channel edit onto a wheel push toward that channel', () => {
    const wheel = hueAmountFromWheelChannels([0.5, 0, 0])
    expect(wheel.hue).toBeCloseTo(0, 5) // red
    expect(wheel.amount).toBeCloseTo(0.5, 5)
  })

  it('clamps amount to the wheel range', () => {
    const wheel = hueAmountFromWheelChannels([1, -1, -1])
    expect(wheel.amount).toBe(1)
  })
})
