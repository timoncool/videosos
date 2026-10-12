import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { usePlaybackStore } from '@/shared/state/playback'

import { setTimelineState } from '../test-helpers'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'
import { TimelineRecordingOverlay } from './timeline-recording-overlay'

describe('TimelineRecordingOverlay', () => {
  beforeEach(() => {
    _resetZoomStoreForTest()
    useMicRecordingStore.getState().reset()
    usePlaybackStore.setState({ currentFrame: 0 })
    setTimelineState({ fps: 30 })
  })

  it('renders nothing while recording is idle', () => {
    const view = render(<TimelineRecordingOverlay />)

    expect(view.container).toBeEmptyDOMElement()
  })

  it('updates real-pixel geometry on live zoom without remounting', () => {
    usePlaybackStore.setState({ currentFrame: 60 })
    useMicRecordingStore.setState({
      status: 'recording',
      recordStartFrame: 30,
    })

    const view = render(<TimelineRecordingOverlay />)
    const overlay = view.container.firstElementChild
    const bar = overlay?.children[0]
    const label = overlay?.children[1]

    expect(overlay).toBeInstanceOf(HTMLDivElement)
    expect(bar).toBeInstanceOf(HTMLDivElement)
    expect(label).toBeInstanceOf(HTMLDivElement)
    expect((bar as HTMLDivElement).style.left).toBe('100px')
    expect((bar as HTMLDivElement).style.width).toBe('100px')
    expect((label as HTMLDivElement).style.left).toBe('100px')

    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(1.5)
    })

    expect(useZoomStore.getState().contentPixelsPerSecond).toBe(100)
    expect(overlay?.children[0]).toBe(bar)
    expect(overlay?.children[1]).toBe(label)
    expect((bar as HTMLDivElement).style.left).toBe('150px')
    expect((bar as HTMLDivElement).style.width).toBe('150px')
    expect((label as HTMLDivElement).style.left).toBe('150px')
  })
})
