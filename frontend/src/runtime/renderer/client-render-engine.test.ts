import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { SubCompRenderData } from './canvas-item-renderer'
import {
  buildSubCompositionRenderTracks,
  collectPriorityMediaItemIds,
  collectPriorityMediaItemIdsForFrames,
  collectPriorityNestedVideoItemIds,
  getPreviewVideoSourceCandidates,
  resolveCompositionRendererExecutionPolicy,
  resolveRenderedFrameCacheMode,
  resolveWorkerPredecodeWaitMs,
  resolveVideoPreloadPlan,
  selectNestedMediaSource,
  selectRendererPreloadItems,
  selectPreviewVideoSource,
  subCompositionRenderDataHasGpuEffects,
} from './client-render-engine'

describe('nested transcript captions', () => {
  it('adds a virtual transcript track when a clip inside a compound has captions enabled', () => {
    const video = {
      id: 'nested-video',
      type: 'video',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 90,
      label: 'Nested video',
      mediaId: 'media-1',
      src: 'blob:nested',
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
      transcriptCaptions: {
        type: 'transcript',
        mediaId: 'media-1',
        enabled: true,
        updatedAt: 20,
        cues: [
          {
            id: 'transcript-media-1-0',
            startSeconds: 0.2,
            endSeconds: 1.4,
            text: 'Nested phrase',
          },
        ],
      },
    } satisfies TimelineItem
    const tracks = buildSubCompositionRenderTracks({
      fps: 30,
      width: 1920,
      height: 1080,
      items: [video],
      tracks: [
        {
          id: 'video-track',
          name: 'Video',
          order: 1,
          height: 64,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          items: [],
        },
      ],
    })

    expect(tracks).toHaveLength(2)
    const transcriptTrack = tracks.find((track) =>
      track.items.some((item) => item.type === 'subtitle'),
    )
    expect(transcriptTrack?.items).toEqual([
      expect.objectContaining({
        type: 'subtitle',
        source: expect.objectContaining({
          type: 'transcript',
          mediaId: 'media-1',
          clipId: 'nested-video',
        }),
        cues: [expect.objectContaining({ text: 'Nested phrase' })],
      }),
    ])
  })

  it('uses the shared solo semantics for compound render tracks', () => {
    const makeTrack = ({
      id,
      visible,
      solo,
      order,
    }: {
      id: string
      visible: boolean
      solo: boolean
      order: number
    }) => ({
      id,
      name: id,
      order,
      height: 64,
      locked: false,
      visible,
      muted: false,
      solo,
      items: [],
    })
    const tracks = buildSubCompositionRenderTracks({
      fps: 30,
      width: 1920,
      height: 1080,
      items: [],
      tracks: [
        makeTrack({ id: 'visible-non-solo', visible: true, solo: false, order: 1 }),
        makeTrack({ id: 'hidden-solo', visible: false, solo: true, order: 2 }),
      ],
    })

    expect(tracks).toEqual([
      expect.objectContaining({ order: 2, visible: true }),
      expect.objectContaining({ order: 1, visible: false }),
    ])
  })
})

