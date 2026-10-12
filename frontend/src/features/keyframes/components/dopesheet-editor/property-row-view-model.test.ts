// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TFunction } from 'i18next'
import type {
  AnimatableProperty,
  DirectLinkableProperty,
  EffectAnimatableProperty,
  PropertyExpression,
} from '@/types/keyframe'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import {
  resolvePropertyRowExpressionError,
  resolvePropertyRowLabels,
  resolvePropertyRowPreExpressionValue,
  resolvePropertyRowResetState,
} from './property-row-view-model'

const t = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as unknown as TFunction

describe('property row view model', () => {
  it('resolves display labels with explicit labels winning', () => {
    expect(
      resolvePropertyRowLabels(
        'x' as AnimatableProperty,
        { x: 'Custom' } as Partial<Record<AnimatableProperty, string>>,
        { label: 'Compound' } as unknown as CompoundPropertyInputConfig,
        t,
      ),
    ).toEqual({ rowLabel: 'Custom', rowDisplayLabel: 'Custom' })
  })

  it('falls back to compound labels then generated labels', () => {
    const compound = resolvePropertyRowLabels(
      'x' as AnimatableProperty,
      {},
      { label: 'Compound' } as unknown as CompoundPropertyInputConfig,
      t,
    )
    expect(compound).toEqual({ rowLabel: 'Compound', rowDisplayLabel: 'Compound' })
    const generated = resolvePropertyRowLabels('x' as AnimatableProperty, {}, undefined, t)
    expect(typeof generated.rowLabel).toBe('string')
    expect(typeof generated.rowDisplayLabel).toBe('string')
  })

  it('reads pre-expression values from compound rows first', () => {
    expect(
      resolvePropertyRowPreExpressionValue(
        'x' as AnimatableProperty,
        { preExpressionValue: 3, value: 4 } as unknown as CompoundPropertyInputConfig,
        {},
        {},
      ),
    ).toBe(3)
  })

  it('reads pre-expression values from the property maps otherwise', () => {
    expect(
      resolvePropertyRowPreExpressionValue(
        'x' as AnimatableProperty,
        undefined,
        { x: 7 } as Partial<Record<AnimatableProperty, number>>,
        {},
      ),
    ).toBe(7)
  })

  it('reports no expression error without a linkable property', () => {
    expect(
      resolvePropertyRowExpressionError({
        linkableProperty: null,
        preExpressionValue: 1,
        expressionEditor: null,
        propertyExpression: undefined,
        globalFrame: 0,
        itemFrom: 0,
        currentFrame: 0,
        fps: 30,
        resolveExpressionReference: undefined,
      }),
    ).toBeUndefined()
  })

  it('surfaces evaluator errors from stored expressions', () => {
    expect(
      resolvePropertyRowExpressionError({
        linkableProperty: 'x' as DirectLinkableProperty,
        preExpressionValue: 1,
        expressionEditor: null,
        propertyExpression: { source: '(((' } as PropertyExpression,
        globalFrame: 0,
        itemFrom: 0,
        currentFrame: 0,
        fps: 30,
        resolveExpressionReference: undefined,
      }),
    ).toBeDefined()
  })

  it('enables effect reset only for unlocked effect rows with a reset handler', () => {
    const effectProperty = 'effect:blur:e1:radius' as EffectAnimatableProperty
    const enabled = resolvePropertyRowResetState({
      property: effectProperty,
      rowLabel: 'Blur',
      hasResetToDefault: true,
      disabled: false,
      rowLocked: false,
      canClear: false,
      t,
    })
    expect(enabled.canResetEffectProperty).toBe(true)
    expect(enabled.canResetRow).toBe(true)
    expect(
      resolvePropertyRowResetState({
        property: effectProperty,
        rowLabel: 'Blur',
        hasResetToDefault: true,
        disabled: false,
        rowLocked: true,
        canClear: true,
        t,
      }).canResetEffectProperty,
    ).toBe(false)
  })
})
