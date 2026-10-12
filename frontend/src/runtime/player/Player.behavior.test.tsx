import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { HeadlessPlayer, type PlayerRef } from './Player'

/**
 * Regression: pressing "Go To Start" (a seek to frame 0) must land on frame 0
 * and stay there, even when the player was mounted with a non-zero
 * `initialFrame` (e.g. restoring a saved playhead on project load).
 *
 * The original "sync initial frame" effect depended on the live clock frame and
 * re-fired every time the clock returned to 0, snapping the playhead back to the
 * stale mount-time `initialFrame`. This bit older projects whose saved playhead
 * was non-zero (a full reload masked it because the preview then mounted at 0).
 */
describe('Player initial-frame sync', () => {
  it('starts at initialFrame on mount', () => {
    const ref = createRef<PlayerRef>()
    render(
      <HeadlessPlayer ref={ref} durationInFrames={300} fps={30} initialFrame={100}>
        <div />
      </HeadlessPlayer>,
    )
    expect(ref.current?.getCurrentFrame()).toBe(100)
  })

  it('stays at 0 after seeking to start (does not snap back to initialFrame)', () => {
    const ref = createRef<PlayerRef>()
    render(
      <HeadlessPlayer ref={ref} durationInFrames={300} fps={30} initialFrame={100}>
        <div />
      </HeadlessPlayer>,
    )

    act(() => {
      ref.current?.seekTo(0)
    })

    expect(ref.current?.getCurrentFrame()).toBe(0)
  })

  it('still honors ordinary seeks to a non-zero frame', () => {
    const ref = createRef<PlayerRef>()
    render(
      <HeadlessPlayer ref={ref} durationInFrames={300} fps={30} initialFrame={100}>
        <div />
      </HeadlessPlayer>,
    )

    act(() => {
      ref.current?.seekTo(42)
    })

    expect(ref.current?.getCurrentFrame()).toBe(42)
  })
})

describe('Player transport rate bridge', () => {
  it('propagates signed transient rates to the Clock', () => {
    const ref = createRef<PlayerRef>()
    render(
      <HeadlessPlayer ref={ref} durationInFrames={300} fps={30}>
        <div />
      </HeadlessPlayer>,
    )

    act(() => {
      ref.current?.setPlaybackRate(4)
    })
    expect(ref.current?.getPlaybackRate()).toBe(4)

    act(() => {
      ref.current?.setPlaybackRate(-2)
    })
    expect(ref.current?.getPlaybackRate()).toBe(-2)
  })
})
