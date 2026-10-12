// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { getScrubbedPropertyValue } from './property-value-scrub'

describe('getScrubbedPropertyValue', () => {
  it('supports normal, fine, and ultra-fine horizontal adjustment', () => {
    expect(getScrubbedPropertyValue({ startValue: 1, deltaX: 10, decimals: 2 }).value).toBe(1.1)
    expect(
      getScrubbedPropertyValue({ startValue: 1, deltaX: 10, decimals: 2, shiftKey: true }),
    ).toEqual({ value: 1.01, display: '1.010' })
    expect(
      getScrubbedPropertyValue({ startValue: 1, deltaX: 10, decimals: 2, altKey: true }),
    ).toEqual({ value: 1.001, display: '1.0010' })
  })

  it('clamps scrubbed values to the property range', () => {
    expect(
      getScrubbedPropertyValue({
        startValue: 0.9,
        deltaX: 100,
        decimals: 2,
        min: 0,
        max: 1,
      }).value,
    ).toBe(1)
  })

  it('supports a one-unit-per-pixel position scrub step', () => {
    expect(
      getScrubbedPropertyValue({
        startValue: 10,
        deltaX: 20,
        decimals: 0,
        step: 1,
      }),
    ).toEqual({ value: 30, display: '30' })
    expect(
      getScrubbedPropertyValue({
        startValue: 10,
        deltaX: 20,
        decimals: 0,
        step: 1,
        shiftKey: true,
      }).value,
    ).toBe(12)
  })
})
