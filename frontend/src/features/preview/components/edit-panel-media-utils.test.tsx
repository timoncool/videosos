// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { CompositionItem } from '@/types/timeline'
import { getItemAspectRatio, renderPanelMedia } from './edit-panel-media-utils'

const compositionItem: CompositionItem = {
  id: 'compound-1',
  type: 'composition',
  compositionId: 'sequence-1',
  compositionWidth: 1080,
  compositionHeight: 1920,
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Portrait sequence',
}

describe('edit panel composition media', () => {
  it('uses the nested composition aspect ratio instead of the graphic placeholder ratio', () => {
    expect(getItemAspectRatio(compositionItem)).toBe(1080 / 1920)
  })

  it('routes a compound clip to its requested source frame renderer', () => {
    const rendered = renderPanelMedia(
      compositionItem,
      2,
      undefined,
      {
        renderVideo: () => 'video',
        renderImage: () => 'image',
        renderComposition: (item, sourceFrame) => `${item.id}:${sourceFrame}`,
        renderPlaceholder: (type) => `placeholder:${type}`,
      },
      47,
    )

    expect(rendered).toBe('compound-1:47')
  })
})
