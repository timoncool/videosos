// @vitest-environment node

import { describe, it, expect } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import type { ClientExportSettings } from './client-renderer'
import {
  clipBlocksRemux,
  getPacketRemuxPlan,
  isIdentityTransform,
  isRemuxEligibleComposition,
  resolveRemuxTrimBounds,
} from './packet-remux-plan'

const FPS = 30
const DURATION = 300

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    type: 'video',
    src: 'workspace://media/clip.mp4',
    label: 'clip',
    from: 0,
    durationInFrames: DURATION,
    ...overrides,
  }
}

function makeTrack(
  overrides: Partial<TimelineTrack> = {},
  items = [makeVideoItem()],
): TimelineTrack {
  return {
    id: 'track-1',
    name: 'V1',
    height: 60,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
    ...overrides,
  }
}

function makeComposition(overrides: Partial<CompositionInputProps> = {}): CompositionInputProps {
  return {
    fps: FPS,
    width: 1920,
    height: 1080,
    durationInFrames: DURATION,
    tracks: [makeTrack()],
    transitions: [],
    keyframes: [],
    ...overrides,
  } as CompositionInputProps
}

function makeSettings(overrides: Partial<ClientExportSettings> = {}): ClientExportSettings {
  return {
    mode: 'video',
    codec: 'avc',
    container: 'mp4',
    quality: 'high',
    resolution: { width: 1920, height: 1080 },
    fps: FPS,
    ...overrides,
  } as ClientExportSettings
}

describe('getPacketRemuxPlan', () => {
  it('plans a remux for a single untouched full-length clip', () => {
    const plan = getPacketRemuxPlan(makeSettings(), makeComposition())
    expect(plan).toEqual({
      src: 'workspace://media/clip.mp4',
      trimStartSeconds: 0,
      trimEndSeconds: DURATION / FPS,
      includeAudio: true,
    })
  })

  it('excludes audio when the track is muted', () => {
    const composition = makeComposition({ tracks: [makeTrack({ muted: true })] })
    expect(getPacketRemuxPlan(makeSettings(), composition)?.includeAudio).toBe(false)
  })

  it('ignores hidden tracks and empty/zero-duration items when counting clips', () => {
    const composition = makeComposition({
      tracks: [
        makeTrack(),
        makeTrack({ id: 'track-2', visible: false }, [
          makeVideoItem({ id: 'hidden-clip', trackId: 'track-2' }),
        ]),
        makeTrack({ id: 'track-3' }, [
          makeVideoItem({ id: 'empty-clip', trackId: 'track-3', durationInFrames: 0 }),
        ]),
      ],
    })
    expect(getPacketRemuxPlan(makeSettings(), composition)).not.toBeNull()
  })

  interface RejectionCase {
    name: string
    settings?: Partial<ClientExportSettings>
    composition?: Partial<CompositionInputProps>
    item?: Partial<VideoItem>
    track?: Partial<TimelineTrack>
  }

  const rejectionCases: RejectionCase[] = [
    { name: 'non-video export mode', settings: { mode: 'audio' as ClientExportSettings['mode'] } },
    { name: 'zero composition duration', composition: { durationInFrames: 0 } },
    { name: 'missing composition duration', composition: { durationInFrames: undefined } },
    {
      name: 'transitions present',
      composition: { transitions: [{ id: 't1' }] as CompositionInputProps['transitions'] },
    },
    {
      name: 'keyframes present',
      composition: { keyframes: [{ itemId: 'clip-1' }] as CompositionInputProps['keyframes'] },
    },
    { name: 'no visible tracks', composition: { tracks: [makeTrack({ visible: false })] } },
    {
      name: 'more than one clip',
      composition: {
        tracks: [makeTrack({}, [makeVideoItem(), makeVideoItem({ id: 'clip-2', from: DURATION })])],
      },
    },
    { name: 'clip missing src', item: { src: '' } },
    { name: 'reversed clip', item: { isReversed: true } },
    { name: 'clip not starting at frame 0', item: { from: 10 } },
    { name: 'clip shorter than the composition', item: { durationInFrames: DURATION - 1 } },
    {
      name: 'clip with effects',
      item: { effects: [{ id: 'fx' }] as VideoItem['effects'] },
    },
    { name: 'non-identity transform', item: { transform: { x: 25 } } },
    { name: 'speed ramp', item: { speed: 1.5 } },
    { name: 'visual fade in', item: { fadeIn: 0.5 } },
    { name: 'visual fade out', item: { fadeOut: 0.5 } },
    { name: 'volume adjustment with audible track', item: { volume: -6 } },
    { name: 'audio fade with audible track', item: { audioFadeIn: 0.3 } },
    { name: 'trimmed-from-middle clip (sourceStart)', item: { sourceStart: 12 } },
    { name: 'trimmed-from-middle clip (trimStart)', item: { trimStart: 12 } },
    { name: 'trimmed-from-middle clip (offset)', item: { offset: 12 } },
    { name: 'invalid source fps', item: { sourceFps: 0 } },
    { name: 'export fps differing from composition fps', settings: { fps: 60 } },
  ]

  it.each(rejectionCases)('rejects: $name', ({ settings, composition, item, track }) => {
    const built = makeComposition({
      tracks: [makeTrack(track ?? {}, [makeVideoItem(item ?? {})])],
      ...composition,
    })
    expect(getPacketRemuxPlan(makeSettings(settings ?? {}), built)).toBeNull()
  })

  it('allows audio adjustments when the track is muted anyway', () => {
    const composition = makeComposition({
      tracks: [makeTrack({ muted: true }, [makeVideoItem({ volume: -6, audioFadeOut: 0.4 })])],
    })
    const plan = getPacketRemuxPlan(makeSettings(), composition)
    expect(plan).not.toBeNull()
    expect(plan?.includeAudio).toBe(false)
  })

  it('computes trim bounds from source fps when it differs from project fps', () => {
    // sourceStart 0 keeps eligibility; duration is measured in project fps.
    const composition = makeComposition({
      tracks: [makeTrack({}, [makeVideoItem({ sourceFps: 24 })])],
    })
    const plan = getPacketRemuxPlan(makeSettings(), composition)
    expect(plan?.trimStartSeconds).toBe(0)
    expect(plan?.trimEndSeconds).toBeCloseTo(DURATION / FPS, 10)
  })
})

