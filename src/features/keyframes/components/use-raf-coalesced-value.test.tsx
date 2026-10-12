import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useRafCoalescedValue } from './use-raf-coalesced-value'

describe('useRafCoalescedValue', () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('collapses high-frequency values to the latest value in the next frame', () => {
    const values: number[] = []
    const { result } = renderHook(() => useRafCoalescedValue((value: number) => values.push(value)))

    act(() => {
      for (let value = 1; value <= 100; value += 1) result.current.queue(value)
    })

    expect(values).toEqual([])
    expect(rafCallbacks).toHaveLength(1)

    act(() => rafCallbacks[0]?.(16))
    expect(values).toEqual([100])
  })

  it('flushes the final value when an interaction ends', () => {
    const values: number[] = []
    const { result } = renderHook(() => useRafCoalescedValue((value: number) => values.push(value)))

    act(() => {
      result.current.queue(42)
      result.current.flushNow()
    })

    expect(values).toEqual([42])
  })

  it('drops a queued value when an interaction is cancelled', () => {
    const values: number[] = []
    const { result } = renderHook(() => useRafCoalescedValue((value: number) => values.push(value)))

    act(() => {
      result.current.queue(42)
      result.current.cancel()
    })

    act(() => rafCallbacks[0]?.(16))
    expect(values).toEqual([])
  })

  it('delivers null when null is the newest queued value', () => {
    const values: Array<number | null> = []
    const { result } = renderHook(() =>
      useRafCoalescedValue<number | null>((value) => values.push(value)),
    )

    act(() => {
      result.current.queue(42)
      result.current.queue(null)
      rafCallbacks[0]?.(16)
    })

    expect(values).toEqual([null])
  })
})
