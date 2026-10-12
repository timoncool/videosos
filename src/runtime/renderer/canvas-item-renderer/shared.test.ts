// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { isFrameInsideItemTimelineSpan } from './shared'

describe('isFrameInsideItemTimelineSpan', () => {
  it('returns true for frames inside the half-open span [from, from+duration)', () => {
    const span = { from: 10, durationInFrames: 5 }
    expect(isFrameInsideItemTimelineSpan(span, 10)).toBe(true)
    expect(isFrameInsideItemTimelineSpan(span, 14)).toBe(true)
  })

  it('returns false at the exclusive end frame', () => {
    expect(isFrameInsideItemTimelineSpan({ from: 10, durationInFrames: 5 }, 15)).toBe(false)
  })

  it('returns false before from', () => {
    expect(isFrameInsideItemTimelineSpan({ from: 10, durationInFrames: 5 }, 9)).toBe(false)
  })

  // The DOM-video gate in video.ts passes a RenderTimelineSpan here so that
  // transition participants — whose effective span is wider than the natural
  // item span during a transition zone — are still recognized as in-range.
  it('accepts an extended RenderTimelineSpan from a transition participant', () => {
    const itemSpan = { from: 0, durationInFrames: 100 }
    const transitionExtendedSpan = { from: 0, durationInFrames: 110, sourceStart: 0 }
    expect(isFrameInsideItemTimelineSpan(itemSpan, 105)).toBe(false)
    expect(isFrameInsideItemTimelineSpan(transitionExtendedSpan, 105)).toBe(true)
  })
})
