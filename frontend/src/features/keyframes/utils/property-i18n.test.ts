// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TFunction } from 'i18next'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import { getKeyframePropertyLabel, getKeyframePropertyShortLabel } from './property-i18n'

const t = ((_: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? '') as TFunction

describe('keyframe property labels', () => {
  it('labels path vertex channels without exposing storage identifiers', () => {
    expect(getKeyframePropertyLabel(t, 'pathVertex:2:positionX')).toBe('Vertex 3 X')
    expect(getKeyframePropertyShortLabel(t, 'pathVertex:2:outY')).toBe('Vertex 3 Out Y')
  })

  it('uses a full path for tooltips and a parameter-only label beneath effect headers', () => {
    const property = buildEffectAnimatableProperty('gpu-color-wheels', 'wheels-1', 'exposure')

    expect(getKeyframePropertyLabel(t, property)).toBe('Color Wheels: Exposure')
    expect(getKeyframePropertyShortLabel(t, property)).toBe('Exposure')
  })

  it('labels color-wheel channels with their visible Lift, Gamma, and Gain wheels', () => {
    const cases = [
      ['shadowsHue', 'Lift Hue'],
      ['shadowsAmount', 'Lift Amount'],
      ['midtonesHue', 'Gamma Hue'],
      ['midtonesAmount', 'Gamma Amount'],
      ['highlightsHue', 'Gain Hue'],
      ['highlightsAmount', 'Gain Amount'],
    ] as const

    for (const [paramKey, label] of cases) {
      const property = buildEffectAnimatableProperty('gpu-color-wheels', 'wheels-1', paramKey)
      expect(getKeyframePropertyLabel(t, property)).toBe(`Color Wheels: ${label}`)
      expect(getKeyframePropertyShortLabel(t, property)).toBe(label)
      expect(property).toBe(`effect:gpu-color-wheels:wheels-1:${paramKey}`)
    }
  })
})
