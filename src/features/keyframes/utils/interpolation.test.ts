// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Keyframe } from '@/types/keyframe'
import { applyEasingConfig } from './easing'
import { interpolatePropertyValue } from './interpolation'

describe('interpolatePropertyValue', () => {
  it('uses advanced easing configuration when present', () => {
    const bezierKeyframes: Keyframe[] = [
      {
        id: 'kf-1',
        frame: 0,
        value: 0,
        easing: 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier: { x1: 0.1, y1: 0.9, x2: 0.2, y2: 1 },
        },
      },
      {
        id: 'kf-2',
        frame: 10,
        value: 100,
        easing: 'linear',
      },
    ]

    const expected = applyEasingConfig(0.5, bezierKeyframes[0]!.easingConfig!) * 100
    const interpolated = interpolatePropertyValue(bezierKeyframes, 5, 0)

    expect(interpolated).toBeCloseTo(expected, 6)
    expect(interpolated).not.toBeCloseTo(50, 2)
  })

  it('holds the previous value when easing is "hold"', () => {
    const holdKeyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: 10, easing: 'hold' },
      { id: 'kf-2', frame: 10, value: 100, easing: 'linear' },
    ]

    expect(interpolatePropertyValue(holdKeyframes, 0, 0)).toBe(10)
    expect(interpolatePropertyValue(holdKeyframes, 5, 0)).toBe(10)
    expect(interpolatePropertyValue(holdKeyframes, 9, 0)).toBe(10)
    expect(interpolatePropertyValue(holdKeyframes, 10, 0)).toBe(100)
  })

  it('respects hold per-segment (only the prev keyframe of the segment is held)', () => {
    const mixedKeyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: 0, easing: 'hold' },
      { id: 'kf-2', frame: 10, value: 50, easing: 'linear' },
      { id: 'kf-3', frame: 20, value: 150, easing: 'linear' },
    ]

    expect(interpolatePropertyValue(mixedKeyframes, 5, 0)).toBe(0)
    expect(interpolatePropertyValue(mixedKeyframes, 10, 0)).toBe(50)
    expect(interpolatePropertyValue(mixedKeyframes, 15, 0)).toBeCloseTo(100, 6)
  })
})
