import { describe, expect, it } from 'vite-plus/test'

/** Compare Map<string, number[]> values with floating-point tolerance. */
function expectMapCloseTo(
  actual: Map<string, number[]>,
  expected: Map<string, number[]>,
  precision = 4,
) {
  expect(actual.size).toBe(expected.size)
  for (const [key, expectedValues] of expected) {
    const actualValues = actual.get(key)
    expect(actualValues).toBeDefined()
    expect(actualValues!.length).toBe(expectedValues.length)
    for (let i = 0; i < expectedValues.length; i++) {
      expect(actualValues![i]).toBeCloseTo(expectedValues[i]!, precision)
    }
  }
}
import type { CompositionItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  collectClipVideoSourceTimesBySrcForFrame,
  collectClipVideoSourceTimesBySrcForFrameRange,
  collectPlaybackStartVariableSpeedPreseekTargets,
  collectPlaybackStartVariableSpeedPrewarmItemIds,
  collectVisibleTrackVideoSourceTimesBySrc,
  getVideoItemSourceTimeSeconds,
  mapTimelineFrameToSubCompositionFrame,
  resolvePreviewPreseekSource,
  resolvePausedVariableSpeedPrewarmPlan,
  resolveActivePreviewLookaheadTimestamps,
  shouldRunJumpPreseek,
} from './render-pump-preseek'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    trackId: 'track-1',
    type: 'video',
    label: 'Video',
    src: 'clip-a.mp4',
    from: 10,
    durationInFrames: 30,
    sourceStart: 120,
    sourceFps: 60,
    speed: 2,
    ...overrides,
  }
}

function makeTrack(items: VideoItem[]): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  }
}

