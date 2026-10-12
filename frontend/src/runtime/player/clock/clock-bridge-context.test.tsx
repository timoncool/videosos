import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { Clock } from './Clock'
import { ClockBridgeProvider } from './ClockBridgeProvider'
import { useClock } from './ClockContext'
import {
  useBridgedCurrentFrame,
  useBridgedIsPlaying,
  useBridgedTimelinePlayback,
} from './clock-bridge-context'

describe('Clock bridge context boundaries', () => {
  it('does not invalidate play-state consumers on frame changes', () => {
    let clock: Clock | null = null
    const playingValues: boolean[] = []
    const playbackValues: boolean[] = []
    const frameValues: number[] = []

    function ClockProbe() {
      clock = useClock()
      return null
    }
    const PlayingProbe = vi.fn(() => {
      playingValues.push(useBridgedIsPlaying())
      return null
    })
    const PlaybackProbe = vi.fn(() => {
      playbackValues.push(useBridgedTimelinePlayback().playing)
      return null
    })
    const FrameProbe = vi.fn(() => {
      frameValues.push(useBridgedCurrentFrame())
      return null
    })

    render(
      <ClockBridgeProvider fps={30} durationInFrames={200}>
        <ClockProbe />
        <PlayingProbe />
        <PlaybackProbe />
        <FrameProbe />
      </ClockBridgeProvider>,
    )

    act(() => clock!.seekToFrame(1))
    act(() => clock!.seekToFrame(2))

    expect(frameValues).toEqual([0, 1, 2])
    expect(playingValues).toEqual([false])
    expect(playbackValues).toEqual([false])

    act(() => clock!.play())
    expect(playingValues).toEqual([false, true])
    expect(playbackValues).toEqual([false, true])
  })
})
