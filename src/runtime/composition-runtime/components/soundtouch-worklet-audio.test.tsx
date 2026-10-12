import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_AUDIO_EQ_SETTINGS } from '@/shared/utils/audio-eq'
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio'

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    transportPlaybackRate: 1,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [] as (typeof DEFAULT_AUDIO_EQ_SETTINGS)[],
  },
}))

const previewGraphMocks = vi.hoisted(() => ({
  createPreviewClipAudioGraph: vi.fn(() => ({
    context: {
      state: 'running' as const,
      currentTime: 0,
      sampleRate: 48000,
      resume: vi.fn(() => Promise.resolve()),
      audioWorklet: {},
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  })),
  rampPreviewClipEq: vi.fn(),
  rampPreviewClipGain: vi.fn(),
}))

const soundTouchWorkletMocks = vi.hoisted(() => ({
  ensureSoundTouchPreviewWorkletLoaded: vi.fn(),
  prepareAudioBufferForSoundTouchPreview: vi.fn(async () => ({
    leftChannel: new Float32Array(0),
    rightChannel: new Float32Array(0),
    frameCount: 0,
    sampleRate: 48000,
  })),
}))
const workletNodeMocks = vi.hoisted(() => ({
  messages: [] as unknown[],
}))

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))
vi.mock('../utils/preview-audio-graph', () => ({
  createPreviewClipAudioGraph: previewGraphMocks.createPreviewClipAudioGraph,
  rampPreviewClipEq: previewGraphMocks.rampPreviewClipEq,
  rampPreviewClipGain: previewGraphMocks.rampPreviewClipGain,
}))
vi.mock('../utils/soundtouch-preview-worklet', () => ({
  ensureSoundTouchPreviewWorkletLoaded: soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded,
  prepareAudioBufferForSoundTouchPreview:
    soundTouchWorkletMocks.prepareAudioBufferForSoundTouchPreview,
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME: 'soundtouch-preview-processor',
}))
vi.mock('@/runtime/composition-runtime/deps/stores', () => ({
  useGizmoStore: {
    getState: () => ({ activeGizmo: null }),
  },
  usePlaybackStore: {
    getState: () => ({ isPlaying: false, previewFrame: null }),
  },
}))

function makeAudioBuffer(durationSeconds = 2): AudioBuffer {
  const sampleRate = 48000
  const length = sampleRate * durationSeconds
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('SoundTouchWorkletAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      transportPlaybackRate: 1,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
    workletNodeMocks.messages = []
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = {
          postMessage: (message: unknown) => {
            workletNodeMocks.messages.push(message)
          },
        }
        connect() {}
        disconnect() {}
      },
    )
  })

  it('does not render fallback while the worklet is still loading', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockReturnValue(
      new Promise<boolean>(() => {}),
    )

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByTestId('fallback')).toBeNull()
  })

  it('keeps the preview graph alive while EQ stages change', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockReturnValue(
      new Promise<boolean>(() => {}),
    )

    const { rerender } = render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        volumeMultiplier={1}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    })

    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      resolvedAudioEqStages: [DEFAULT_AUDIO_EQ_SETTINGS],
    }

    rerender(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        volumeMultiplier={1.01}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.rampPreviewClipEq).toHaveBeenLastCalledWith(expect.anything(), [
        DEFAULT_AUDIO_EQ_SETTINGS,
      ])
    })

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded).toHaveBeenCalledTimes(1)
  })

  it('renders fallback after the worklet path fails', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(false)

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        fallback={<div data-testid="fallback" />}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument()
    })
  })

  it('runs reverse shuttle through SoundTouch with stable pitch and signed source direction', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 300,
      playing: true,
      transportPlaybackRate: -4,
    }
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(true)

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(12)}
        itemId="nested-audio-1"
        durationInFrames={600}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'set-tempo',
        tempo: 4,
      })
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'seek',
        frame: 480000,
        direction: -1,
      })
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'set-pitch',
        pitch: 1,
      })
      expect(workletNodeMocks.messages).toContainEqual({
        type: 'set-playing',
        playing: true,
      })
    })
  })

  it('reads an authored reversed clip backwards without reversing its buffer on the UI thread', async () => {
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 90,
      playing: true,
      transportPlaybackRate: 1,
    }
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(true)

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer(12)}
        itemId="reversed-audio-1"
        durationInFrames={360}
        playbackRate={1}
        isReversed
        reverseSourceEnd={360}
      />,
    )

    await waitFor(() => {
      expect(workletNodeMocks.messages).toContainEqual(
        expect.objectContaining({
          type: 'seek',
          direction: -1,
        }),
      )
    })
  })
})