describe('render pump preseek helpers', () => {
  it('keeps worker preseek on the original source when proxy playback is disabled', () => {
    expect(
      resolvePreviewPreseekSource({
        useProxy: false,
        proxySource: 'blob:proxy',
        liveSource: 'blob:original',
        itemSource: 'blob:stale-item-source',
      }),
    ).toBe('blob:original')
  })

  it('uses the proxy source when proxy playback is enabled', () => {
    expect(
      resolvePreviewPreseekSource({
        useProxy: true,
        proxySource: 'blob:proxy',
        liveSource: 'blob:original',
        itemSource: 'blob:stale-item-source',
      }),
    ).toBe('blob:proxy')
  })

  it('computes source time at a timeline frame', () => {
    const item = makeVideoItem({
      from: 10,
      sourceStart: 120,
      sourceFps: 60,
      speed: 2,
    })

    expect(getVideoItemSourceTimeSeconds(item, 16, 30)).toBeCloseTo(2.4)
  })

  it('computes descending source time for a reversed clip', () => {
    const item = makeVideoItem({
      from: 10,
      durationInFrames: 30,
      sourceStart: 120,
      sourceEnd: 180,
      sourceFps: 60,
      speed: 1,
      isReversed: true,
    })

    expect(getVideoItemSourceTimeSeconds(item, 10, 30)).toBeCloseTo(179 / 60)
    expect(getVideoItemSourceTimeSeconds(item, 11, 30)).toBeCloseTo(177 / 60)
    expect(getVideoItemSourceTimeSeconds(item, 39, 30)).toBeCloseTo(121 / 60)
  })

  it('derives the reverse endpoint when sourceEnd is absent', () => {
    const item = makeVideoItem({
      from: 10,
      durationInFrames: 15,
      sourceStart: 120,
      sourceEnd: undefined,
      sourceFps: 60,
      speed: 2,
      isReversed: true,
    })

    expect(getVideoItemSourceTimeSeconds(item, 10, 30)).toBeCloseTo(179 / 60)
    expect(getVideoItemSourceTimeSeconds(item, 11, 30)).toBeCloseTo(175 / 60)
  })

  it('collects reversed playback windows from the selected proxy mode source', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'reversed-proxy-toggle',
          src: 'blob:stale-item-source',
          from: 10,
          durationInFrames: 30,
          sourceStart: 120,
          sourceEnd: 180,
          sourceFps: 60,
          speed: 1,
          isReversed: true,
        }),
      ]),
    ]

    const collectForMode = (useProxy: boolean) =>
      collectVisibleTrackVideoSourceTimesBySrc(tracks, 10, 30, {
        resolveItemSrc: () =>
          resolvePreviewPreseekSource({
            useProxy,
            proxySource: 'blob:proxy',
            liveSource: 'blob:original',
            itemSource: 'blob:stale-item-source',
          }),
      })

    expectMapCloseTo(collectForMode(false), new Map([['blob:original', [179 / 60]]]))
    expectMapCloseTo(collectForMode(true), new Map([['blob:proxy', [179 / 60]]]))
  })

  it('requires explicit source fps when requested', () => {
    const item = makeVideoItem({ sourceFps: undefined })

    expect(getVideoItemSourceTimeSeconds(item, 16, 30)).not.toBeNull()
    expect(
      getVideoItemSourceTimeSeconds(item, 16, 30, {
        requireExplicitSourceFps: true,
      }),
    ).toBeNull()
  })

  it('groups visible video source times by src', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'a',
          src: 'same.mp4',
          from: 0,
          durationInFrames: 20,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
        }),
        makeVideoItem({
          id: 'b',
          src: 'same.mp4',
          from: 0,
          durationInFrames: 20,
          speed: 1,
          sourceStart: 30,
          sourceFps: 30,
        }),
        makeVideoItem({
          id: 'c',
          src: 'other.mp4',
          from: 30,
          durationInFrames: 20,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
        }),
      ]),
    ]

    expectMapCloseTo(
      collectVisibleTrackVideoSourceTimesBySrc(tracks, 10, 30),
      new Map([['same.mp4', [10 / 30, 40 / 30]]]),
    )
  })

  it('does not register hidden root tracks as active preview dependencies', () => {
    const visibleTrack = makeTrack([
      makeVideoItem({
        id: 'visible',
        src: 'visible.mp4',
        from: 0,
        durationInFrames: 20,
        sourceStart: 0,
        sourceFps: 30,
        speed: 1,
      }),
    ])
    const hiddenTrack = {
      ...makeTrack([
        makeVideoItem({
          id: 'hidden',
          trackId: 'track-hidden',
          src: 'hidden.mp4',
          from: 0,
          durationInFrames: 20,
          sourceStart: 0,
          sourceFps: 30,
          speed: 1,
        }),
      ]),
      id: 'track-hidden',
      visible: false,
    }

    expectMapCloseTo(
      collectVisibleTrackVideoSourceTimesBySrc([visibleTrack, hiddenTrack], 10, 30),
      new Map([['visible.mp4', [10 / 30]]]),
    )
  })

  it('registers only solo root tracks when any track is soloed', () => {
    const visibleNonSoloTrack = {
      ...makeTrack([
        makeVideoItem({
          id: 'visible-non-solo',
          trackId: 'track-visible',
          src: 'visible.mp4',
          from: 0,
          durationInFrames: 20,
          sourceStart: 0,
          sourceFps: 30,
          speed: 1,
        }),
      ]),
      id: 'track-visible',
      visible: true,
      solo: false,
    }
    const hiddenSoloTrack = {
      ...makeTrack([
        makeVideoItem({
          id: 'hidden-solo',
          trackId: 'track-solo',
          src: 'solo.mp4',
          from: 0,
          durationInFrames: 20,
          sourceStart: 0,
          sourceFps: 30,
          speed: 1,
        }),
      ]),
      id: 'track-solo',
      visible: false,
      solo: true,
    }

    expectMapCloseTo(
      collectVisibleTrackVideoSourceTimesBySrc([visibleNonSoloTrack, hiddenSoloTrack], 10, 30),
      new Map([['solo.mp4', [10 / 30]]]),
    )
  })

  it('collects transition clip source times for a frame range', () => {
    const items = [
      makeVideoItem({
        id: 'left',
        src: 'left.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 0,
        sourceFps: 30,
        speed: 1,
      }),
      makeVideoItem({
        id: 'right',
        src: 'right.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 90,
        sourceFps: 30,
        speed: 1,
      }),
    ]

    expectMapCloseTo(
      collectClipVideoSourceTimesBySrcForFrameRange(items, 40, 3, 30, {
        requireExplicitSourceFps: true,
      }),
      new Map([
        ['left.mp4', [0, 1 / 30, 2 / 30]],
        ['right.mp4', [3, 3 + 1 / 30, 3 + 2 / 30]],
      ]),
    )
  })

  it('collects transition clip source times for a single frame', () => {
    const items = [
      makeVideoItem({
        id: 'left',
        src: 'left.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 0,
        sourceFps: 30,
        speed: 1,
      }),
      makeVideoItem({
        id: 'right',
        src: 'right.mp4',
        from: 40,
        durationInFrames: 20,
        sourceStart: 60,
        sourceFps: 30,
        speed: 1,
      }),
    ]

    expectMapCloseTo(
      collectClipVideoSourceTimesBySrcForFrame(items, 41, 30, {
        requireExplicitSourceFps: true,
      }),
      new Map([
        ['left.mp4', [1 / 30]],
        ['right.mp4', [60 / 30 + 1 / 30]],
      ]),
    )
  })

  it('collects variable-speed playback-start prewarm ids and preseek targets', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'start-near',
          from: 100,
          durationInFrames: 60,
          speed: 1.5,
          sourceStart: 0,
          sourceFps: 30,
          src: 'near.mp4',
        }),
        makeVideoItem({
          id: 'already-running',
          from: 90,
          durationInFrames: 60,
          speed: 1.5,
          sourceStart: 0,
          sourceFps: 30,
          src: 'running.mp4',
        }),
        makeVideoItem({
          id: 'normal-speed',
          from: 100,
          durationInFrames: 60,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
          src: 'normal.mp4',
        }),
      ]),
    ]

    expect(collectPlaybackStartVariableSpeedPrewarmItemIds(tracks, 101)).toEqual(['start-near'])

    expect(collectPlaybackStartVariableSpeedPreseekTargets(tracks, 101, 30, 90)).toEqual([
      { src: 'near.mp4', time: 2.95 },
      { src: 'running.mp4', time: 2.95 },
    ])
  })

  it('resolves paused variable-speed prewarm visibility and preseek frame', () => {
    const tracks = [
      {
        ...makeTrack([
          makeVideoItem({
            id: 'occluder',
            from: 95,
            durationInFrames: 20,
            speed: 1,
            sourceStart: 0,
            sourceFps: 30,
            src: 'top.mp4',
          }),
        ]),
        id: 'top',
        order: 0,
      },
      {
        ...makeTrack([
          makeVideoItem({
            id: 'var-speed',
            from: 110,
            durationInFrames: 40,
            speed: 1.5,
            sourceStart: 0,
            sourceFps: 30,
            src: 'bottom.mp4',
          }),
        ]),
        id: 'bottom',
        order: 1,
      },
    ]

    expect(resolvePausedVariableSpeedPrewarmPlan(tracks, 100, 30)).toEqual({
      itemIds: ['var-speed'],
      visibilityFrame: 115,
      preseekFrame: 114,
    })
  })

  it('uses the earliest visibility frame across paused variable-speed candidates', () => {
    const tracks = [
      {
        ...makeTrack([
          makeVideoItem({
            id: 'top-occluder',
            from: 90,
            durationInFrames: 25,
            speed: 1,
          }),
        ]),
        id: 'top',
        order: 0,
      },
      {
        ...makeTrack([
          makeVideoItem({
            id: 'middle-candidate',
            from: 112,
            durationInFrames: 30,
            speed: 1.25,
            src: 'middle.mp4',
          }),
        ]),
        id: 'middle',
        order: 1,
      },
      {
        ...makeTrack([
          makeVideoItem({
            id: 'bottom-candidate',
            from: 118,
            durationInFrames: 30,
            speed: 1.5,
            src: 'bottom.mp4',
          }),
        ]),
        id: 'bottom',
        order: 2,
      },
    ]

    expect(resolvePausedVariableSpeedPrewarmPlan(tracks, 100, 30)).toEqual({
      itemIds: ['middle-candidate', 'bottom-candidate'],
      visibilityFrame: 115,
      preseekFrame: 114,
    })
  })

  it('keeps paused variable-speed preseek at the current frame when already visible', () => {
    const tracks = [
      {
        ...makeTrack([
          makeVideoItem({
            id: 'visible-soon',
            from: 104,
            durationInFrames: 30,
            speed: 1.5,
            src: 'visible.mp4',
          }),
        ]),
        id: 'top',
        order: 0,
      },
    ]

    expect(resolvePausedVariableSpeedPrewarmPlan(tracks, 100, 30)).toEqual({
      itemIds: ['visible-soon'],
      visibilityFrame: 100,
      preseekFrame: 100,
    })
  })

  it('returns null when there are no paused variable-speed candidates', () => {
    const tracks = [
      makeTrack([
        makeVideoItem({
          id: 'normal',
          from: 110,
          durationInFrames: 40,
          speed: 1,
          sourceStart: 0,
          sourceFps: 30,
          src: 'normal.mp4',
        }),
      ]),
    ]

    expect(resolvePausedVariableSpeedPrewarmPlan(tracks, 100, 30)).toBeNull()
  })
})

