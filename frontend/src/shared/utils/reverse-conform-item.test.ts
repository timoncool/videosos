import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { resolveReverseConformedVideoItem } from './reverse-conform-item'

function makeItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:source',
    isReversed: true,
    sourceStart: 60,
    sourceEnd: 180,
    sourceDuration: 300,
    sourceFps: 30,
    speed: 2,
    reverseConformStatus: 'ready',
    reverseConformPreviewSrc: 'blob:reverse-source',
    reverseConformPreviewUsesProxy: true,
    reverseConformPreviewIsSourceLevel: true,
    reverseConformPreviewSourceDuration: 300,
    reverseConformPreviewFps: 30,
    ...overrides,
  }
}

describe('resolveReverseConformedVideoItem', () => {
  it('maps a reversed clip range into the shared whole-source conform', () => {
    const resolved = resolveReverseConformedVideoItem(makeItem(), 30, { useProxy: true })

    expect(resolved.src).toBe('blob:reverse-source')
    expect(resolved.isReversed).toBeUndefined()
    expect(resolved.sourceStart).toBe(120)
    expect(resolved.sourceEnd).toBe(240)
    expect(resolved.speed).toBe(2)
    expect(resolved.sourceFps).toBe(30)
  })

  it('converts source coordinates when the conform frame rate differs', () => {
    const resolved = resolveReverseConformedVideoItem(
      makeItem({ reverseConformPreviewFps: 60 }),
      30,
      { useProxy: true },
    )

    expect(resolved.sourceStart).toBe(240)
    expect(resolved.sourceEnd).toBe(480)
    expect(resolved.sourceDuration).toBe(600)
    expect(resolved.sourceFps).toBe(60)
  })
})
