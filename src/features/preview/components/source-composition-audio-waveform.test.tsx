import { type ReactNode } from 'react'
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vite-plus/test'
import { render, fireEvent } from '@testing-library/react'

const playerMethodsState = vi.hoisted(() => ({
  seek: vi.fn(),
}))

const sourcePlayerStoreState = vi.hoisted(() => ({
  setCurrentSourceFrame: vi.fn(),
}))

vi.mock('@/features/preview/deps/player-core', () => ({
  AbsoluteFill: ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="absolute-fill" style={style}>
      {children}
    </div>
  ),
}))

vi.mock('@/features/preview/deps/player-context', () => ({
  useClock: () => ({ currentFrame: 0, onFrameChange: () => () => {} }),
  useClockIsPlaying: () => false,
  useClockPlaybackRate: () => 1,
  usePlayer: () => playerMethodsState,
  useVideoConfig: () => ({ fps: 30, width: 640, height: 360, durationInFrames: 300 }),
}))

vi.mock('@/features/preview/deps/player-pool', () => ({
  getGlobalVideoSourcePool: () => ({}),
}))

vi.mock('@/features/preview/deps/export', () => ({
  SharedVideoExtractorPool: class {},
}))

vi.mock('@/features/preview/deps/media-library', () => ({
  useMediaLibraryStore: () => null,
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: () => false,
}))

vi.mock('@/shared/state/source-player', () => ({
  useSourcePlayerStore: Object.assign(() => false, {
    getState: () => ({
      currentSourceFrame: 0,
      previewSourceFrame: null,
      setCurrentSourceFrame: sourcePlayerStoreState.setCurrentSourceFrame,
    }),
    subscribe: () => () => {},
  }),
}))

vi.mock('@/features/preview/deps/timeline-utils', () => ({
  useWaveform: () => ({
    peaks: new Float32Array([0, 0.5, 1, 0.5]),
    duration: 4,
    sampleRate: 1,
    channels: 1,
    stereo: false,
    maxPeak: 1,
    loadedSamples: 4,
    isLoading: false,
    progress: 100,
    error: null,
  }),
}))

import { SourceComposition } from './source-composition'

describe('SourceComposition audio waveform', () => {
  beforeAll(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window.HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window.HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    })
  })

  beforeEach(() => {
    playerMethodsState.seek.mockReset()
    sourcePlayerStoreState.setCurrentSourceFrame.mockReset()
  })

  it('shows a full-size overview and zoom waveform region for audio source monitor media', () => {
    const rendered = render(
      <SourceComposition mediaId="media-1" src="blob:media-1" mediaType="audio" />,
    )

    expect(rendered.getByTestId('source-audio-waveform')).toBeTruthy()
    expect(rendered.getByTestId('source-audio-waveform-overview')).toBeTruthy()
    expect(rendered.getByTestId('source-audio-waveform-zoom')).toBeTruthy()
  })

  it('seeks the source monitor from waveform pointer interaction', () => {
    const rendered = render(
      <SourceComposition mediaId="media-1" src="blob:media-1" mediaType="audio" />,
    )
    const waveform = rendered.getByTestId('source-audio-waveform')
    vi.spyOn(waveform, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 200,
      width: 100,
      height: 200,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(waveform, { clientX: 50, clientY: 10, pointerId: 1 })

    expect(sourcePlayerStoreState.setCurrentSourceFrame).toHaveBeenCalledWith(150)
    expect(playerMethodsState.seek).toHaveBeenCalledWith(150)
  })
})
