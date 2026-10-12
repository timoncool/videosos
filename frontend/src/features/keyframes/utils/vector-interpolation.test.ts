// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { VectorKeyframe } from '@/types/keyframe'
import { interpolateVectorPropertyValue, sampleVectorSpeedGraph } from './vector-interpolation'

function keyframe(
  id: string,
  frame: number,
  x: number,
  y: number,
  overrides: Partial<VectorKeyframe> = {},
): VectorKeyframe {
  return {
    id,
    frame,
    value: { x, y },
    easing: 'linear',
    ...overrides,
  }
}

describe('interpolateVectorPropertyValue', () => {
  it('keeps Position components coupled on one timeline', () => {
    const keyframes = [keyframe('a', 0, 0, 20), keyframe('b', 10, 100, 220)]

    expect(interpolateVectorPropertyValue('position', keyframes, 5, { x: 9, y: 9 })).toEqual({
      x: 50,
      y: 120,
    })
  })

  it('evaluates spatial Bezier tangents for curved position paths', () => {
    const keyframes = [
      keyframe('a', 0, 0, 0, {
        spatial: {
          inTangent: { x: 0, y: 0 },
          outTangent: { x: 0, y: 100 },
        },
      }),
      keyframe('b', 10, 100, 0, {
        spatial: {
          inTangent: { x: 0, y: 100 },
          outTangent: { x: 0, y: 0 },
        },
      }),
    ]

    const midpoint = interpolateVectorPropertyValue('position', keyframes, 5, { x: 0, y: 0 })

    expect(midpoint.x).toBeCloseTo(50, 6)
    expect(midpoint.y).toBeCloseTo(75, 6)
  })

  it('uses temporal speed and influence consistently across frame rates', () => {
    const at30Fps = [
      keyframe('a', 0, 0, 0, {
        temporalEase: { out: { speed: 0, influence: 50 } },
      }),
      keyframe('b', 30, 100, 0, {
        temporalEase: { in: { speed: 100, influence: 50 } },
      }),
    ]
    const at60Fps = [{ ...at30Fps[0]! }, { ...at30Fps[1]!, frame: 60 }]

    const thirty = interpolateVectorPropertyValue('position', at30Fps, 7.5, { x: 0, y: 0 }, 30)
    const sixty = interpolateVectorPropertyValue('position', at60Fps, 15, { x: 0, y: 0 }, 60)

    expect(thirty.x).toBeLessThan(25)
    expect(sixty.x).toBeCloseTo(thirty.x, 6)
  })

  it('treats Scale as percentages and respects hold segments', () => {
    const keyframes = [keyframe('a', 0, 100, 100, { easing: 'hold' }), keyframe('b', 10, 200, 50)]

    expect(interpolateVectorPropertyValue('scale', keyframes, 5, { x: 100, y: 100 })).toEqual({
      x: 100,
      y: 100,
    })
  })

  it('samples the same temporal velocity used by interpolation', () => {
    const linear = [keyframe('a', 0, 0, 0), keyframe('b', 30, 90, 0)]
    const eased = [
      keyframe('a', 0, 0, 0, {
        temporalEase: { out: { speed: 0, influence: 50 } },
      }),
      keyframe('b', 30, 90, 0, {
        temporalEase: { in: { speed: 0, influence: 50 } },
      }),
    ]

    const linearSamples = sampleVectorSpeedGraph('position', linear, 30, 6)
    const easedSamples = sampleVectorSpeedGraph('position', eased, 30, 6)

    expect(linearSamples.every((sample) => Math.abs(sample.speed - 90) < 0.01)).toBe(true)
    expect(easedSamples[0]!.speed).toBeLessThan(linearSamples[0]!.speed)
    expect(Math.max(...easedSamples.map((sample) => sample.speed))).toBeGreaterThan(90)
  })
})
