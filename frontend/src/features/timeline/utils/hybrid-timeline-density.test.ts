import { describe, expect, it } from 'vite-plus/test'
import {
  HYBRID_TIMELINE_FRAME_BUDGET_MS,
  HYBRID_TIMELINE_MAIN_THREAD_BUDGET_MS,
  HYBRID_TIMELINE_TOTAL_ITEM_THRESHOLD,
  HYBRID_TIMELINE_TRACK_ITEM_THRESHOLD,
  shouldUseHybridTimelineRenderer,
} from './hybrid-timeline-density'

describe('shouldUseHybridTimelineRenderer', () => {
  it('documents a 60fps frame budget with room for browser paint', () => {
    expect(HYBRID_TIMELINE_FRAME_BUDGET_MS).toBeCloseTo(16.67, 1)
    expect(HYBRID_TIMELINE_MAIN_THREAD_BUDGET_MS).toBeLessThan(HYBRID_TIMELINE_FRAME_BUDGET_MS / 2)
  })

  it('keeps the rich DOM renderer below both density thresholds', () => {
    expect(
      shouldUseHybridTimelineRenderer({
        totalItemCount: HYBRID_TIMELINE_TOTAL_ITEM_THRESHOLD - 1,
        trackItemCount: HYBRID_TIMELINE_TRACK_ITEM_THRESHOLD - 1,
      }),
    ).toBe(false)
  })

  it('enables the hybrid renderer for a dense project', () => {
    expect(
      shouldUseHybridTimelineRenderer({
        totalItemCount: HYBRID_TIMELINE_TOTAL_ITEM_THRESHOLD,
        trackItemCount: 1,
      }),
    ).toBe(true)
  })

  it('enables the hybrid renderer for one dense track', () => {
    expect(
      shouldUseHybridTimelineRenderer({
        totalItemCount: 1,
        trackItemCount: HYBRID_TIMELINE_TRACK_ITEM_THRESHOLD,
      }),
    ).toBe(true)
  })
})
