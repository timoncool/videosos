import { describe, expect, it } from 'vite-plus/test'
import type { CompositionItem } from '@/types/timeline'
import { applySlidePreview, applySlipPreview } from './item-edit-preview'

function makeCompositionItem(): CompositionItem {
  return {
    id: 'compound-1',
    type: 'composition',
    trackId: 'video-track',
    from: 30,
    durationInFrames: 30,
    label: 'Nested compound',
    compositionId: 'nested-composition',
    compositionWidth: 1920,
    compositionHeight: 1080,
    sourceStart: 120,
    sourceEnd: 240,
    sourceDuration: 600,
    sourceFps: 60,
    speed: 2,
  }
}

describe('composition source-window previews', () => {
  it('slips the wrapper source window without moving it', () => {
    expect(applySlipPreview(makeCompositionItem(), 20)).toEqual({
      id: 'compound-1',
      sourceStart: 140,
      sourceEnd: 260,
    })
  })

  it('slides the wrapper and carries its continuity source delta', () => {
    expect(applySlidePreview(makeCompositionItem(), 5, 20)).toEqual({
      id: 'compound-1',
      from: 35,
      sourceStart: 140,
      sourceEnd: 260,
    })
  })
})
