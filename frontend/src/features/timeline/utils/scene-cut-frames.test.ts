// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { mapSceneCutTimesToTimelineFrames } from './scene-cut-frames'

describe('mapSceneCutTimesToTimelineFrames', () => {
  it('maps source time using project FPS', () => {
    expect(
      mapSceneCutTimesToTimelineFrames({
        cuts: [{ time: 2 }],
        sourceStartSeconds: 0,
        projectFps: 30,
        clipFrom: 100,
        clipDurationInFrames: 300,
      }),
    ).toEqual([160])
  })

  it('accounts for a trimmed source offset', () => {
    expect(
      mapSceneCutTimesToTimelineFrames({
        cuts: [{ time: 10.5 }],
        sourceStartSeconds: 10,
        projectFps: 24,
        clipFrom: 48,
        clipDurationInFrames: 120,
      }),
    ).toEqual([60])
  })

  it('deduplicates rounded frames and sorts results', () => {
    expect(
      mapSceneCutTimesToTimelineFrames({
        cuts: [{ time: 1.011 }, { time: 0.5 }, { time: 1.012 }],
        sourceStartSeconds: 0,
        projectFps: 30,
        clipFrom: 0,
        clipDurationInFrames: 100,
      }),
    ).toEqual([15, 30])
  })

  it('filters cuts at or outside clip bounds and invalid times', () => {
    expect(
      mapSceneCutTimesToTimelineFrames({
        cuts: [{ time: 4 }, { time: 5 }, { time: 7 }, { time: 9 }, { time: Number.NaN }],
        sourceStartSeconds: 5,
        projectFps: 10,
        clipFrom: 20,
        clipDurationInFrames: 40,
      }),
    ).toEqual([40])
  })
})