describe('isRemuxEligibleComposition', () => {
  it.each([
    { name: 'video export of an animation-free composition', changes: {}, expected: true },
    { name: 'audio export mode', changes: { mode: 'audio' }, expected: false },
    { name: 'zero duration', changes: { durationInFrames: 0 }, expected: false },
    { name: 'transitions', changes: { transitions: [{ id: 't1' }] }, expected: false },
    { name: 'keyframes', changes: { keyframes: [{ itemId: 'clip-1' }] }, expected: false },
  ])('$name -> $expected', ({ changes, expected }) => {
    const { mode, ...compositionChanges } = changes as { mode?: string } & Record<string, unknown>
    expect(
      isRemuxEligibleComposition(
        makeSettings((mode ? { mode } : {}) as Partial<ClientExportSettings>),
        makeComposition(compositionChanges as Partial<CompositionInputProps>),
      ),
    ).toBe(expected)
  })
})

describe('clipBlocksRemux', () => {
  it('passes an untouched full-length clip', () => {
    expect(clipBlocksRemux(makeVideoItem(), makeComposition())).toBe(false)
  })

  it.each([
    { name: 'missing src', item: { src: '' } },
    { name: 'reversed playback', item: { isReversed: true } },
    { name: 'delayed start', item: { from: 1 } },
    { name: 'shorter than composition', item: { durationInFrames: DURATION - 1 } },
    { name: 'effects', item: { effects: [{ id: 'fx' }] as VideoItem['effects'] } },
    { name: 'transform', item: { transform: { rotation: 45 } } },
    { name: 'speed change', item: { speed: 2 } },
    { name: 'visual fades', item: { fadeIn: 0.2 } },
  ])('blocks on $name', ({ item }) => {
    expect(clipBlocksRemux(makeVideoItem(item), makeComposition())).toBe(true)
  })
})

describe('resolveRemuxTrimBounds', () => {
  it('maps a full-length clip to [0, duration] seconds', () => {
    expect(resolveRemuxTrimBounds(makeVideoItem(), makeComposition(), makeSettings())).toEqual({
      trimStartSeconds: 0,
      trimEndSeconds: 10,
    })
  })

  it.each([
    { name: 'non-finite source fps', item: { sourceFps: Number.NaN }, settings: {} },
    { name: 'negative source fps', item: { sourceFps: -30 }, settings: {} },
    { name: 'export fps mismatch', item: {}, settings: { fps: 25 } },
    { name: 'clip trimmed from the middle', item: { sourceStart: 5 }, settings: {} },
  ])('returns null for $name', ({ item, settings }) => {
    expect(
      resolveRemuxTrimBounds(makeVideoItem(item), makeComposition(), makeSettings(settings)),
    ).toBeNull()
  })
})

describe('isIdentityTransform', () => {
  it('accepts a clip with no transform and no crop', () => {
    expect(isIdentityTransform(makeVideoItem())).toBe(true)
  })

  it('accepts sub-epsilon offsets and full opacity', () => {
    expect(
      isIdentityTransform(
        makeVideoItem({ transform: { x: 1e-9, y: -1e-9, rotation: 0, opacity: 1 } }),
      ),
    ).toBe(true)
  })

  const nonIdentity: Array<{ name: string; item: VideoItem }> = [
    { name: 'crop', item: makeVideoItem({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }) },
    { name: 'explicit width', item: makeVideoItem({ transform: { width: 1280 } }) },
    { name: 'explicit height', item: makeVideoItem({ transform: { height: 720 } }) },
    { name: 'x offset', item: makeVideoItem({ transform: { x: 4 } }) },
    { name: 'y offset', item: makeVideoItem({ transform: { y: -4 } }) },
    { name: 'rotation', item: makeVideoItem({ transform: { rotation: 90 } }) },
    { name: 'corner radius', item: makeVideoItem({ transform: { cornerRadius: 8 } }) },
    { name: 'reduced opacity', item: makeVideoItem({ transform: { opacity: 0.5 } }) },
  ]

  it.each(nonIdentity)('rejects $name', ({ item }) => {
    expect(isIdentityTransform(item)).toBe(false)
  })
})
