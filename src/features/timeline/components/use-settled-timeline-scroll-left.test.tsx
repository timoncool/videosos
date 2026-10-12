import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store'
import {
  EDIT_DOPESHEET_PAN_REBASE_VIEWPORT_RATIO,
  EDIT_DOPESHEET_PAN_SETTLE_MS,
  useSettledTimelineGeometry,
  useSettledTimelineScrollLeft,
} from './use-settled-timeline-scroll-left'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'

describe('useSettledTimelineScrollLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
    _resetViewportThrottle()
    _resetZoomStoreForTest()
    useTimelineViewportStore.getState().setViewportImmediate({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 640,
      viewportHeight: 320,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('publishes the live DOM position after pan settles', () => {
    const container = document.createElement('div')
    container.scrollLeft = 20
    const scrollContainerRef = { current: container }
    const { result } = renderHook(() => useSettledTimelineScrollLeft(scrollContainerRef, true))

    expect(result.current).toBe(20)

    act(() => {
      container.scrollLeft = 80
      container.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(EDIT_DOPESHEET_PAN_SETTLE_MS - 1)
    })
    expect(result.current).toBe(20)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(80)
  })

  it('rebases only after the compositor pan crosses a viewport-relative distance', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 200 })
    const scrollContainerRef = { current: container }
    const { result } = renderHook(() => useSettledTimelineScrollLeft(scrollContainerRef, true))

    const rebaseDistance = 200 * EDIT_DOPESHEET_PAN_REBASE_VIEWPORT_RATIO
    act(() => {
      container.scrollLeft = rebaseDistance - 1
      container.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(0)

    act(() => {
      container.scrollLeft = rebaseDistance
      container.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(rebaseDistance)
  })

  it('publishes zoom and its anchored scroll position as one settled snapshot', async () => {
    const container = document.createElement('div')
    container.scrollLeft = 100
    const scrollContainerRef = { current: container }
    const { result, rerender } = renderHook(
      ({ pixelsPerSecond }) =>
        useSettledTimelineGeometry(scrollContainerRef, true, pixelsPerSecond),
      { initialProps: { pixelsPerSecond: 100 } },
    )

    act(() => vi.runOnlyPendingTimers())
    expect(result.current).toEqual({ scrollLeft: 100, pixelsPerSecond: 100 })

    act(() => {
      useZoomStore.setState({
        level: 1.5,
        pixelsPerSecond: 150,
        isZoomInteracting: true,
      })
      container.scrollLeft = 180
      container.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(EDIT_DOPESHEET_PAN_SETTLE_MS)
    })
    expect(result.current).toEqual({ scrollLeft: 100, pixelsPerSecond: 100 })

    act(() => {
      useZoomStore.setState({
        contentLevel: 1.5,
        contentPixelsPerSecond: 150,
        isZoomInteracting: false,
      })
      rerender({ pixelsPerSecond: 150 })
    })
    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
    })
    expect(result.current).toEqual({ scrollLeft: 180, pixelsPerSecond: 150 })
  })
})
