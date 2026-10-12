// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  colorStringToKeyframeValue,
  interpolateColorKeyframeValue,
  keyframeValueToHexColor,
  normalizeHexColor,
} from './color-keyframes'
import type { Keyframe } from '@/types/keyframe'

describe('color keyframes', () => {
  it('normalizes editable hex colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('#f008')).toBe('#ff000088')
    expect(normalizeHexColor('2E6B8C')).toBe('#2e6b8c')
    expect(normalizeHexColor('#123456ff')).toBe('#123456ff')
    expect(normalizeHexColor('oklch(70% 0.1 200)')).toBeNull()
  })

  it('round-trips colors through packed keyframe values', () => {
    expect(colorStringToKeyframeValue('#2e6b8c')).toBe(0x2e6b8c)
    expect(keyframeValueToHexColor(0x2e6b8c)).toBe('#2e6b8c')
  })

  it('interpolates colors perceptually in OKLCH', () => {
    const keyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: 0xff0000, easing: 'linear' },
      { id: 'kf-2', frame: 10, value: 0x00ff00, easing: 'linear' },
    ]

    expect(keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, 5, 0))).toBe('#f99500')
  })

  it('round-trips and interpolates alpha without changing legacy RGB values', () => {
    const transparentRed = colorStringToKeyframeValue('#ff000000')!
    const opaqueBlue = colorStringToKeyframeValue('#0000ffff')!
    const keyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: transparentRed, easing: 'linear' },
      { id: 'kf-2', frame: 10, value: opaqueBlue, easing: 'linear' },
    ]

    expect(colorStringToKeyframeValue('#2e6b8c')).toBe(0x2e6b8c)
    expect(keyframeValueToHexColor(transparentRed)).toBe('#ff000000')
    expect(keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, 5, 0))).toBe(
      '#ba00c280',
    )
    expect(JSON.parse(JSON.stringify({ value: transparentRed }))).toEqual({ value: transparentRed })
  })

  it('uses the shortest hue path and borrows hue for neutral endpoints', () => {
    const keyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: colorStringToKeyframeValue('#d84a9b')!, easing: 'linear' },
      { id: 'kf-2', frame: 10, value: colorStringToKeyframeValue('#dc4f73')!, easing: 'linear' },
    ]
    const midpoint = keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, 5, 0))
    expect(midpoint).toBe('#db4c87')

    const grayToBlue: Keyframe[] = [
      { id: 'kf-3', frame: 0, value: 0x808080, easing: 'linear' },
      { id: 'kf-4', frame: 10, value: 0x0000ff, easing: 'linear' },
    ]
    expect(keyframeValueToHexColor(interpolateColorKeyframeValue(grayToBlue, 5, 0))).toBe('#3b64c4')
  })

  it('preserves hold interpolation for color segments', () => {
    const keyframes: Keyframe[] = [
      { id: 'kf-1', frame: 0, value: 0xff0000, easing: 'hold' },
      { id: 'kf-2', frame: 10, value: 0x0000ff, easing: 'linear' },
    ]

    expect(keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, 9, 0))).toBe('#ff0000')
    expect(keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, 10, 0))).toBe('#0000ff')
  })
})
