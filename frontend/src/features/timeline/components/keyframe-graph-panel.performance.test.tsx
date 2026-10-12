import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'
import { KeyframeGraphPanel } from './keyframe-graph-panel'

const perfMarkMocks = vi.hoisted(() => ({ mark: vi.fn() }))

vi.mock('@/shared/logging/perf-marks', () => ({
  perfMarkRender: perfMarkMocks.mark,
  withPerfMeasure: (_name: string, callback: () => unknown) => callback(),
}))

describe('KeyframeGraphPanel render isolation', () => {
  beforeEach(() => {
    _resetZoomStoreForTest()
    useZoomStore.getState().setZoomLevelSynchronized(1)
    perfMarkMocks.mark.mockClear()
  })

  it('does not render the editor panel for live-only zoom updates', () => {
    render(
      <KeyframeGraphPanel
        isOpen={false}
        onClose={() => {}}
        surface="edit"
        timelineScrollContainerRef={{ current: document.createElement('div') }}
      />,
    )
    perfMarkMocks.mark.mockClear()

    act(() => {
      useZoomStore.setState({ pixelsPerSecond: 125, level: 1.25, isZoomInteracting: true })
    })

    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('KeyframeGraphPanel')
  })

  it('renders once when settled zoom geometry commits', () => {
    render(
      <KeyframeGraphPanel
        isOpen={false}
        onClose={() => {}}
        surface="edit"
        timelineScrollContainerRef={{ current: document.createElement('div') }}
      />,
    )
    perfMarkMocks.mark.mockClear()

    act(() => {
      useZoomStore.setState({
        level: 1.25,
        pixelsPerSecond: 125,
        contentLevel: 1.25,
        contentPixelsPerSecond: 125,
        isZoomInteracting: false,
      })
    })

    expect(perfMarkMocks.mark).toHaveBeenCalledWith('KeyframeGraphPanel')
  })
})
