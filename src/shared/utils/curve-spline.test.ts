// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { evaluateMonotoneCurve } from './curve-spline'

describe('evaluateMonotoneCurve', () => {
  it('defaults to the identity curve when no points are given', () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(evaluateMonotoneCurve(undefined, x)).toBeCloseTo(x, 6)
    }
  })

  it('passes exactly through its control points', () => {
    const points = [
      { x: 0, y: 0.1 },
      { x: 0.4, y: 0.3 },
      { x: 0.7, y: 0.9 },
      { x: 1, y: 1 },
    ]
    for (const p of points) {
      expect(evaluateMonotoneCurve(points, p.x)).toBeCloseTo(p.y, 6)
    }
  })

  it('preserves monotonicity between monotone points (no Fritsch-Carlson overshoot)', () => {
    // A steep step between flat plateaus is the classic overshoot trap for
    // naive Catmull-Rom; the monotone limiter must keep the curve rising.
    const points = [
      { x: 0, y: 0 },
      { x: 0.45, y: 0.05 },
      { x: 0.55, y: 0.95 },
      { x: 1, y: 1 },
    ]
    let prev = -Infinity
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = evaluateMonotoneCurve(points, Math.min(1, x))
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
      prev = y
    }
  })

  it('holds the edge value outside the outermost points and clamps x', () => {
    const points = [
      { x: 0.2, y: 0.4 },
      { x: 0.8, y: 0.6 },
    ]
    // Normalization extends the curve flat to x=0 and x=1.
    expect(evaluateMonotoneCurve(points, 0)).toBeCloseTo(0.4, 6)
    expect(evaluateMonotoneCurve(points, 1)).toBeCloseTo(0.6, 6)
    expect(evaluateMonotoneCurve(points, -3)).toBeCloseTo(0.4, 6)
    expect(evaluateMonotoneCurve(points, 3)).toBeCloseTo(0.6, 6)
  })

  it('deduplicates near-identical x positions instead of dividing by zero', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.5001, y: 0.9 }, // within dedupe epsilon of the previous point
      { x: 1, y: 1 },
    ]
    const y = evaluateMonotoneCurve(points, 0.5)
    expect(Number.isFinite(y)).toBe(true)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(1)
  })
})