describe('comparison preview resource selection', () => {
  it('uses nested proxy media for preview consumers and source media otherwise', () => {
    expect(
      selectNestedMediaSource({
        useProxyMedia: true,
        proxyUrl: 'blob:proxy',
        sourceUrl: 'blob:source',
      }),
    ).toBe('blob:proxy')
    expect(
      selectNestedMediaSource({
        useProxyMedia: false,
        proxyUrl: 'blob:proxy',
        sourceUrl: 'blob:source',
      }),
    ).toBe('blob:source')
  })

  it('keeps comparison drawing isolated while enabling lazy worker-backed frames', () => {
    expect(resolveCompositionRendererExecutionPolicy('comparison')).toEqual({
      itemRenderMode: 'export',
      usesSharedPreviewPool: false,
      usesStrictPreviewDecode: false,
      allowsPredecodedVideoFrames: true,
    })
  })

  it('keeps only exact target dependencies in comparison preload batches', () => {
    const items = [{ id: 'target' }, { id: 'future' }]
    expect(
      selectRendererPreloadItems('comparison', items, new Set(['target']), (item) => item.id),
    ).toEqual([{ id: 'target' }])
    expect(
      selectRendererPreloadItems('export', items, new Set(['target']), (item) => item.id),
    ).toEqual(items)
  })

  it('unions exact dependencies for every sibling comparison frame', () => {
    const firstVideo = {
      id: 'first-video',
      type: 'video',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
    } as TimelineItem
    const secondImage = {
      id: 'second-image',
      type: 'image',
      trackId: 'track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem

    expect(
      collectPriorityMediaItemIdsForFrames({
        tracks: [
          {
            id: 'track',
            name: 'Track',
            order: 0,
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [firstVideo, secondImage],
          },
        ],
        frames: [5, 15],
        fps: 30,
        compositionById: {},
      }),
    ).toEqual({
      video: ['first-video'],
      image: ['second-image'],
      lottie: [],
    })
  })
})

describe('collectPriorityNestedVideoItemIds', () => {
  it('initializes only video leaves visible at the mapped nested frame', () => {
    const rootWrapper = {
      id: 'root-wrapper',
      type: 'composition',
      trackId: 'root-track',
      from: 0,
      durationInFrames: 60,
      compositionId: 'outer',
      sourceStart: 10,
      sourceFps: 60,
      speed: 2,
    } as TimelineItem
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      trackId: 'outer-track',
      from: 20,
      durationInFrames: 60,
      compositionId: 'inner',
      sourceStart: 5,
      sourceFps: 30,
      speed: 1,
    } as TimelineItem
    const visibleVideo = {
      id: 'visible-video',
      type: 'video',
      trackId: 'inner-track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem
    const deferredVideo = {
      id: 'deferred-video',
      type: 'video',
      trackId: 'inner-track',
      from: 20,
      durationInFrames: 10,
    } as TimelineItem
    const hiddenVideo = {
      id: 'hidden-video',
      type: 'video',
      trackId: 'hidden-track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem

    expect(
      collectPriorityNestedVideoItemIds({
        tracks: [
          {
            id: 'root-track',
            name: 'Root',
            order: 0,
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [rootWrapper],
          },
        ],
        frame: 5,
        fps: 30,
        compositionById: {
          outer: {
            id: 'outer',
            name: 'Outer',
            fps: 60,
            width: 1920,
            height: 1080,
            durationInFrames: 120,
            items: [nestedWrapper],
            tracks: [
              {
                id: 'outer-track',
                name: 'Outer track',
                order: 0,
                height: 60,
                locked: false,
                visible: true,
                muted: false,
                solo: false,
                items: [nestedWrapper],
              },
            ],
            transitions: [],
            keyframes: [],
          },
          inner: {
            id: 'inner',
            name: 'Inner',
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 60,
            items: [visibleVideo, deferredVideo, hiddenVideo],
            tracks: [
              {
                id: 'inner-track',
                name: 'Visible',
                order: 0,
                height: 60,
                locked: false,
                visible: true,
                muted: false,
                solo: false,
                items: [visibleVideo, deferredVideo],
              },
              {
                id: 'hidden-track',
                name: 'Hidden',
                order: 1,
                height: 60,
                locked: false,
                visible: false,
                muted: false,
                solo: false,
                items: [hiddenVideo],
              },
            ],
            transitions: [],
            keyframes: [],
          },
        },
      }),
    ).toEqual(['visible-video'])
  })

  it('collects exact-frame image and Lottie leaves without unrelated media', () => {
    const visibleImage = {
      id: 'visible-image',
      type: 'image',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
    } as TimelineItem
    const visibleLottie = {
      id: 'visible-lottie',
      type: 'lottie',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
    } as TimelineItem
    const futureVideo = {
      id: 'future-video',
      type: 'video',
      trackId: 'track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem

    expect(
      collectPriorityMediaItemIds({
        tracks: [
          {
            id: 'track',
            name: 'Track',
            order: 0,
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [visibleImage, visibleLottie, futureVideo],
          },
        ],
        frame: 5,
        fps: 30,
        compositionById: {},
      }),
    ).toEqual({ video: [], image: ['visible-image'], lottie: ['visible-lottie'] })
  })
})

describe('selectPreviewVideoSource', () => {
  it('prioritizes the canonical original URL and excludes proxies when source media is selected', () => {
    expect(
      getPreviewVideoSourceCandidates({
        itemSource: 'blob:source',
        proxySource: 'blob:proxy',
        registeredSource: 'blob:registered-source',
        cachedSource: 'blob:cached-source',
        useProxyMedia: false,
      }),
    ).toEqual(['blob:cached-source', 'blob:registered-source', 'blob:source'])
  })

  it('drops a stale proxy item source when proxy playback is disabled', () => {
    expect(
      getPreviewVideoSourceCandidates({
        itemSource: 'blob:proxy',
        proxySource: 'blob:proxy',
        registeredSource: 'blob:proxy',
        cachedSource: 'blob:original',
        useProxyMedia: false,
      }),
    ).toEqual(['blob:original', null, null])
  })

  it('includes cached proxies when proxy media is selected', () => {
    expect(
      getPreviewVideoSourceCandidates({
        itemSource: 'blob:proxy',
        proxySource: 'blob:proxy',
        registeredSource: 'blob:registered-proxy',
        cachedSource: 'blob:source',
        useProxyMedia: true,
      }),
    ).toEqual(['blob:proxy', 'blob:proxy', 'blob:registered-proxy', 'blob:source'])
  })

  it('selects the cached proxy when a compound item still carries its original source', () => {
    const proxyBitmap = {} as ImageBitmap
    expect(
      selectPreviewVideoSource({
        candidates: ['blob:stored-original', 'blob:scrub-proxy'],
        sourceTime: 42,
        toleranceSeconds: 0.01,
        getCachedPredecodedBitmap: (src) => (src === 'blob:scrub-proxy' ? proxyBitmap : null),
      }),
    ).toBe('blob:scrub-proxy')
  })

  it('preserves composition source order when no scrub bitmap is cached', () => {
    expect(
      selectPreviewVideoSource({
        candidates: ['blob:composition-source', 'blob:registered-source'],
      }),
    ).toBe('blob:composition-source')
  })

  it('selects the scheduled compound proxy before its first bitmap arrives', () => {
    expect(
      selectPreviewVideoSource({
        candidates: ['blob:stored-original', 'blob:scrub-proxy'],
        sourceTime: 42,
        toleranceSeconds: 0.01,
        isActivePreviewSourceTarget: (src) => src === 'blob:scrub-proxy',
      }),
    ).toBe('blob:scrub-proxy')
  })
})

describe('resolveVideoPreloadPlan', () => {
  it('defers every non-priority source in preview mode', () => {
    expect(
      resolveVideoPreloadPlan('preview', ['active', 'nearby', 'far', 'far'], ['active', 'nearby']),
    ).toEqual({
      priorityItemIds: ['active', 'nearby'],
      eagerItemIds: [],
      deferredItemIds: ['far'],
    })
  })

  it('keeps export eager after initializing its priority sources first', () => {
    expect(resolveVideoPreloadPlan('export', ['active', 'nearby', 'far'], ['nearby'])).toEqual({
      priorityItemIds: ['nearby'],
      eagerItemIds: ['active', 'far'],
      deferredItemIds: [],
    })
  })

  it('keeps comparison sources isolated but defers every non-target decoder', () => {
    expect(resolveVideoPreloadPlan('comparison', ['target', 'future'], ['target'])).toEqual({
      priorityItemIds: ['target'],
      eagerItemIds: [],
      deferredItemIds: ['future'],
    })
  })
})

describe('resolveRenderedFrameCacheMode', () => {
  it('seeds the cache, keeps nearby scrub frames, and skips isolated overview seeks', () => {
    expect(resolveRenderedFrameCacheMode({ previousFrame: null, frame: 9000, fps: 30 })).toBe(
      'full',
    )
    expect(resolveRenderedFrameCacheMode({ previousFrame: 9000, frame: 8992, fps: 30 })).toBe(
      'full',
    )
    expect(resolveRenderedFrameCacheMode({ previousFrame: 9000, frame: 12000, fps: 30 })).toBe(
      'skip',
    )
  })

  it('uses only the GPU tier for sequential forward frames', () => {
    expect(resolveRenderedFrameCacheMode({ previousFrame: 100, frame: 101, fps: 30 })).toBe(
      'gpu-only',
    )
  })
})

describe('resolveWorkerPredecodeWaitMs', () => {
  it('does not let an isolated comparison frame hold the shared render queue', () => {
    expect(resolveWorkerPredecodeWaitMs('comparison', 'skip')).toBeUndefined()
    expect(resolveWorkerPredecodeWaitMs('preview', 'skip')).toBe(900)
    expect(resolveWorkerPredecodeWaitMs('export', 'full')).toBeUndefined()
  })
})

function makeSubCompData(items: TimelineItem[]): SubCompRenderData {
  return {
    fps: 30,
    durationInFrames: 90,
    sortedTracks: [{ order: 0, visible: true, items }],
    keyframesMap: new Map(),
    adjustmentLayers: [],
  }
}

describe('subCompositionRenderDataHasGpuEffects', () => {
  it('detects GPU effects inside nested compound clips', () => {
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      compositionId: 'inner-comp',
    } as TimelineItem
    const innerVideo = {
      id: 'inner-video',
      type: 'video',
      effects: [
        {
          id: 'dither',
          enabled: true,
          effect: { type: 'gpu-effect', gpuEffectType: 'gpu-dither', params: {} },
        },
      ],
    } as TimelineItem
    const subCompRenderData = new Map<string, SubCompRenderData>([
      ['outer-comp', makeSubCompData([nestedWrapper])],
      ['inner-comp', makeSubCompData([innerVideo])],
    ])

    expect(subCompositionRenderDataHasGpuEffects('outer-comp', subCompRenderData)).toBe(true)
  })

  it('uses preview effect overrides while checking nested compounds', () => {
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      compositionId: 'inner-comp',
    } as TimelineItem
    const innerVideo = {
      id: 'inner-video',
      type: 'video',
      effects: [],
    } as unknown as TimelineItem
    const subCompRenderData = new Map<string, SubCompRenderData>([
      ['outer-comp', makeSubCompData([nestedWrapper])],
      ['inner-comp', makeSubCompData([innerVideo])],
    ])

    expect(
      subCompositionRenderDataHasGpuEffects('outer-comp', subCompRenderData, {
        getPreviewEffectsOverride: (itemId) =>
          itemId === 'inner-video'
            ? [
                {
                  id: 'preview-dither',
                  enabled: true,
                  effect: { type: 'gpu-effect', gpuEffectType: 'gpu-dither', params: {} },
                },
              ]
            : undefined,
      }),
    ).toBe(true)
  })
})
