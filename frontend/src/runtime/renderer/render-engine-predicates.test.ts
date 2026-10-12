// @vitest-environment node

import { describe, it, expect } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { shouldRenderResolvedItemAtFrame } from './render-engine-predicates'

const FROM = 100
const DURATION = 50

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    trackId: 'track-1',
    type: 'video',
    src: 'workspace://media/clip.mp4',
    label: 'clip',
    from: FROM,
    durationInFrames: DURATION,
    ...overrides,
  } as TimelineItem
}

const NO_TRANSITIONS: ReadonlySet<string> = new Set()

describe('shouldRenderResolvedItemAtFrame', () => {
  it.each([
    { name: 'one frame before the in point', frame: FROM - 1, expected: false },
    { name: 'exactly at the in point', frame: FROM, expected: true },
    { name: 'mid-clip', frame: FROM + 25, expected: true },
    { name: 'last frame of the clip', frame: FROM + DURATION - 1, expected: true },
    { name: 'exactly at the out point (exclusive)', frame: FROM + DURATION, expected: false },
  ])('$name -> $expected', ({ frame, expected }) => {
    expect(shouldRenderResolvedItemAtFrame(makeItem(), frame, NO_TRANSITIONS)).toBe(expected)
  })

  it('skips a clip currently handled by a transition', () => {
    const transitionClipIds = new Set(['item-1'])
    expect(shouldRenderResolvedItemAtFrame(makeItem(), FROM + 10, transitionClipIds)).toBe(false)
    expect(
      shouldRenderResolvedItemAtFrame(makeItem({ id: 'other' }), FROM + 10, transitionClipIds),
    ).toBe(true)
  })

  it.each([
    { type: 'audio', reason: 'audio is mixed separately' },
    { type: 'adjustment', reason: 'adjustment layers apply effects, not pixels' },
    { type: 'controller', reason: 'null/controller layers only drive transforms' },
  ] as const)('skips $type items ($reason)', ({ type }) => {
    const item = makeItem({ type } as Partial<TimelineItem>)
    expect(shouldRenderResolvedItemAtFrame(item, FROM + 10, NO_TRANSITIONS)).toBe(false)
  })

  it('skips mask shapes but renders regular shapes', () => {
    const maskShape = makeItem({ type: 'shape', isMask: true } as Partial<TimelineItem>)
    const shape = makeItem({ type: 'shape' } as Partial<TimelineItem>)
    expect(shouldRenderResolvedItemAtFrame(maskShape, FROM + 10, NO_TRANSITIONS)).toBe(false)
    expect(shouldRenderResolvedItemAtFrame(shape, FROM + 10, NO_TRANSITIONS)).toBe(true)
  })

  it.each(['video', 'image', 'text', 'composition'] as const)('renders active %s items', (type) => {
    const item = makeItem({ type } as Partial<TimelineItem>)
    expect(shouldRenderResolvedItemAtFrame(item, FROM + 10, NO_TRANSITIONS)).toBe(true)
  })
})
