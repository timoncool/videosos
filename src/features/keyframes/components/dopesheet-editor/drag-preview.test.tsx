import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'
import { PROPERTY_COLUMN_WIDTH } from './dopesheet-constants'

describe('DopesheetEditor drag preview', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture
  const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame

  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        if (this.hasAttribute('data-dopesheet-scroll-viewport')) {
          return 600 + PROPERTY_COLUMN_WIDTH
        }
        return 600
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = vi.fn()
  })

  afterAll(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
    }
    if (originalSetPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        configurable: true,
        value: originalSetPointerCapture,
      })
    }
    if (originalReleasePointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
        configurable: true,
        value: originalReleasePointerCapture,
      })
    }
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('previews drag movement locally and commits once on pointer up', () => {
    const onKeyframeMove = vi.fn()
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    )

    const keyframe = screen.getByTestId('row-keyframe-x-kf-1')
    const initialStyle = keyframe.getAttribute('style')

    fireEvent.pointerDown(keyframe, { button: 0, pointerId: 1, clientX: 100 })

    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 140 })
    })

    expect(onKeyframeMove).not.toHaveBeenCalled()
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(keyframe.getAttribute('style')).not.toBe(initialStyle)

    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 140 })
    })

    expect(onKeyframeMove).toHaveBeenCalledTimes(1)
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
      40,
      100,
    )
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('uses the live timeline scale for drag preview and commit before React rerenders', () => {
    const onKeyframeMove = vi.fn()
    const onSelectionFrameDelta = vi.fn(() => true)
    let livePixelsPerSecond = 60

    render(
      <DopesheetEditor
        itemId="item-live-zoom"
        keyframesByProperty={{
          x: [{ id: 'kf-live', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-live'])}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onSelectionFrameDelta={onSelectionFrameDelta}
        getTimelineLivePixelsPerSecond={() => livePixelsPerSecond}
      />,
    )

    fireEvent.pointerDown(screen.getByTestId('row-keyframe-x-kf-live'), {
      button: 0,
      pointerId: 4,
      clientX: 100,
    })
    livePixelsPerSecond = 120
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 4, clientX: 140 })
    })
    livePixelsPerSecond = 240
    act(() => {
      fireEvent.pointerUp(window, { pointerId: 4, clientX: 140 })
    })

    expect(onSelectionFrameDelta).toHaveBeenCalledWith(10, 'preview')
    expect(onSelectionFrameDelta).toHaveBeenLastCalledWith(5, 'commit')
    expect(onKeyframeMove).not.toHaveBeenCalled()
  })

  it('delegates a composition-wide selection drag without double-committing locally', () => {
    const onKeyframeMove = vi.fn()
    const onSelectionFrameDelta = vi.fn(() => true)
    const onDragEnd = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onSelectionFrameDelta={onSelectionFrameDelta}
        onDragEnd={onDragEnd}
      />,
    )

    fireEvent.pointerDown(screen.getByTestId('row-keyframe-x-kf-1'), {
      button: 0,
      pointerId: 2,
      clientX: 100,
    })
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 140 })
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 140 })
    })

    expect(onSelectionFrameDelta).toHaveBeenCalledWith(20, 'preview')
    expect(onSelectionFrameDelta).toHaveBeenLastCalledWith(20, 'commit')
    expect(onKeyframeMove).not.toHaveBeenCalled()
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('cancels a delegated composition drag without committing or creating history', () => {
    const onKeyframeMove = vi.fn()
    const onSelectionFrameDelta = vi.fn(() => true)
    const onDragEnd = vi.fn()
    const onDragCancel = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-cancel', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-cancel'])}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onSelectionFrameDelta={onSelectionFrameDelta}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      />,
    )

    fireEvent.pointerDown(screen.getByTestId('row-keyframe-x-kf-cancel'), {
      button: 0,
      pointerId: 3,
      clientX: 100,
    })
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 140 })
      fireEvent.pointerCancel(window, { pointerId: 3, clientX: 140 })
    })

    expect(onSelectionFrameDelta).toHaveBeenLastCalledWith(20, 'cancel')
    expect(onKeyframeMove).not.toHaveBeenCalled()
    expect(onDragEnd).not.toHaveBeenCalled()
    expect(onDragCancel).toHaveBeenCalledTimes(1)
  })
})
