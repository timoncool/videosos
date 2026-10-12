import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Clock } from './Clock'

describe('Clock playback timing', () => {
  let nowMs = 0
  let nextRafId = 1
  let rafCallbacks = new Map<number, FrameRequestCallback>()

  const runNextAnimationFrame = (nextNowMs: number) => {
    const [id, callback] = rafCallbacks.entries().next().value as [number, FrameRequestCallback]
    rafCallbacks.delete(id)
    nowMs = nextNowMs
    callback(nextNowMs)
  }

  beforeEach(() => {
    nowMs = 0
    nextRafId = 1
    rafCallbacks = new Map<number, FrameRequestCallback>()

    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      const id = nextRafId++
      rafCallbacks.set(id, callback)
      return id
    }) as typeof requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => {
      rafCallbacks.delete(id)
    }) as typeof cancelAnimationFrame)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
  })

  it('keeps advancing with elapsed time while the tab is hidden', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    clock.play()
    expect(rafCallbacks.size).toBe(1)

    runNextAnimationFrame(1000)
    expect(clock.currentFrame).toBe(30)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    runNextAnimationFrame(2000)
    expect(clock.currentFrame).toBe(60)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })

    runNextAnimationFrame(2500)
    expect(clock.currentFrame).toBe(75)

    clock.dispose()
  })

  it('advances reverse shuttle at display cadence while skipping intermediate frames', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
      initialFrame: 120,
    })
    clock.playbackRate = -2

    clock.play()
    runNextAnimationFrame(500)

    expect(clock.currentFrame).toBe(90)
    clock.dispose()
  })

  it('restarts reverse playback from the last frame only at the first boundary', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
      initialFrame: 0,
    })
    clock.playbackRate = -1

    clock.play()

    expect(clock.currentFrame).toBe(299)
    clock.dispose()
  })

  it('catches up immediately when window focus returns before the next RAF', () => {
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    clock.play()
    expect(rafCallbacks.size).toBe(1)

    runNextAnimationFrame(1000)
    expect(clock.currentFrame).toBe(30)

    nowMs = 2500
    window.dispatchEvent(new Event('focus'))
    expect(clock.currentFrame).toBe(75)

    clock.dispose()
  })

  it('keeps advancing when a suspended audio clock resumes after play starts', () => {
    let audioState: AudioContextState = 'suspended'
    let audioTime = 40
    const audioContext = {
      get state() {
        return audioState
      },
      get currentTime() {
        return audioTime
      },
    } as unknown as AudioContext
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    nowMs = 1_000_000
    clock.setAudioContext(audioContext)
    clock.play()
    runNextAnimationFrame(1_000_016)

    audioState = 'running'
    audioTime = 40.02
    runNextAnimationFrame(1_000_032)
    expect(clock.currentFrame).toBeGreaterThanOrEqual(0)

    audioTime = 40.52
    runNextAnimationFrame(1_000_532)
    expect(clock.currentFrame).toBe(15)

    clock.dispose()
  })

  it('keeps advancing when the audio clock suspends during playback', () => {
    let audioState: AudioContextState = 'running'
    let audioTime = 25
    const audioContext = {
      get state() {
        return audioState
      },
      get currentTime() {
        return audioTime
      },
    } as unknown as AudioContext
    const clock = new Clock({
      fps: 30,
      durationInFrames: 300,
    })

    clock.setAudioContext(audioContext)
    clock.play()
    audioTime = 25.5
    runNextAnimationFrame(500)
    expect(clock.currentFrame).toBe(15)

    audioState = 'suspended'
    runNextAnimationFrame(1_000_000)
    expect(clock.currentFrame).toBe(15)

    runNextAnimationFrame(1_000_500)
    expect(clock.currentFrame).toBe(30)

    clock.dispose()
  })
})
