// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  applyCompositionControlOverrides,
  getCompositionControlCandidates,
  sanitizeCompositionControlSchema,
} from './composition-controls'

const items = [
  {
    id: 'title',
    trackId: 't1',
    type: 'text',
    label: 'Headline',
    text: 'Original',
    color: '#ffffff',
    from: 0,
    durationInFrames: 30,
  },
  {
    id: 'card',
    trackId: 't2',
    type: 'shape',
    label: 'Card',
    shapeType: 'rectangle',
    fillColor: '#112233',
    strokeEnabled: true,
    strokeColor: '#445566',
    from: 0,
    durationInFrames: 30,
  },
  {
    id: 'gradient',
    trackId: 't3',
    type: 'shape',
    label: 'Gradient',
    shapeType: 'rectangle',
    fillColor: '#3b82f6',
    fillType: 'linear',
    gradientStartColor: '#3b82f6',
    gradientEndColor: '#8b5cf6',
    from: 0,
    durationInFrames: 30,
  },
] as TimelineItem[]

describe('composition controls', () => {
  it('discovers purposeful text and color candidates from editable layers', () => {
    expect(getCompositionControlCandidates(items)).toMatchObject([
      { targetItemId: 'title', property: 'text.text', kind: 'text', defaultValue: 'Original' },
      { targetItemId: 'title', property: 'text.color', kind: 'color', defaultValue: '#ffffff' },
      { targetItemId: 'card', property: 'shape.fillColor', kind: 'color' },
      { targetItemId: 'card', property: 'shape.strokeColor', kind: 'color' },
    ])
  })

  it('does not expose a misleading solid fill control for gradient Shapes', () => {
    expect(
      getCompositionControlCandidates(items).find(
        (candidate) =>
          candidate.targetItemId === 'gradient' && candidate.property === 'shape.fillColor',
      ),
    ).toBeUndefined()
  })

  it('applies only declared per-instance overrides without mutating source layers', () => {
    const schema = {
      version: 1 as const,
      controls: [
        {
          id: 'headline',
          name: 'Headline',
          targetItemId: 'title',
          property: 'text.text' as const,
          kind: 'text' as const,
          defaultValue: 'Original',
        },
        {
          id: 'accent',
          name: 'Accent',
          targetItemId: 'card',
          property: 'shape.fillColor' as const,
          kind: 'color' as const,
          defaultValue: '#112233',
        },
      ],
    }

    const resolved = applyCompositionControlOverrides(items, schema, {
      headline: 'Instance A',
      accent: '#ff5500',
      stale: 'ignored',
    })

    expect(resolved).not.toBe(items)
    expect(resolved[0]).toMatchObject({ text: 'Instance A' })
    expect(resolved[1]).toMatchObject({ fillColor: '#ff5500' })
    expect(items[0]).toMatchObject({ text: 'Original' })
    expect(items[1]).toMatchObject({ fillColor: '#112233' })
  })

  it('sanitizes duplicate, missing-target, and type-mismatched definitions', () => {
    const schema = sanitizeCompositionControlSchema(
      {
        version: 1,
        controls: [
          {
            id: 'ok',
            name: '  Headline  ',
            targetItemId: 'title',
            property: 'text.text',
            kind: 'text',
            defaultValue: 'Saved default',
          },
          {
            id: 'duplicate-target',
            name: 'Again',
            targetItemId: 'title',
            property: 'text.text',
            kind: 'text',
          },
          {
            id: 'wrong-kind',
            name: 'Wrong',
            targetItemId: 'card',
            property: 'shape.fillColor',
            kind: 'text',
          },
          {
            id: 'missing',
            name: 'Missing',
            targetItemId: 'gone',
            property: 'text.text',
            kind: 'text',
          },
        ],
      },
      items,
    )

    expect(schema).toEqual({
      version: 1,
      controls: [
        {
          id: 'ok',
          name: 'Headline',
          targetItemId: 'title',
          property: 'text.text',
          kind: 'text',
          defaultValue: 'Saved default',
        },
      ],
    })
  })
})
