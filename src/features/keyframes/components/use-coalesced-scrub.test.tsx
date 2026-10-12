import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useCoalescedScrub } from './use-coalesced-scrub'

describe('useCoalescedScrub', () => {
  let rafCallbacks: FrameRequestCallback[]
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rafCallbacks = []
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
  })

  afterEach(() => {
    nowSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('commits the first scrub immediately and coalesces moves to the latest RAF frame', () => {
    const calls: number[] = []
    const { result } = renderHook(() => useCoalescedScrub((frame) => calls.push(frame)))

    act(() => {
      result.current.startScrub({ frame: 0, pointerX: 0, pixelsPerSecond: 300 })
      result.current.queueScrub({ frame: 4, pointerX: 40, pixelsPerSecond: 300 })
      result.current.queueScrub({ frame: 10, pointerX: 100, pixelsPerSecond: 300 })
    })

    expect(calls).toEqual([0])
    expect(rafCallbacks).toHaveLength(1)

    act(() => {
      rafCallbacks[0]?.(16)
    })

    expect(calls).toEqual([0, 10])
  })

  it('can force-flush the final queued scrub frame on pointer release', () => {
    const calls: number[] = []
    const { result } = renderHook(() => useCoalescedScrub((frame) => calls.push(frame)))

    act(() => {
      result.current.startScrub({ frame: 12, pointerX: 12, pixelsPerSecond: 30 })
      result.current.queueScrub({ frame: 13, pointerX: 13, pixelsPerSecond: 30 })
      result.current.flushPendingScrub(true)
    })

    expect(calls).toEqual([12, 13])
  })

  it('proves high-frequency pointer moves collapse to one frame per RAF', () => {
    const directCallCount = 1 + 120
    const calls: number[] = []
    const { result } = renderHook(() => useCoalescedScrub((frame) => calls.push(frame)))

    act(() => {
      result.current.startScrub({ frame: 0, pointerX: 0, pixelsPerSecond: 240 })
      for (let frame = 1; frame <= 120; frame += 1) {
        result.current.queueScrub({
          frame,
          pointerX: frame * 4,
          pixelsPerSecond: 240,
        })
      }
    })

    expect(calls).toHaveLength(1)
    expect(rafCallbacks).toHaveLength(1)

    act(() => {
      rafCallbacks[0]?.(16)
    })

    expect(calls).toEqual([0, 120])
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(directCallCount * 0.03))
  })
})
