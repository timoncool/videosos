import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { useDopesheetViewport } from './use-dopesheet-viewport'

describe('useDopesheetViewport', () => {
  it('applies controlled viewport changes in one render', () => {
    let renderCount = 0
    const { result, rerender } = renderHook(
      ({ startFrame, endFrame }) => {
        renderCount += 1
        return useDopesheetViewport({
          itemId: 'item-1',
          totalFrames: 120,
          keyframeFrameBounds: null,
          frameViewport: { startFrame, endFrame },
          onFrameViewportChange: undefined,
        })
      },
      { initialProps: { startFrame: 0, endFrame: 120 } },
    )

    expect(renderCount).toBe(1)
    rerender({ startFrame: 12, endFrame: 108 })

    expect(renderCount).toBe(2)
    expect(result.current.viewport).toEqual({ startFrame: 12, endFrame: 108 })
  })

  it('notifies the owner without creating controlled local state', () => {
    const onFrameViewportChange = vi.fn()
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useDopesheetViewport({
        itemId: 'item-1',
        totalFrames: 120,
        keyframeFrameBounds: null,
        frameViewport: { startFrame: 12, endFrame: 108 },
        onFrameViewportChange,
      })
    })

    act(() => result.current.updateViewport({ startFrame: 22, endFrame: 98 }))

    expect(onFrameViewportChange).toHaveBeenCalledWith({ startFrame: 22, endFrame: 98 })
    expect(renderCount).toBe(1)
    expect(result.current.viewport).toEqual({ startFrame: 12, endFrame: 108 })
  })

  it('preserves a shared timeline viewport outside the clip bounds', () => {
    const { result } = renderHook(() =>
      useDopesheetViewport({
        itemId: 'item-1',
        totalFrames: 120,
        keyframeFrameBounds: null,
        frameViewport: { startFrame: -240, endFrame: 360 },
        onFrameViewportChange: undefined,
        clampToContent: false,
      }),
    )

    expect(result.current.viewport).toEqual({ startFrame: -240, endFrame: 360 })
  })
})
