// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import { buildVectorPromotionPlan } from './vector-promotion'

const base = {
  x: 10,
  y: 20,
  width: 400,
  height: 200,
  anchorX: 200,
  anchorY: 100,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

describe('buildVectorPromotionPlan', () => {
  it('couples the union of legacy X/Y frames without changing sampled positions', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'x1', frame: 0, value: 0, easing: 'linear' },
            { id: 'x2', frame: 20, value: 200, easing: 'ease-out' },
          ],
        },
        {
          property: 'y',
          keyframes: [
            { id: 'y1', frame: 10, value: 100, easing: 'linear' },
            { id: 'y2', frame: 20, value: 200, easing: 'linear' },
          ],
        },
      ],
    }
    let id = 0

    const plan = buildVectorPromotionPlan({
      property: 'position',
      itemKeyframes,
      baseTransform: base,
      includeFrame: 5,
      createId: () => `vector-${++id}`,
    })

    expect(plan.removeScalarProperties).toEqual(['x', 'y'])
    expect(plan.vectorProperty.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 5, 10, 20])
    expect(plan.vectorProperty.keyframes.map((keyframe) => keyframe.value)).toEqual([
      { x: 0, y: 100 },
      { x: 50, y: 100 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ])
  })

  it('converts pixel Width/Height lanes into percentage Scale', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property: 'width',
          keyframes: [
            { id: 'w1', frame: 0, value: 400, easing: 'linear' },
            { id: 'w2', frame: 10, value: 800, easing: 'linear' },
          ],
        },
        {
          property: 'height',
          keyframes: [
            { id: 'h1', frame: 0, value: 200, easing: 'linear' },
            { id: 'h2', frame: 10, value: 100, easing: 'linear' },
          ],
        },
      ],
    }

    const plan = buildVectorPromotionPlan({
      property: 'scale',
      itemKeyframes,
      baseTransform: base,
      includeFrame: 10,
      createId: () => 'scale-key',
    })

    expect(plan.removeScalarProperties).toEqual(['width', 'height'])
    expect(plan.vectorProperty.keyframes.map((keyframe) => keyframe.value)).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 50 },
    ])
  })

  it('couples legacy Anchor X/Y lanes without changing their pixel values', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property: 'anchorX',
          keyframes: [
            { id: 'ax1', frame: 0, value: 100, easing: 'linear' },
            { id: 'ax2', frame: 10, value: 300, easing: 'linear' },
          ],
        },
        {
          property: 'anchorY',
          keyframes: [
            { id: 'ay1', frame: 0, value: 50, easing: 'linear' },
            { id: 'ay2', frame: 10, value: 150, easing: 'linear' },
          ],
        },
      ],
    }

    const plan = buildVectorPromotionPlan({
      property: 'anchor',
      itemKeyframes,
      baseTransform: base,
      createId: (frame) => `anchor-${frame}`,
    })

    expect(plan.removeScalarProperties).toEqual(['anchorX', 'anchorY'])
    expect(plan.vectorProperty.keyframes.map((keyframe) => keyframe.value)).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 150 },
    ])
  })

  it('preserves shared preset provenance when promoting authored axes', () => {
    const source = {
      applicationId: 'application-1',
      kind: 'built-in-preset' as const,
      presetId: 'slide-out-right',
      presetName: 'Slide Out Right',
    }
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'x1', frame: 12, value: 100, easing: 'linear', source }],
        },
        {
          property: 'y',
          keyframes: [{ id: 'y1', frame: 12, value: 20, easing: 'linear', source }],
        },
      ],
    }

    const plan = buildVectorPromotionPlan({
      property: 'position',
      itemKeyframes,
      baseTransform: base,
      createId: () => 'position-key',
    })

    expect(plan.vectorProperty.keyframes[0]?.source).toEqual(source)
  })

  it('does not claim preset provenance when authored axes come from different applications', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property: 'x',
          keyframes: [
            {
              id: 'x1',
              frame: 12,
              value: 100,
              easing: 'linear',
              source: {
                applicationId: 'application-1',
                kind: 'built-in-preset',
                presetId: 'slide-out-right',
                presetName: 'Slide Out Right',
              },
            },
          ],
        },
        {
          property: 'y',
          keyframes: [
            {
              id: 'y1',
              frame: 12,
              value: 20,
              easing: 'linear',
              source: {
                applicationId: 'application-2',
                kind: 'built-in-preset',
                presetId: 'fade-in',
                presetName: 'Fade In',
              },
            },
          ],
        },
      ],
    }

    const plan = buildVectorPromotionPlan({
      property: 'position',
      itemKeyframes,
      baseTransform: base,
      createId: () => 'position-key',
    })

    expect(plan.vectorProperty.keyframes[0]?.source).toBeUndefined()
  })

  it('creates a playhead key from the base transform when no scalar lanes exist', () => {
    const plan = buildVectorPromotionPlan({
      property: 'position',
      itemKeyframes: undefined,
      baseTransform: base,
      includeFrame: 12,
      createId: () => 'position-key',
    })

    expect(plan.vectorProperty.keyframes).toEqual([
      {
        id: 'position-key',
        frame: 12,
        value: { x: 10, y: 20 },
        easing: 'linear',
        easingConfig: undefined,
      },
    ])
  })
})
