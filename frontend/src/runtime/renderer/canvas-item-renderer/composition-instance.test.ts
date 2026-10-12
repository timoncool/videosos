// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { CompositionItem, TimelineItem } from '@/types/timeline'
import type { ItemRenderContext, SubCompRenderData } from './types'
import { resolveSubCompRenderDataForInstance } from './composition-instance'

const sourceText = {
  id: 'title',
  trackId: 'track',
  type: 'text',
  label: 'Title',
  text: 'Original',
  color: '#ffffff',
  from: 0,
  durationInFrames: 30,
} as TimelineItem

function makeSubData(): SubCompRenderData {
  return {
    fps: 30,
    durationInFrames: 30,
    compositionControls: {
      version: 1,
      controls: [
        {
          id: 'headline',
          name: 'Headline',
          targetItemId: 'title',
          property: 'text.text',
          kind: 'text',
          defaultValue: 'Original',
        },
      ],
    },
    sortedTracks: [{ order: 0, visible: true, items: [sourceText] }],
    keyframesMap: new Map(),
    itemsById: new Map([['title', sourceText]]),
  }
}

function makeItem(overrides: Record<string, string>): CompositionItem {
  return {
    id: 'instance-a',
    trackId: 'parent',
    type: 'composition',
    label: 'Card',
    compositionId: 'card-comp',
    compositionWidth: 1920,
    compositionHeight: 1080,
    compositionControlOverrides: overrides,
    from: 0,
    durationInFrames: 30,
  }
}

describe('resolveSubCompRenderDataForInstance', () => {
  it('materializes isolated instance values for CPU and GPU child traversal', () => {
    const source = makeSubData()
    const context = {
      subCompRenderData: new Map([['card-comp', source]]),
      instanceSubCompRenderDataCache: new Map(),
    } as unknown as ItemRenderContext

    const resolved = resolveSubCompRenderDataForInstance(
      makeItem({ headline: 'Launch day' }),
      context,
    )

    expect(resolved).not.toBe(source)
    expect(resolved?.sortedTracks[0]?.items[0]).toMatchObject({ text: 'Launch day' })
    expect(resolved?.itemsById?.get('title')).toMatchObject({ text: 'Launch day' })
    expect(source.itemsById?.get('title')).toMatchObject({ text: 'Original' })
  })

  it('reuses resolved data until the source or override map changes', () => {
    const source = makeSubData()
    const overrides = { headline: 'Instance A' }
    const context = {
      subCompRenderData: new Map([['card-comp', source]]),
      instanceSubCompRenderDataCache: new Map(),
    } as unknown as ItemRenderContext
    const item = makeItem(overrides)

    const first = resolveSubCompRenderDataForInstance(item, context)
    const second = resolveSubCompRenderDataForInstance(item, context)
    const third = resolveSubCompRenderDataForInstance(
      { ...item, compositionControlOverrides: { headline: 'Instance B' } },
      context,
    )

    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect(third?.itemsById?.get('title')).toMatchObject({ text: 'Instance B' })
  })
})
