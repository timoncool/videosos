import { describe, expect, it } from 'vite-plus/test'
import { createScrubThrottleState, shouldCommitScrubFrame } from './scrub-throttle'

describe('shouldCommitScrubFrame', () => {
  it('rate-limits large frame jumps on an extremely zoomed-out overview', () => {
    const state = createScrubThrottleState({ pointerX: 0, frame: 0, nowMs: 0 })

    expect(
      shouldCommitScrubFrame({
        state,
        pointerX: 1,
        targetFrame: 70,
        pixelsPerSecond: 0.5,
        nowMs: 16,
        overview: true,
      }),
    ).toBe(false)

    expect(
      shouldCommitScrubFrame({
        state,
        pointerX: 3,
        targetFrame: 210,
        pixelsPerSecond: 0.5,
        nowMs: 50,
        overview: true,
      }),
    ).toBe(true)
  })

  it('keeps the responsive frame-delta bypass for a standard timeline', () => {
    const state = createScrubThrottleState({ pointerX: 0, frame: 0, nowMs: 0 })

    expect(
      shouldCommitScrubFrame({
        state,
        pointerX: 1,
        targetFrame: 70,
        pixelsPerSecond: 0.5,
        nowMs: 1,
      }),
    ).toBe(true)
  })

  it('returns overview timelines to the normal cadence when sufficiently zoomed in', () => {
    const state = createScrubThrottleState({ pointerX: 0, frame: 0, nowMs: 0 })

    expect(
      shouldCommitScrubFrame({
        state,
        pointerX: 1,
        targetFrame: 4,
        pixelsPerSecond: 180,
        nowMs: 1,
        overview: true,
      }),
    ).toBe(true)
  })
})
