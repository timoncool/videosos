import { Profiler } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import {
  beginTimelineSkimmerScrub,
  endTimelineSkimmerScrub,
  resetTimelineSkimmerScrubForTest,
  timelineSkimmerScrubSignal,
} from '@/shared/timeline/main-timeline-scrub'
import { TimelinePreviewScrubberVisual } from './timeline-preview-scrubber-visual'

describe('TimelinePreviewScrubberVisual', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ previewFrame: null, previewItemId: null, isPlaying: false })
    resetTimelineSkimmerScrubForTest()
  })

  it('ignores playback-store updates when the preview frame is unchanged', () => {
    const frameToPixels = vi.fn((frame: number) => frame)
    render(<TimelinePreviewScrubberVisual frameToPixels={frameToPixels} fps={30} />)

    act(() => usePlaybackStore.getState().setPreviewFrame(12))
    frameToPixels.mockClear()

    act(() => usePlaybackStore.setState({ currentFrame: 8 }))
    expect(frameToPixels).not.toHaveBeenCalled()

    act(() => usePlaybackStore.getState().setPreviewFrame(13))
    expect(frameToPixels).toHaveBeenCalledOnce()
    expect(frameToPixels).toHaveBeenCalledWith(13)
  })

  it('preserves subpixel coordinates so shared timeline skim lines stay aligned', () => {
    const { rerender } = render(
      <TimelinePreviewScrubberVisual frameToPixels={() => 12.375} fps={30} />,
    )

    act(() => usePlaybackStore.getState().setPreviewFrame(10))

    expect(screen.getByTestId('timeline-preview-scrubber')).toHaveStyle({
      transform: 'translate3d(12.375px, 0, 0)',
    })

    rerender(<TimelinePreviewScrubberVisual frameToPixels={() => 28.625} fps={30} />)
    expect(screen.getByTestId('timeline-preview-scrubber')).toHaveStyle({
      transform: 'translate3d(28.625px, 0, 0)',
    })
  })

  it('repositions from a live scroll axis without waiting for a React render', () => {
    const scrollTarget = document.createElement('div')
    scrollTarget.scrollLeft = 20
    render(
      <TimelinePreviewScrubberVisual
        frameToPixels={(frame) => frame - scrollTarget.scrollLeft}
        fps={30}
        positionSyncTargetRef={{ current: scrollTarget }}
      />,
    )

    act(() => usePlaybackStore.getState().setPreviewFrame(100))
    const skim = screen.getByTestId('timeline-preview-scrubber')
    expect(skim).toHaveStyle({ transform: 'translate3d(80px, 0, 0)' })

    scrollTarget.scrollLeft = 55
    fireEvent.scroll(scrollTarget)

    expect(skim).toHaveStyle({ transform: 'translate3d(45px, 0, 0)' })
  })

  it('repositions from an imperative geometry signal without a React update', () => {
    let pixelsPerFrame = 2
    const listeners = new Set<() => void>()
    const renderPhases: string[] = []
    const repositionSignal = {
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }

    render(
      <Profiler
        id="preview-scrubber"
        onRender={(_id, phase) => {
          renderPhases.push(phase)
        }}
      >
        <TimelinePreviewScrubberVisual
          frameToPixels={(frame) => frame * pixelsPerFrame}
          fps={30}
          repositionSignal={repositionSignal}
        />
      </Profiler>,
    )

    act(() => usePlaybackStore.getState().setPreviewFrame(20))
    const skim = screen.getByTestId('timeline-preview-scrubber')
    expect(skim).toHaveStyle({ transform: 'translate3d(40px, 0, 0)' })
    renderPhases.length = 0

    pixelsPerFrame = 3.5
    act(() => {
      for (const listener of listeners) listener()
    })

    expect(skim).toHaveStyle({ transform: 'translate3d(70px, 0, 0)' })
    expect(renderPhases).toEqual([])
  })

  it('stays hidden while any imperative scrub gesture is active', () => {
    const rangeDragActiveRef = { current: false }
    const playheadDragActiveRef = { current: false }
    render(
      <TimelinePreviewScrubberVisual
        frameToPixels={(frame) => frame}
        fps={30}
        suppressRefs={[rangeDragActiveRef, playheadDragActiveRef]}
      />,
    )

    const skim = screen.getByTestId('timeline-preview-scrubber')
    act(() => usePlaybackStore.getState().setPreviewFrame(10))
    expect(skim).not.toHaveStyle({ display: 'none' })

    playheadDragActiveRef.current = true
    act(() => usePlaybackStore.getState().setPreviewFrame(11))
    expect(skim).toHaveStyle({ display: 'none' })

    playheadDragActiveRef.current = false
    act(() => usePlaybackStore.getState().setPreviewFrame(12))
    expect(skim).not.toHaveStyle({ display: 'none' })
  })

  it('hides immediately when a linked scrub starts and stays hidden through frame updates', () => {
    const scrubOwner = {}
    render(
      <TimelinePreviewScrubberVisual
        frameToPixels={(frame) => frame}
        fps={30}
        suppressSignal={timelineSkimmerScrubSignal}
      />,
    )

    const skim = screen.getByTestId('timeline-preview-scrubber')
    act(() => usePlaybackStore.getState().setPreviewFrame(20))
    expect(skim).not.toHaveStyle({ display: 'none' })

    act(() => beginTimelineSkimmerScrub(scrubOwner))
    expect(skim).toHaveStyle({ display: 'none' })

    act(() => usePlaybackStore.getState().setScrubFrame(21))
    expect(skim).toHaveStyle({ display: 'none' })

    act(() => endTimelineSkimmerScrub(scrubOwner))
    expect(skim).not.toHaveStyle({ display: 'none' })
  })
})
