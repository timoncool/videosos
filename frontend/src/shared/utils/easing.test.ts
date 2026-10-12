// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { applyEasing, applyEasingConfig, cubicBezier, easeIn, easeInOut, easeOut } from './easing'
import type { EasingType } from '@/types/keyframe'

const NAMED: EasingType[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier',
  'spring',
]

describe('easing primitives', () => {
  it('quadratic ease-in/out hit the endpoints and mirror each other', () => {
    expect(easeIn(0)).toBe(0)
    expect(easeIn(1)).toBe(1)
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    // easeOut(t) = 1 - easeIn(1 - t) — the standard quadratic mirror.
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeOut(t)).toBeCloseTo(1 - easeIn(1 - t), 12)
    }
  })

  it('ease-in-out is symmetric about the midpoint', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12)
    for (const t of [0.1, 0.2, 0.3, 0.4]) {
      expect(easeInOut(t)).toBeCloseTo(1 - easeInOut(1 - t), 12)
    }
  })

  it('starts slower than linear (ease-in) and faster than linear (ease-out)', () => {
    expect(easeIn(0.25)).toBeLessThan(0.25)
    expect(easeOut(0.25)).toBeGreaterThan(0.25)
  })
})

describe('cubicBezier', () => {
  it('pins the endpoints exactly', () => {
    const pts = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
    expect(cubicBezier(0, pts)).toBe(0)
    expect(cubicBezier(1, pts)).toBe(1)
  })

  it('linear control points reproduce the identity', () => {
    const pts = { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 }
    for (const t of [0.1, 0.33, 0.5, 0.77, 0.9]) {
      expect(cubicBezier(t, pts)).toBeCloseTo(t, 4)
    }
  })

  it('a symmetric S-curve crosses 0.5 at its midpoint and is monotone', () => {
    const pts = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } // CSS "ease-in-out"
    expect(cubicBezier(0.5, pts)).toBeCloseTo(0.5, 3)
    let prev = 0
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const v = cubicBezier(Math.min(1, t), pts)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
})

describe('applyEasing / applyEasingConfig', () => {
  it('clamps t outside [0,1] before easing for every named type', () => {
    for (const type of NAMED) {
      expect(applyEasing(-5, type)).toBe(applyEasing(0, type))
      expect(applyEasing(5, type)).toBe(applyEasing(1, type))
    }
  })

  it('hold stays at 0 until the next keyframe takes over', () => {
    expect(applyEasing(0.999, 'hold')).toBe(0)
  })

  it('config with explicit bezier points overrides the default curve', () => {
    const strong = applyEasingConfig(0.25, {
      type: 'cubic-bezier',
      bezier: { x1: 0.9, y1: 0, x2: 1, y2: 0.1 },
    })
    const identityLike = applyEasingConfig(0.25, {
      type: 'cubic-bezier',
      bezier: { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 },
    })
    expect(strong).toBeLessThan(identityLike)
  })

  it('spring reaches its endpoints and may overshoot but never below 0 / above 1.2', () => {
    const config = { type: 'spring' as const, spring: { tension: 170, friction: 12, mass: 1 } }
    expect(applyEasingConfig(0, config)).toBe(0)
    expect(applyEasingConfig(1, config)).toBe(1)
    for (let t = 0.05; t < 1; t += 0.05) {
      const v = applyEasingConfig(t, config)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1.2)
    }
  })
})