describe('shouldRunJumpPreseek', () => {
  const fps = 30

  it('never preseeks during playback', () => {
    expect(shouldRunJumpPreseek({ prevFrame: 0, nextFrame: 600, fps, isPlaying: true })).toBe(false)
  })

  it('never preseeks when the frame did not change', () => {
    expect(shouldRunJumpPreseek({ prevFrame: 90, nextFrame: 90, fps, isPlaying: false })).toBe(
      false,
    )
  })

  it('skips forward jumps under 3 seconds (sequential advance is cheap)', () => {
    expect(shouldRunJumpPreseek({ prevFrame: 0, nextFrame: 89, fps, isPlaying: false })).toBe(false)
  })

  it('preseeks forward jumps of 3 seconds or more', () => {
    expect(shouldRunJumpPreseek({ prevFrame: 0, nextFrame: 90, fps, isPlaying: false })).toBe(true)
  })

  it('preseeks backward jumps of 0.5 seconds or more', () => {
    expect(shouldRunJumpPreseek({ prevFrame: 90, nextFrame: 75, fps, isPlaying: false })).toBe(true)
  })

  it('skips tiny backward jumps under 0.5 seconds', () => {
    expect(shouldRunJumpPreseek({ prevFrame: 90, nextFrame: 76, fps, isPlaying: false })).toBe(
      false,
    )
  })

  it('uses fps to scale thresholds', () => {
    // 60fps: forward threshold 180 frames, backward threshold 30 frames
    expect(shouldRunJumpPreseek({ prevFrame: 0, nextFrame: 179, fps: 60, isPlaying: false })).toBe(
      false,
    )
    expect(shouldRunJumpPreseek({ prevFrame: 0, nextFrame: 180, fps: 60, isPlaying: false })).toBe(
      true,
    )
    expect(
      shouldRunJumpPreseek({ prevFrame: 180, nextFrame: 150, fps: 60, isPlaying: false }),
    ).toBe(true)
    expect(
      shouldRunJumpPreseek({ prevFrame: 180, nextFrame: 151, fps: 60, isPlaying: false }),
    ).toBe(false)
  })
})

