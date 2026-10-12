import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}))
const clockRateMocks = vi.hoisted(() => ({ current: 1 }))

vi.mock('@/runtime/composition-runtime/deps/player', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/runtime/composition-runtime/deps/player')>()),
  useClockPlaybackRate: () => clockRateMocks.current,
}))

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [],
  } as {
    frame: number
    fps: number
    playing: boolean
    transportPlaybackRate?: number
    isPreviewScrubbing?: boolean
    resolvedVolume: number
    resolvedPitchShiftSemitones: number
    resolvedAudioEqStages: unknown[]
  },
}))

const soundTouchMocks = vi.hoisted(() => ({
  renderFallback: false,
}))

const storeMocks = vi.hoisted(() => {
  const gizmoState = { activeGizmo: null, preview: null }
  const useGizmoStore = Object.assign(
    vi.fn((selector?: (state: typeof gizmoState) => unknown) =>
      selector ? selector(gizmoState) : gizmoState,
    ),
    {
      getState: () => gizmoState,
    },
  )

  return { useGizmoStore }
})

vi.mock('@/runtime/composition-runtime/deps/stores', () => storeMocks)
vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks)
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))
vi.mock('./soundtouch-worklet-audio', () => ({
  SoundTouchWorkletAudio: ({
    audioBuffer,
    sourceStartOffsetSec,
    isComplete,
    fallback,
  }: {
    audioBuffer: AudioBuffer
    sourceStartOffsetSec?: number
    isComplete?: boolean
    fallback?: React.ReactNode
  }) =>
    soundTouchMocks.renderFallback && fallback ? (
      <>{fallback}</>
    ) : (
      <div
        data-testid="pitch"
        data-frames={audioBuffer.length}
        data-offset={sourceStartOffsetSec ?? 0}
        data-complete={isComplete ? 'true' : 'false'}
        data-has-fallback={fallback ? 'true' : 'false'}
      />
    ),
}))
vi.mock('./custom-decoder-buffered-audio', () => ({
  CustomDecoderBufferedAudio: () => <div data-testid="buffered" />,
}))
vi.mock('./pitch-corrected-audio', () => ({
  NativePitchCorrectedAudio: ({
    src,
    sourceStartOffsetSec,
  }: {
    src: string
    sourceStartOffsetSec?: number
  }) => (
    <div data-testid="native-fallback" data-src={src} data-offset={sourceStartOffsetSec ?? 0} />
  ),
}))

import { CustomDecoderAudio } from './custom-decoder-audio'

function makeAudioBuffer(durationSeconds = 8): AudioBuffer {
  const sampleRate = 22050
  const length = sampleRate * durationSeconds
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('CustomDecoderAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clockRateMocks.current = 1
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
    soundTouchMocks.renderFallback = false
  })

  it('uses playback-first partial decode for pitch-preserved custom audio', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 4,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        {
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
          targetTimeSeconds: 4,
        },
      )
    })

    await waitFor(() => {
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-frames',
        String(22050 * 8),
      )
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4')
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-complete',
        'false',
      )
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-has-fallback',
        'true',
      )
    })
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
  })

  it('defers pitch-preserved decoding until an active preview scrub settles', async () => {
    playbackStateMocks.current.isPreviewScrubbing = true
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    const { rerender } = render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
      />,
    )

    await Promise.resolve()
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()

    playbackStateMocks.current.isPreviewScrubbing = false
    rerender(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
  })

  it('requests another pitch-preserved partial slice before the current one runs out', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(2),
        startTime: 4,
        isComplete: false,
      })
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(3),
        startTime: 5.4,
        isComplete: false,
      })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    const { rerender } = render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-frames',
        String(22050 * 2),
      )
    })

    playbackStateMocks.current = {
      frame: 28,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }

    rerender(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
        volumeMultiplier={1.1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        minReadySeconds: 3,
        waitTimeoutMs: 6000,
      }),
    )
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
    ).toBeGreaterThan(5.39)
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
    ).toBeLessThan(5.41)
  })

  it('renders the fallback pitch-corrected path when the SoundTouch worklet cannot be used', async () => {
    soundTouchMocks.renderFallback = true
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 4,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback-wav')
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    })

    expect(document.querySelector('[data-testid="native-fallback"]')).toHaveAttribute(
      'data-src',
      'blob:fallback-wav',
    )
    expect(document.querySelector('[data-testid="native-fallback"]')).toHaveAttribute(
      'data-offset',
      '4',
    )
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled()
    createObjectUrlSpy.mockRestore()
    revokeObjectUrlSpy.mockRestore()
  })

  it('switches to the SoundTouch path for pitch-only shifts at 1x playback', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        audioPitchSemitones={3}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    expect(document.querySelector('[data-testid="buffered"]')).toBeNull()
    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('switches custom-codec audio to SoundTouch during forward shuttle', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    const props = {
      src: 'blob:opus-audio',
      mediaId: 'media-opus',
      itemId: 'item-opus',
      durationInFrames: 120,
      playbackRate: 1,
    }
    const { rerender } = render(<CustomDecoderAudio {...props} />)

    expect(document.querySelector('[data-testid="buffered"]')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="pitch"]')).toBeNull()

    clockRateMocks.current = 2
    rerender(<CustomDecoderAudio {...props} volumeMultiplier={1.01} />)

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
    expect(document.querySelector('[data-testid="buffered"]')).toBeNull()
    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })
})
