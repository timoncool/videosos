// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  DEFAULT_SHAPE_GRADIENT_ANGLE,
  DEFAULT_SHAPE_GRADIENT_END_COLOR,
  getSwappedShapeLinearGradientColors,
  getLinearGradientUnitEndpoints,
  resolveShapeLinearGradient,
} from './linear-gradient'

describe('Shape linear gradients', () => {
  it('keeps legacy Shapes solid unless the additive fill mode is present', () => {
    expect(
      resolveShapeLinearGradient({
        fillColor: '#123456',
      }),
    ).toBeNull()
  })

  it('uses legacy fillColor as the first-stop fallback for imported gradients', () => {
    expect(
      resolveShapeLinearGradient({
        fillType: 'linear',
        fillColor: '#123456',
      }),
    ).toEqual({
      startColor: '#123456',
      endColor: DEFAULT_SHAPE_GRADIENT_END_COLOR,
      angle: DEFAULT_SHAPE_GRADIENT_ANGLE,
    })
  })

  it('maps zero and ninety degrees to normalized box-edge endpoints', () => {
    expect(getLinearGradientUnitEndpoints(0)).toEqual({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    })

    const vertical = getLinearGradientUnitEndpoints(90)
    expect(vertical.start.x).toBeCloseTo(0.5)
    expect(vertical.start.y).toBeCloseTo(0)
    expect(vertical.end.x).toBeCloseTo(0.5)
    expect(vertical.end.y).toBeCloseTo(1)
  })

  it('swaps each gradient from its own stops without collapsing mixed selections', () => {
    const first = getSwappedShapeLinearGradientColors({
      fillType: 'linear',
      fillColor: '#111111',
      gradientStartColor: '#112233',
      gradientEndColor: '#445566',
    })
    const second = getSwappedShapeLinearGradientColors({
      fillType: 'linear',
      fillColor: '#aaaaaa',
      gradientStartColor: '#aabbcc',
      gradientEndColor: '#ddeeff',
    })

    expect(first).toEqual({
      fillColor: '#445566',
      gradientStartColor: '#445566',
      gradientEndColor: '#112233',
    })
    expect(second).toEqual({
      fillColor: '#ddeeff',
      gradientStartColor: '#ddeeff',
      gradientEndColor: '#aabbcc',
    })
  })
})
