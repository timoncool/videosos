import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { resolveTimelineMarqueeItems } from './timeline-marquee-geometry'

function setRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  })
}

function makeItem(id: string, from: number, durationInFrames: number): TimelineItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    mediaId: `media-${id}`,
    src: `blob:${id}`,
  }
}

describe('timeline marquee geometry', () => {
  it('uses native roots when present and frame geometry for compact clips', () => {
    const container = document.createElement('div')
    const surface = document.createElement('div')
    surface.dataset.timelineCommittedSurface = 'tracks'
    const track = document.createElement('div')
    track.dataset.trackId = 'track-1'
    const contentLayer = document.createElement('div')
    contentLayer.dataset.timelineTrackContentLayer = 'true'
    const native = document.createElement('div')
    native.dataset.timelineItem = 'true'
    native.dataset.itemId = 'native'
    contentLayer.append(native)
    track.append(contentLayer)
    surface.append(track)
    container.append(surface)
    setRect(surface, { left: 100, top: 20, width: 1_000, height: 80 })
    setRect(track, { left: 100, top: 40, width: 1_000, height: 60 })
    // The final 100px is navigation room, not frame-addressable clip space.
    setRect(contentLayer, { left: 100, top: 40, width: 900, height: 60 })
    setRect(native, { left: 160, top: 42, width: 90, height: 56 })

    const nativeItem = makeItem('native', 30, 30)
    const compactItem = makeItem('compact', 300, 60)
    const result = resolveTimelineMarqueeItems(
      container,
      ['native', 'compact'],
      { native: nativeItem, compact: compactItem },
      600,
    )

    expect(result[0]?.rect).toMatchObject({ left: 160, right: 250, top: 42, bottom: 98 })
    expect(result[1]?.rect).toMatchObject({ left: 550, right: 640, top: 41, bottom: 99 })
  })
})
