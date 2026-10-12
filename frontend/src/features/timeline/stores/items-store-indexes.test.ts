import { describe, expect, it } from 'vite-plus/test'
import type { TextItem, VideoItem } from '@/types/timeline'
import { getTrackItemRelations, selectConsolidatableCaptionClipIds } from './items-store-indexes'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'item',
    type: 'video',
    trackId: 'track-1',
    from: 20,
    durationInFrames: 10,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  }
}

function makeCaptionItem(
  overrides: Partial<TextItem> & {
    clipId: string
    sourceType?: 'embedded-subtitles' | 'subtitle-import'
  },
): TextItem {
  const { clipId, sourceType = 'embedded-subtitles', ...rest } = overrides
  return {
    id: 'caption',
    type: 'text',
    trackId: 'track-1',
    from: 20,
    durationInFrames: 10,
    text: 'caption',
    color: '#ffffff',
    captionSource: {
      type: sourceType,
      clipId,
      mediaId: 'media-1',
    },
    ...rest,
  } as TextItem
}

describe('getTrackItemRelations', () => {
  it('preserves first-match clip neighbors and deterministic drag ties', () => {
    const target = makeVideoItem({ id: 'target' })
    const rightFirst = makeVideoItem({ id: 'right-first', from: 30 })
    const rightSecond = makeVideoItem({ id: 'right-second', from: 30 })
    const leftFirst = makeVideoItem({ id: 'left-first', from: 10 })
    const leftSecond = makeVideoItem({
      id: 'left-second',
      from: 0,
      durationInFrames: 20,
    })
    const trackItems = [rightFirst, rightSecond, leftFirst, leftSecond, target]

    const relations = getTrackItemRelations(trackItems, target)

    expect(relations.leftNeighbor?.id).toBe('left-first')
    expect(relations.rightNeighbor?.id).toBe('right-first')
    expect(relations.neighborKey).toBe('left-second|right-second')
    expect(relations.dragNeighborIds).toEqual({
      leftId: 'left-first',
      rightId: 'right-second',
    })
  })

  it('measures the gap from the greatest completed end and ignores overlaps', () => {
    const target = makeVideoItem({ id: 'target', from: 100 })
    const early = makeVideoItem({ id: 'early', from: 10, durationInFrames: 30 })
    const nearest = makeVideoItem({ id: 'nearest', from: 60, durationInFrames: 20 })
    const overlapping = makeVideoItem({
      id: 'overlapping',
      from: 90,
      durationInFrames: 30,
    })
    const trackItems = [overlapping, early, target, nearest]

    const relations = getTrackItemRelations(trackItems, target)

    expect(relations.leftNeighbor).toBeNull()
    expect(relations.gapBeforeFrames).toBe(20)
  })

  it('reuses the cached relation for an unchanged track array', () => {
    const target = makeVideoItem({ id: 'target' })
    const trackItems = [target]

    expect(getTrackItemRelations(trackItems, target)).toBe(
      getTrackItemRelations(trackItems, target),
    )
  })
})

describe('selectConsolidatableCaptionClipIds', () => {
  it('collects clip ids owning embedded or imported per-cue captions', () => {
    const items = [
      makeCaptionItem({ clipId: 'clip-1' }),
      makeCaptionItem({ id: 'caption-2', clipId: 'clip-2', sourceType: 'subtitle-import' }),
      makeCaptionItem({ id: 'caption-3', clipId: 'clip-3', sourceType: 'subtitle-import' }),
      makeVideoItem({ id: 'clip-1' }),
    ]
    // Overwrite one caption's source type via a fresh object to prove the
    // selector ignores non-consolidatable sources (e.g. transcript captions).
    const transcriptCaption: TextItem = {
      ...makeCaptionItem({ id: 'caption-4', clipId: 'clip-4' }),
      captionSource: { type: 'transcript', clipId: 'clip-4', mediaId: 'media-1' },
    }
    items.push(transcriptCaption)

    const ids = selectConsolidatableCaptionClipIds({ items })

    expect(ids.has('clip-1')).toBe(true)
    expect(ids.has('clip-2')).toBe(true)
    expect(ids.has('clip-3')).toBe(true)
    expect(ids.has('clip-4')).toBe(false)
  })

  it('reuses the derived index while the items array is unchanged', () => {
    const items = [makeCaptionItem({ clipId: 'clip-1' })]
    const first = selectConsolidatableCaptionClipIds({ items })
    expect(selectConsolidatableCaptionClipIds({ items })).toBe(first)

    const rebuilt = selectConsolidatableCaptionClipIds({ items: [...items] })
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.has('clip-1')).toBe(true)
  })
})
