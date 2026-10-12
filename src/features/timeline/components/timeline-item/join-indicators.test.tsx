import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { _resetZoomStoreForTest, useZoomStore } from '../../stores/zoom-store'
import { TimelineJoinIndicatorsZoomGate, ZoomGatedJoinIndicators } from './join-indicators'

const indicatorProps = {
  hasJoinableLeft: true,
  hasJoinableRight: true,
  trackLocked: false,
  dragAffectsJoin: { left: false, right: false },
  hoveredEdge: null,
  isTrimming: false,
  isStretching: false,
  isBeingDragged: false,
} as const

function renderGate() {
  return (
    <TimelineJoinIndicatorsZoomGate>
      <ZoomGatedJoinIndicators {...indicatorProps} />
    </TimelineJoinIndicatorsZoomGate>
  )
}

describe('TimelineJoinIndicatorsZoomGate', () => {
  beforeEach(() => {
    _resetZoomStoreForTest()
    useZoomStore.setState({
      level: 50,
      pixelsPerSecond: 5000,
      contentLevel: 50,
      contentPixelsPerSecond: 5000,
      isZoomInteracting: false,
    })
  })

  it('demotes a saturated zoom-out cohort before the settled store catches up', () => {
    const view = render(renderGate())
    expect(view.container.querySelectorAll('[title]')).toHaveLength(2)

    act(() => {
      useZoomStore.setState({
        level: 0.1,
        pixelsPerSecond: 10,
        isZoomInteracting: true,
      })
    })

    expect(view.container.querySelectorAll('[title]')).toHaveLength(0)

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.1,
        contentPixelsPerSecond: 10,
        isZoomInteracting: false,
      })
    })

    expect(view.container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('restores indicators after a net-zero zoom reversal', async () => {
    const view = render(renderGate())
    expect(view.container.querySelectorAll('[title]')).toHaveLength(2)

    act(() => {
      useZoomStore.setState({
        level: 0.1,
        pixelsPerSecond: 10,
        isZoomInteracting: true,
      })
    })
    expect(view.container.querySelectorAll('[title]')).toHaveLength(0)

    act(() => {
      useZoomStore.setState({
        level: 50,
        pixelsPerSecond: 5000,
        isZoomInteracting: true,
      })
      useZoomStore.setState({
        contentLevel: 50,
        contentPixelsPerSecond: 5000,
        isZoomInteracting: false,
      })
    })

    await waitFor(() => {
      expect(view.container.querySelectorAll('[title]')).toHaveLength(2)
    })
  })
})
