import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { AudioItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  createLatestOnlyAsyncFrameRunner,
  createTimelineMediaElementAudioSkimPreview,
  getTimelineAudioSkimTimeSeconds,
  selectTimelineSkimSourceAtFrame,
  type CompositionLookup,
} from './timeline-audio-skim'

describe('createLatestOnlyAsyncFrameRunner', () => {
  it('drops obsolete queued targets while an asynchronous seek is settling', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const run = vi
      .fn<(frame: number) => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined)
    const runner = createLatestOnlyAsyncFrameRunner(run)

    runner.schedule(10)
    runner.schedule(20)
    runner.schedule(30)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith(10)

    releaseFirst?.()
    await first
    await Promise.resolve()
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith(30)
  })

  it('can discard a queued target without interrupting the active request', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const run = vi.fn<(frame: number) => Promise<void>>().mockImplementation(() => first)
    const runner = createLatestOnlyAsyncFrameRunner(run)

    runner.schedule(10)
    runner.schedule(20)
    runner.cancelPending()
    releaseFirst?.()
    await first
    await Promise.resolve()
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(1)
  })
})

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-audio-1',
    from: 30,
    durationInFrames: 90,
    label: 'audio.wav',
    src: 'blob:audio',
    mediaId: 'media-audio-1',
    sourceStart: 60,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  }
}

describe('getTimelineAudioSkimTimeSeconds', () => {
  it('maps a hovered timeline frame into trimmed source time', () => {
    expect(getTimelineAudioSkimTimeSeconds(makeAudioItem(), 60, 30, 10)).toBe(3)
  })

  it('accounts for speed and source fps', () => {
    expect(
      getTimelineAudioSkimTimeSeconds(
        makeAudioItem({ sourceStart: 48, sourceFps: 48, speed: 2 }),
        45,
        24,
        10,
      ),
    ).toBe(2.25)
  })

  it('maps reversed clips from source end toward source start', () => {
    expect(
      getTimelineAudioSkimTimeSeconds(
        makeAudioItem({ isReversed: true, sourceStart: 30, sourceEnd: 120 }),
        30,
        30,
        10,
      ),
    ).toBeCloseTo(119 / 30)
  })
})

function makeTrack(id: string, overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id,
    name: id,
    order: 0,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    isGroup: false,
    ...overrides,
  } as unknown as TimelineTrack
}

describe('selectTimelineSkimSourceAtFrame', () => {
  const duration = () => 100

  it('prefers an audible audio clip over a video clip under the frame', () => {
    const video = {
      id: 'v',
      type: 'video',
      trackId: 'V',
      from: 0,
      durationInFrames: 100,
      mediaId: 'media-v',
      sourceStart: 0,
      sourceFps: 30,
    } as unknown as TimelineItem
    const audio = makeAudioItem({ id: 'a', trackId: 'A', from: 0, sourceStart: 0 })
    const tracks = [makeTrack('V', { order: 1 }), makeTrack('A', { order: 2 })]

    const source = selectTimelineSkimSourceAtFrame(50, [video, audio], tracks, 30, duration)
    expect(source?.item.id).toBe('a')
  })

  it('ignores clips on a muted track', () => {
    const audio = makeAudioItem({ id: 'a', trackId: 'A', from: 0, sourceStart: 0 })
    const tracks = [makeTrack('A', { muted: true })]
    expect(selectTimelineSkimSourceAtFrame(50, [audio], tracks, 30, duration)).toBeNull()
  })

  it('recurses into a compound clip to reach the inner media leaf', () => {
    // Outer compound member: audio with a compositionId but no media of its own.
    const compoundAudio = {
      id: 'compound',
      type: 'audio',
      trackId: 'A',
      from: 0,
      durationInFrames: 90,
      compositionId: 'comp-1',
      sourceStart: 0,
      sourceFps: 30,
      speed: 1,
    } as unknown as TimelineItem
    const outerTracks = [makeTrack('A')]

    const innerAudio = makeAudioItem({
      id: 'inner',
      trackId: 'inner-track',
      from: 0,
      durationInFrames: 90,
      mediaId: 'inner-media',
      sourceStart: 0,
    })
    const composition: CompositionLookup = {
      items: [innerAudio],
      tracks: [makeTrack('inner-track')],
      fps: 30,
    }

    const source = selectTimelineSkimSourceAtFrame(
      30,
      [compoundAudio],
      outerTracks,
      30,
      duration,
      (id) => (id === 'comp-1' ? composition : undefined),
    )
    expect(source?.item.id).toBe('inner')
    expect(source?.item.mediaId).toBe('inner-media')
  })

  it('returns null for a compound clip when no resolver is provided', () => {
    const compoundAudio = {
      id: 'compound',
      type: 'audio',
      trackId: 'A',
      from: 0,
      durationInFrames: 90,
      compositionId: 'comp-1',
    } as unknown as TimelineItem
    expect(
      selectTimelineSkimSourceAtFrame(30, [compoundAudio], [makeTrack('A')], 30, duration),
    ).toBeNull()
  })
})

describe('createTimelineMediaElementAudioSkimPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('seeks and briefly plays a media element at the requested skim time', async () => {
    const video = document.createElement('video')
    const play = vi.fn(async () => {})
    const pause = vi.fn()
    const load = vi.fn()
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 })
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    })
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    Object.defineProperty(video, 'pause', { configurable: true, value: pause })
    Object.defineProperty(video, 'load', { configurable: true, value: load })

    const preview = createTimelineMediaElementAudioSkimPreview({
      createVideoElement: () => video,
      grainDurationSeconds: 0.08,
    })

    const scrubPromise = preview.scrub({
      mediaKind: 'video',
      mediaUrl: 'blob:video-with-audio',
      timeSeconds: 4,
    })
    await vi.advanceTimersByTimeAsync(120)
    await scrubPromise

    expect(video.src).toBe('blob:video-with-audio')
    expect(video.currentTime).toBe(4)
    expect(play).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(80)
    expect(pause).toHaveBeenCalled()
  })
})
