// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { resolveEditOverlayVisualItem } from './edit-overlay-visual-item'

function makeItem(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    id: 'item',
    type: 'video',
    trackId: 'track',
    from: 10,
    durationInFrames: 60,
    label: 'Clip',
    sourceStart: 5,
    sourceEnd: 65,
    speed: 1,
    ...overrides,
  } as TimelineItem
}

describe('resolveEditOverlayVisualItem', () => {
  it('uses the synchronized video companion when an edit starts from linked audio', () => {
    const audio = makeItem({
      id: 'audio',
      type: 'audio',
      trackId: 'audio-track',
      linkedGroupId: 'pair',
    })
    const video = makeItem({
      id: 'video',
      trackId: 'video-track',
      linkedGroupId: 'pair',
    })

    expect(resolveEditOverlayVisualItem([audio, video], audio)).toBe(video)
  })

  it('uses a synchronized compound visual wrapper for linked compound audio', () => {
    const audio = makeItem({
      id: 'compound-audio',
      type: 'audio',
      trackId: 'audio-track',
      linkedGroupId: 'compound-pair',
    })
    const composition = makeItem({
      id: 'compound-visual',
      type: 'composition',
      trackId: 'video-track',
      linkedGroupId: 'compound-pair',
      compositionId: 'nested-composition',
    })

    expect(resolveEditOverlayVisualItem([audio, composition], audio)).toBe(composition)
  })

  it('does not show an out-of-sync linked visual for an audio-only edit', () => {
    const audio = makeItem({
      id: 'audio',
      type: 'audio',
      trackId: 'audio-track',
      linkedGroupId: 'pair',
    })
    const video = makeItem({
      id: 'video',
      trackId: 'video-track',
      linkedGroupId: 'pair',
      sourceStart: 12,
      sourceEnd: 72,
    })

    expect(resolveEditOverlayVisualItem([audio, video], audio)).toBe(audio)
  })
})
