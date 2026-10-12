import { createElement, startTransition, Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { useClipVisibility } from './use-clip-visibility'
import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { _resetZoomStoreForTest, useZoomStore } from '../stores/zoom-store'

function VisibilityProbe({
  clipLeftPx,
  clipWidthPx,
  onRender,
}: {
  clipLeftPx: number
  clipWidthPx: number
  onRender: (value: string) => void
}) {
  const visibility = useClipVisibility(clipLeftPx, clipWidthPx)
  const value = `${visibility.isVisible}:${visibility.visibleStartRatio.toFixed(3)}:${visibility.visibleEndRatio.toFixed(3)}`
  onRender(value)
  return createElement('div', { 'data-testid': 'visibility' }, value)
}

describe('useClipVisibility', () => {
  beforeEach(() => {
    _resetZoomStoreForTest()
    _resetViewportThrottle()
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1000,
      viewportHeight: 120,
    })
  })

  it('updates visibility when viewport scrolls', () => {
    const onRender = vi.fn()

    render(
      createElement(VisibilityProbe, {
        clipLeftPx: 200,
        clipWidthPx: 400,
        onRender,
      }),
    )

    // Clip at 200-600 in viewport 0-1000: fully visible
    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000')

    // Viewport resize (non-scroll-only) bypasses throttle and fires immediately
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 1000,
        scrollTop: 0,
        viewportWidth: 900,
        viewportHeight: 120,
      })
    })

    // Clip at 200-600, viewport at 1000-1900, margin 600 → visible range [400, 2500]
    // Clip is partially visible: startRatio = (400-200)/400 = 0.5
    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.500:1.000')
    expect(onRender).toHaveBeenCalled()
  })

  it('marks clip as not visible when scrolled far away', () => {
    render(
      createElement(VisibilityProbe, {
        clipLeftPx: 200,
        clipWidthPx: 400,
        onRender: vi.fn(),
      }),
    )

    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000')

    // Scroll far away — viewport resize bypasses throttle
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 5000,
        scrollTop: 0,
        viewportWidth: 900,
        viewportHeight: 120,
      })
    })

    // Clip at 200-600, visible range [4400, 6500] — clip is outside
    expect(screen.getByTestId('visibility')).toHaveTextContent('false:0.000:1.000')
  })

  it('freezes the last bounded visibility window during zoom interaction', () => {
    render(
      createElement(VisibilityProbe, {
        clipLeftPx: 200,
        clipWidthPx: 400,
        onRender: vi.fn(),
      }),
    )

    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000')

    // Scroll far away so clip is normally not visible
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 5000,
        scrollTop: 0,
        viewportWidth: 900,
        viewportHeight: 120,
      })
    })
    expect(screen.getByTestId('visibility')).toHaveTextContent('false:0.000:1.000')

    // Start zoom interaction. The last valid offscreen state remains frozen.
    act(() => {
      useZoomStore.getState().setZoomLevelImmediate(2)
    })
    expect(screen.getByTestId('visibility')).toHaveTextContent('false:0.000:1.000')

    // Viewport changes during the gesture do not expand or move the window.
    act(() => {
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 0,
        scrollTop: 0,
        viewportWidth: 800,
        viewportHeight: 120,
      })
    })
    expect(screen.getByTestId('visibility')).toHaveTextContent('false:0.000:1.000')

    // Settling zoom recomputes against the current viewport.
    act(() => {
      useZoomStore.getState().setZoomLevelSynchronized(2)
    })
    expect(screen.getByTestId('visibility')).toHaveTextContent('true:0.000:1.000')
  })

  it('does not leak visibility from a suspended geometry transition', async () => {
    useTimelineViewportStore.getState().setViewport({
      scrollLeft: 5000,
      scrollTop: 0,
      viewportWidth: 900,
      viewportHeight: 120,
    })

    let allowSuspendedRender = false
    let releaseSuspendedRender: (() => void) | null = null
    const suspendedRender = new Promise<void>((resolve) => {
      releaseSuspendedRender = () => {
        allowSuspendedRender = true
        resolve()
      }
    })

    function ConcurrentVisibilityProbe({
      clipLeftPx,
      geometryPixelsPerSecond,
      suspendWhenVisible = false,
    }: {
      clipLeftPx: number
      geometryPixelsPerSecond: number
      suspendWhenVisible?: boolean
    }) {
      const visibility = useClipVisibility(clipLeftPx, 400, geometryPixelsPerSecond)
      if (suspendWhenVisible && visibility.isVisible && !allowSuspendedRender) {
        throw suspendedRender
      }
      return createElement(
        'div',
        { 'data-testid': 'concurrent-visibility' },
        String(visibility.isVisible),
      )
    }

    const createTree = (
      clipLeftPx: number,
      geometryPixelsPerSecond: number,
      suspendWhenVisible = false,
    ) =>
      createElement(
        Suspense,
        {
          fallback: createElement('div', { 'data-testid': 'concurrent-visibility' }, 'loading'),
        },
        createElement(ConcurrentVisibilityProbe, {
          clipLeftPx,
          geometryPixelsPerSecond,
          suspendWhenVisible,
        }),
      )

    const view = render(createTree(200, 100))
    expect(screen.getByTestId('concurrent-visibility')).toHaveTextContent('false')

    act(() => {
      useZoomStore.setState({
        contentLevel: 2,
        contentPixelsPerSecond: 200,
      })
      startTransition(() => {
        view.rerender(createTree(5000, 200, true))
      })
    })
    expect(screen.getByTestId('concurrent-visibility')).toHaveTextContent('false')

    act(() => {
      useZoomStore.setState({ isZoomInteracting: true })
      useTimelineViewportStore.getState().setViewport({
        scrollLeft: 5000,
        scrollTop: 0,
        viewportWidth: 901,
        viewportHeight: 120,
      })
    })
    expect(screen.getByTestId('concurrent-visibility')).toHaveTextContent('false')

    act(() => {
      view.rerender(createTree(200, 100))
    })
    await act(async () => {
      releaseSuspendedRender?.()
      await suspendedRender
    })
  })
})