describe('active preview lookahead', () => {
  it('keeps an adjacent frame on both sides for fine scrubbing', () => {
    expect(
      resolveActivePreviewLookaheadTimestamps({
        sourceTime: 10,
        previousSourceTime: 9.99,
        elapsedMs: 100,
        sourceFps: 30,
        fallbackDirection: 1,
      }),
    ).toEqual([10 + 1 / 30, 10 - 1 / 30])
  })

  it('spreads directional lookahead when scrub velocity is high', () => {
    expect(
      resolveActivePreviewLookaheadTimestamps({
        sourceTime: 20,
        previousSourceTime: 10,
        elapsedMs: 50,
        sourceFps: 30,
        fallbackDirection: 1,
      }),
    ).toEqual([20 + 1 / 30, 20 + 120 / 30, 20 - 1 / 30])
  })

  it('clamps backward lookahead to the start of the source', () => {
    expect(
      resolveActivePreviewLookaheadTimestamps({
        sourceTime: 0,
        previousSourceTime: 1,
        elapsedMs: 16,
        sourceFps: 30,
        fallbackDirection: -1,
      }),
    ).toEqual([1 / 30])
  })
})

describe('compound clip preseek recursion', () => {
  function makeCompositionItem(overrides: Partial<CompositionItem> = {}): CompositionItem {
    return {
      id: 'comp-1',
      trackId: 'track-1',
      type: 'composition',
      label: 'Compound',
      compositionId: 'sub-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
      from: 100,
      durationInFrames: 300,
      ...overrides,
    }
  }

  function makeSubVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
    return {
      id: 'sub-video-1',
      trackId: 'sub-track-1',
      type: 'video',
      label: 'Sub Video',
      src: 'blob:stale',
      mediaId: 'media-1',
      from: 60,
      durationInFrames: 600,
      sourceStart: 0,
      sourceFps: 30,
      speed: 1,
      ...overrides,
    }
  }

  function makeMixedTrack(items: TimelineItem[]): TimelineTrack {
    return {
      id: 'track-1',
      name: 'Track 1',
      height: 64,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items,
    }
  }

  const resolveComposition =
    (subItems: TimelineItem[], fps = 30) =>
    (id: string) =>
      id === 'sub-1' ? { fps, items: subItems } : null

  it('collects video items inside a compound clip at the mapped sub-comp frame', () => {
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([makeSubVideoItem()]),
      resolveItemSrc: () => 'blob:fresh',
    })

    // relativeFrame 90 -> subCompFrame 90 -> localFrame 30 @30fps = 1.0s
    expect(result.size).toBe(1)
    expect(result.get('blob:fresh')![0]).toBeCloseTo(1.0)
  })

  it('does not gate a compound frame on video from a hidden nested track', () => {
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const hiddenNestedTrack = {
      ...makeMixedTrack([]),
      id: 'sub-track-1',
      visible: false,
    }
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: () => ({
        fps: 30,
        items: [makeSubVideoItem()],
        tracks: [hiddenNestedTrack],
      }),
      resolveItemSrc: () => 'blob:hidden',
    })

    expect(result.size).toBe(0)
  })

  it('registers only solo nested tracks when a compound track is soloed', () => {
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const visibleNonSoloTrack = {
      ...makeMixedTrack([]),
      id: 'sub-track-visible',
      visible: true,
      solo: false,
    }
    const hiddenSoloTrack = {
      ...makeMixedTrack([]),
      id: 'sub-track-solo',
      visible: false,
      solo: true,
    }
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: () => ({
        fps: 30,
        items: [
          makeSubVideoItem({
            id: 'visible-non-solo',
            trackId: 'sub-track-visible',
            src: 'blob:visible',
          }),
          makeSubVideoItem({
            id: 'hidden-solo',
            trackId: 'sub-track-solo',
            src: 'blob:solo',
          }),
        ],
        tracks: [visibleNonSoloTrack, hiddenSoloTrack],
      }),
    })

    expectMapCloseTo(result, new Map([['blob:solo', [1]]]))
  })

  it('collects video through two nested compound clips', () => {
    const outer = makeCompositionItem({ compositionId: 'sub-outer' })
    const nested = makeCompositionItem({
      id: 'nested-comp',
      compositionId: 'sub-inner',
      from: 0,
      durationInFrames: 300,
    })
    const tracks = [makeMixedTrack([outer])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: false,
      resolveComposition: (id) => {
        if (id === 'sub-outer') return { fps: 30, items: [nested] }
        if (id === 'sub-inner') return { fps: 30, items: [makeSubVideoItem()] }
        return null
      },
      resolveItemSrc: () => 'blob:nested-fresh',
    })

    expect(result.get('blob:nested-fresh')![0]).toBeCloseTo(1.0)
  })

  it('propagates an outer wrapper slip through nested compounds exactly once', () => {
    const outer = makeCompositionItem({
      compositionId: 'sub-outer',
      sourceStart: 30,
    })
    const nested = makeCompositionItem({
      id: 'nested-comp',
      compositionId: 'sub-inner',
      from: 0,
      durationInFrames: 300,
      sourceStart: 15,
    })
    const leaf = makeSubVideoItem()
    const tracks = [makeMixedTrack([outer])]
    const collect = (sourceStart: number) =>
      collectVisibleTrackVideoSourceTimesBySrc(
        [makeMixedTrack([{ ...outer, sourceStart }])],
        190,
        30,
        {
          requireExplicitSourceFps: false,
          resolveComposition: (id) => {
            if (id === 'sub-outer') return { fps: 30, items: [nested] }
            if (id === 'sub-inner') return { fps: 30, items: [leaf] }
            return null
          },
          resolveItemSrc: () => 'blob:nested-fresh',
        },
      )

    const beforeSlip = collect(30)
    const afterSlip = collect(42)

    expect(tracks[0]?.items[0]).toMatchObject({ sourceStart: 30 })
    expect(nested).toMatchObject({ sourceStart: 15 })
    expect(leaf).toMatchObject({ sourceStart: 0 })
    expect(beforeSlip.get('blob:nested-fresh')![0]).toBeCloseTo(2.5)
    expect(afterSlip.get('blob:nested-fresh')![0]).toBeCloseTo(2.9)
  })

  it('breaks cyclic compound references without recursing forever', () => {
    const outer = makeCompositionItem({ compositionId: 'sub-cycle' })
    const nestedCycle = makeCompositionItem({
      id: 'nested-cycle',
      compositionId: 'sub-cycle',
      from: 0,
      durationInFrames: 300,
    })

    const result = collectVisibleTrackVideoSourceTimesBySrc([makeMixedTrack([outer])], 190, 30, {
      resolveComposition: () => ({ fps: 30, items: [nestedCycle] }),
    })

    expect(result.size).toBe(0)
  })

  it('skips composition items when no resolver is provided (old behavior)', () => {
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
    })
    expect(result.size).toBe(0)
  })

  it('honors the wrapper trim (sourceStart) when mapping frames', () => {
    const tracks = [makeMixedTrack([makeCompositionItem({ sourceStart: 30 })])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([makeSubVideoItem()]),
      resolveItemSrc: () => 'blob:fresh',
    })

    // subCompFrame 30 + 90 = 120 -> localFrame 60 @30fps = 2.0s
    expect(result.get('blob:fresh')![0]).toBeCloseTo(2.0)
  })

  it('honors wrapper speed when mapping frames', () => {
    const tracks = [makeMixedTrack([makeCompositionItem({ speed: 2 })])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([makeSubVideoItem()]),
      resolveItemSrc: () => 'blob:fresh',
    })

    // subCompFrame 180 -> localFrame 120 @30fps = 4.0s
    expect(result.get('blob:fresh')![0]).toBeCloseTo(4.0)
  })

  it('maps into a sub-comp running at a different fps than the parent', () => {
    const subItem = makeSubVideoItem({ sourceFps: 60 })
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([subItem], 60),
      resolveItemSrc: () => 'blob:fresh',
    })

    // 90 parent frames @30fps = 3s -> subCompFrame 180 @60fps -> localFrame 120 = 2.0s
    expect(result.get('blob:fresh')![0]).toBeCloseTo(2.0)
  })

  it('ignores frames outside the compound clip window', () => {
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const options = {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([makeSubVideoItem()]),
      resolveItemSrc: () => 'blob:fresh',
    }
    expect(collectVisibleTrackVideoSourceTimesBySrc(tracks, 99, 30, options).size).toBe(0)
    expect(collectVisibleTrackVideoSourceTimesBySrc(tracks, 400, 30, options).size).toBe(0)
  })

  it('falls back to the stored sub-item src when no src resolver is given', () => {
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([makeSubVideoItem()]),
    })
    expect([...result.keys()]).toEqual(['blob:stale'])
  })

  it('skips sub items without explicit sourceFps when required', () => {
    const subItem = makeSubVideoItem({ sourceFps: undefined })
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: true,
      resolveComposition: resolveComposition([subItem]),
      resolveItemSrc: () => 'blob:fresh',
    })
    expect(result.size).toBe(0)
  })

  it('uses the compound fps for held scrubs when legacy sub-items omit sourceFps', () => {
    const subItem = makeSubVideoItem({ sourceFps: undefined })
    const tracks = [makeMixedTrack([makeCompositionItem()])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 190, 30, {
      requireExplicitSourceFps: false,
      resolveComposition: resolveComposition([subItem]),
      resolveItemSrc: () => 'blob:fresh',
    })

    expect(result.get('blob:fresh')![0]).toBeCloseTo(1.0)
  })

  it('resolves direct video items with empty stored src by mediaId', () => {
    const direct = makeSubVideoItem({ id: 'direct-1', src: '', from: 150, durationInFrames: 90 })
    const tracks = [makeMixedTrack([direct])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 180, 30, {
      requireExplicitSourceFps: true,
      resolveItemSrc: (item) => (item.mediaId === 'media-1' ? 'blob:fresh' : null),
    })

    // localFrame 30 @30fps = 1.0s
    expect(result.size).toBe(1)
    expect(result.get('blob:fresh')![0]).toBeCloseTo(1.0)
  })

  it('still skips direct video items with no stored src and no resolver', () => {
    const direct = makeSubVideoItem({ id: 'direct-1', src: '', from: 150, durationInFrames: 90 })
    const tracks = [makeMixedTrack([direct])]
    const result = collectVisibleTrackVideoSourceTimesBySrc(tracks, 180, 30, {
      requireExplicitSourceFps: true,
    })
    expect(result.size).toBe(0)
  })

  it('maps timeline frames to sub-comp frames at window boundaries', () => {
    const item = makeCompositionItem()
    expect(mapTimelineFrameToSubCompositionFrame(item, 100, 30, 30)).toBe(0)
    expect(mapTimelineFrameToSubCompositionFrame(item, 399, 30, 30)).toBe(299)
    expect(mapTimelineFrameToSubCompositionFrame(item, 99, 30, 30)).toBeNull()
    expect(mapTimelineFrameToSubCompositionFrame(item, 400, 30, 30)).toBeNull()
  })
})
