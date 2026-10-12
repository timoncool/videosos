import { Profiler } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'
import { TimelinePreviewScrubber } from './timeline-preview-scrubber'

describe('TimelinePreviewScrubber', () => {
  beforeEach(() => {
    _resetZoomStoreForTest()
    useTimelineSettingsStore.setState({ fps: 30 })
    usePlaybackStore.setState({ previewFrame: null, previewItemId: null, isPlaying: false })
  })

  it('follows live zoom geometry without a React update', () => {
    const renderPhases: string[] = []
    render(
      <Profiler
        id="main-preview-scrubber"
        onRender={(_id, phase) => {
          renderPhases.push(phase)
        }}
      >
        <TimelinePreviewScrubber />
      </Profiler>,
    )

    act(() => usePlaybackStore.getState().setPreviewFrame(30))
    const scrubber = screen.getByTestId('timeline-preview-scrubber')
    expect(scrubber).toHaveStyle({ transform: 'translate3d(100px, 0, 0)' })
    renderPhases.length = 0

    act(() => {
      useZoomStore.setState({
        level: 1.8,
        pixelsPerSecond: 180,
        isZoomInteracting: true,
      })
    })

    expect(scrubber).toHaveStyle({ transform: 'translate3d(180px, 0, 0)' })
    expect(renderPhases).toEqual([])
  })
})
