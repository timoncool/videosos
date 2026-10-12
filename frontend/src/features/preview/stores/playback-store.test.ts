import { describe, expect, it, beforeEach } from 'vite-plus/test'
import { usePlaybackStore } from './playback-store'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'

describe('playback-store', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 0,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      playbackScrubResumeTransport: null,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1,
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1,
    })
    usePreviewBridgeStore.setState({
      displayedFrame: null,
      captureFrame: null,
      captureFrameImageData: null,
      captureCanvasSource: null,
    })
  })

  describe('frame navigation', () => {
    it('sets current frame', () => {
      usePlaybackStore.getState().setCurrentFrame(100)
      expect(usePlaybackStore.getState().currentFrame).toBe(100)
    })

    it('normalizes negative frames to 0', () => {
      usePlaybackStore.getState().setCurrentFrame(-10)
      expect(usePlaybackStore.getState().currentFrame).toBe(0)
    })

    it('rounds fractional frames', () => {
      usePlaybackStore.getState().setCurrentFrame(10.7)
      expect(usePlaybackStore.getState().currentFrame).toBe(11)
    })

    it('normalizes NaN to 0', () => {
      usePlaybackStore.getState().setCurrentFrame(NaN)
      expect(usePlaybackStore.getState().currentFrame).toBe(0)
    })

    it('normalizes Infinity to 0', () => {
      usePlaybackStore.getState().setCurrentFrame(Infinity)
      expect(usePlaybackStore.getState().currentFrame).toBe(0)
    })

    it('avoids state update when frame is unchanged', () => {
      usePlaybackStore.getState().setCurrentFrame(50)
      const stateA = usePlaybackStore.getState()
      usePlaybackStore.getState().setCurrentFrame(50)
      const stateB = usePlaybackStore.getState()
      // Same reference means no unnecessary re-renders
      expect(stateA).toBe(stateB)
    })
  })

  describe('playback controls', () => {
    it('plays and pauses', () => {
      usePlaybackStore.getState().play()
      expect(usePlaybackStore.getState().isPlaying).toBe(true)

      usePlaybackStore.getState().pause()
      expect(usePlaybackStore.getState().isPlaying).toBe(false)
    })

    it('toggles play/pause', () => {
      usePlaybackStore.getState().togglePlayPause()
      expect(usePlaybackStore.getState().isPlaying).toBe(true)

      usePlaybackStore.getState().togglePlayPause()
      expect(usePlaybackStore.getState().isPlaying).toBe(false)
    })

    it('avoids state update when already playing/paused', () => {
      const stateA = usePlaybackStore.getState()
      usePlaybackStore.getState().pause() // already paused
      const stateB = usePlaybackStore.getState()
      expect(stateA).toBe(stateB)

      usePlaybackStore.getState().play()
      const stateC = usePlaybackStore.getState()
      usePlaybackStore.getState().play() // already playing
      const stateD = usePlaybackStore.getState()
      expect(stateC).toBe(stateD)
    })

    it.each([
      {
        command: 'play',
        run: () => usePlaybackStore.getState().play(),
        expected: { isPlaying: true, playbackRate: 1, transportMode: 'normal' },
      },
      {
        command: 'play/pause',
        run: () => usePlaybackStore.getState().togglePlayPause(),
        expected: { isPlaying: true, playbackRate: 1, transportMode: 'normal' },
      },
      {
        command: 'forward shuttle',
        run: () => usePlaybackStore.getState().shuttleForward(),
        expected: { isPlaying: true, playbackRate: 1, transportMode: 'shuttle' },
      },
      {
        command: 'reverse shuttle',
        run: () => usePlaybackStore.getState().shuttleReverse(),
        expected: { isPlaying: true, playbackRate: -1, transportMode: 'shuttle' },
      },
      {
        command: 'pause',
        run: () => usePlaybackStore.getState().pause(),
        expected: { isPlaying: false, playbackRate: 1, transportMode: 'normal' },
      },
      {
        command: 'rate change',
        run: () => usePlaybackStore.getState().setPlaybackRate(2),
        expected: { isPlaying: false, playbackRate: 2, transportMode: 'normal' },
      },
    ])('keeps a newer $command command after scrub release', ({ run, expected }) => {
      usePlaybackStore.setState({
        isPlaying: true,
        playbackRate: 4,
        transportMode: 'shuttle',
      })
      usePlaybackStore.getState().beginPlaybackScrub()

      run()
      usePlaybackStore.getState().resumePlaybackAfterScrub()

      expect(usePlaybackStore.getState()).toMatchObject({
        ...expected,
        playbackScrubResumeTransport: null,
      })
    })

    it('clears active skimming atomically when playback starts', () => {
      usePlaybackStore.getState().setPreviewFrame(42, 'item-1')
      const beforePlay = usePlaybackStore.getState()

      usePlaybackStore.getState().play()

      const playing = usePlaybackStore.getState()
      expect(playing.isPlaying).toBe(true)
      expect(playing.previewFrame).toBeNull()
      expect(playing.previewItemId).toBeNull()
      expect(playing.previewFrameEpoch).toBeGreaterThan(beforePlay.previewFrameEpoch)
      expect(playing.previewFrameEpoch).toBe(playing.frameUpdateEpoch)
    })

    it('clears active skimming when toggle starts playback', () => {
      usePlaybackStore.getState().setPreviewFrame(42, 'item-1')

      usePlaybackStore.getState().togglePlayPause()

      expect(usePlaybackStore.getState()).toMatchObject({
        isPlaying: true,
        previewFrame: null,
        previewItemId: null,
      })
    })
  })

  describe('playback rate', () => {
    it('sets playback rate', () => {
      usePlaybackStore.getState().setPlaybackRate(2)
      expect(usePlaybackStore.getState().playbackRate).toBe(2)

      usePlaybackStore.getState().setPlaybackRate(0.5)
      expect(usePlaybackStore.getState().playbackRate).toBe(0.5)
    })

    it('applies J/L shuttle transitions atomically and resets on pause', () => {
      const listener = vi.fn()
      const unsubscribe = usePlaybackStore.subscribe(listener)

      usePlaybackStore.getState().shuttleForward()
      expect(usePlaybackStore.getState()).toMatchObject({
        isPlaying: true,
        playbackRate: 1,
        transportMode: 'shuttle',
      })
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      usePlaybackStore.getState().shuttleForward()
      expect(usePlaybackStore.getState().playbackRate).toBe(2)
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      usePlaybackStore.getState().shuttleReverse()
      expect(usePlaybackStore.getState()).toMatchObject({
        isPlaying: true,
        playbackRate: -1,
        transportMode: 'shuttle',
      })
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      usePlaybackStore.getState().pause()
      expect(usePlaybackStore.getState()).toMatchObject({
        isPlaying: false,
        playbackRate: 1,
        transportMode: 'normal',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('keeps shuttle rate out of persisted playback settings', () => {
      usePlaybackStore.getState().shuttleReverse()
      const options = usePlaybackStore.persist.getOptions()
      const persisted = options.partialize?.(usePlaybackStore.getState())

      expect(persisted).not.toHaveProperty('playbackRate')
      expect(persisted).not.toHaveProperty('isPlaying')
      expect(persisted).not.toHaveProperty('transportMode')
    })
  })

  describe('loop', () => {
    it('toggles loop', () => {
      usePlaybackStore.getState().toggleLoop()
      expect(usePlaybackStore.getState().loop).toBe(true)

      usePlaybackStore.getState().toggleLoop()
      expect(usePlaybackStore.getState().loop).toBe(false)
    })
  })

  describe('volume and mute', () => {
    it('sets volume', () => {
      usePlaybackStore.getState().setVolume(0.5)
      expect(usePlaybackStore.getState().volume).toBe(0.5)
    })

    it('toggles mute', () => {
      usePlaybackStore.getState().toggleMute()
      expect(usePlaybackStore.getState().muted).toBe(true)

      usePlaybackStore.getState().toggleMute()
      expect(usePlaybackStore.getState().muted).toBe(false)
    })
  })

  describe('zoom', () => {
    it('sets zoom level', () => {
      usePlaybackStore.getState().setZoom(150)
      expect(usePlaybackStore.getState().zoom).toBe(150)
    })

    it('supports auto-fit value (-1)', () => {
      usePlaybackStore.getState().setZoom(-1)
      expect(usePlaybackStore.getState().zoom).toBe(-1)
    })
  })

  describe('preview quality', () => {
    it('stores user-selected fast scrub quality', () => {
      usePlaybackStore.getState().setPreviewQuality(0.5)
      expect(usePlaybackStore.getState().previewQuality).toBe(0.5)

      usePlaybackStore.getState().setPreviewQuality(0.33)
      expect(usePlaybackStore.getState().previewQuality).toBe(0.33)

      usePlaybackStore.getState().setPreviewQuality(0.25)
      expect(usePlaybackStore.getState().previewQuality).toBe(0.25)

      usePlaybackStore.getState().setPreviewQuality(1)
      expect(usePlaybackStore.getState().previewQuality).toBe(1)
    })
  })

  describe('preview frame', () => {
    it('sets preview frame for hover', () => {
      usePlaybackStore.getState().setPreviewFrame(42)
      expect(usePlaybackStore.getState().previewFrame).toBe(42)
    })

    it('clears preview frame', () => {
      usePlaybackStore.getState().setPreviewFrame(42)
      usePlaybackStore.getState().setPreviewFrame(null)
      expect(usePlaybackStore.getState().previewFrame).toBe(null)
    })

    it('normalizes preview frame values', () => {
      usePlaybackStore.getState().setPreviewFrame(-5)
      expect(usePlaybackStore.getState().previewFrame).toBe(0)
    })

    it('avoids state update when preview frame is unchanged', () => {
      usePlaybackStore.getState().setPreviewFrame(42)
      const stateA = usePlaybackStore.getState()
      usePlaybackStore.getState().setPreviewFrame(42)
      const stateB = usePlaybackStore.getState()
      expect(stateA).toBe(stateB)
    })

    it('updates currentFrame and previewFrame atomically for scrub frames', () => {
      usePlaybackStore.getState().setScrubFrame(42, 'item-1')
      const state = usePlaybackStore.getState()
      expect(state.currentFrame).toBe(42)
      expect(state.previewFrame).toBe(42)
      expect(state.previewItemId).toBe('item-1')
      expect(state.currentFrameEpoch).toBe(state.previewFrameEpoch)
    })

    it('finishes a transient scrub in one atomic state update', () => {
      usePlaybackStore.setState({
        currentFrame: 10,
        previewFrame: 42,
        previewItemId: 'item-1',
        compositionVisualFrozen: true,
      })
      const listener = vi.fn()
      const unsubscribe = usePlaybackStore.subscribe(listener)

      usePlaybackStore.getState().finishScrub(42)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(usePlaybackStore.getState()).toMatchObject({
        currentFrame: 42,
        previewFrame: null,
        previewItemId: null,
        compositionVisualFrozen: false,
      })
      unsubscribe()
    })

    it('avoids entering scrub mode when the paused ruler clicks the already-current frame', () => {
      usePlaybackStore.getState().setCurrentFrame(42)
      const stateA = usePlaybackStore.getState()

      usePlaybackStore.getState().setScrubFrame(42)
      const stateB = usePlaybackStore.getState()

      expect(stateB).toBe(stateA)
      expect(stateB.currentFrame).toBe(42)
      expect(stateB.previewFrame).toBeNull()
    })

    it('rejects hover and scrub frame writes during playback', () => {
      usePlaybackStore.getState().setCurrentFrame(12)
      usePlaybackStore.getState().play()
      const playing = usePlaybackStore.getState()

      usePlaybackStore.getState().setPreviewFrame(42, 'item-1')
      usePlaybackStore.getState().setScrubFrame(42, 'item-1')

      const afterSkimAttempts = usePlaybackStore.getState()
      expect(afterSkimAttempts).toBe(playing)
      expect(afterSkimAttempts.currentFrame).toBe(12)
      expect(afterSkimAttempts.previewFrame).toBeNull()
      expect(afterSkimAttempts.previewItemId).toBeNull()
    })
  })
})
