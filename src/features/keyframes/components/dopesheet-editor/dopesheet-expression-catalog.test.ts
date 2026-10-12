// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { DirectLinkableProperty } from '@/types/keyframe'
import { isVectorAnimatableProperty } from '@/types/keyframe'
import {
  evaluatePropertyExpression,
  isExpressionValueCompatible,
} from '@/features/keyframes/utils/property-expression'
import {
  EXPRESSION_GUIDE_ITEMS,
  EXPRESSION_GUIDE_SECTIONS,
  getExpressionPresets,
} from './dopesheet-expression-catalog'

const REPRESENTATIVE_PROPERTIES: readonly DirectLinkableProperty[] = [
  'x',
  'position',
  'anchor',
  'scale',
  'rotation',
  'opacity',
  'trimPathStart',
  'trimPathOffset',
  'taperEndWidth',
]

describe('dopesheet expression catalog', () => {
  it('provides categorized presets that evaluate to the correct value type', () => {
    for (const property of REPRESENTATIVE_PROPERTIES) {
      const preValue = isVectorAnimatableProperty(property) ? { x: 100, y: 100 } : 50
      const presets = getExpressionPresets(property)
      expect(presets.length).toBeGreaterThanOrEqual(4)
      expect(new Set(presets.map((preset) => preset.group)).size).toBeGreaterThanOrEqual(2)

      for (const preset of presets) {
        const result = evaluatePropertyExpression(preset.source, {
          preValue,
          globalFrame: 30,
          fps: 30,
          resolveProperty: () => null,
        })
        expect(result.error, `${property}: ${preset.label}`).toBeUndefined()
        expect(isExpressionValueCompatible(property, result.value), preset.label).toBe(true)
      }
    }
  })

  it('keeps guide navigation and content complete', () => {
    expect(EXPRESSION_GUIDE_SECTIONS.map((section) => section.id)).toEqual([
      'basics',
      'functions',
      'references',
      'errors',
      'recipes',
    ])
    expect(EXPRESSION_GUIDE_ITEMS.basics).toEqual(
      expect.arrayContaining([expect.objectContaining({ syntax: 'value' })]),
    )
    expect(EXPRESSION_GUIDE_ITEMS.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ syntax: 'prop("layer-id", "property")' })]),
    )
  })
})
