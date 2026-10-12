import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createRafCoalescedCallback } from './raf-coalesced-callback'

describe('createRafCoalescedCallback', () => {
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

  it('runs only the latest queued value in an animation frame', () => {
    const values: number[] = []
    const coalesced = createRafCoalescedCallback((value: number) => values.push(value))

    for (let value = 1; value <= 100; value += 1) coalesced.queue(value)

    expect(values).toEqual([])
    expect(rafCallbacks).toHaveLength(1)
    rafCallbacks[0]?.(16)
    expect(values).toEqual([100])
  })

  it('flushes the final queued value before an interaction commits', () => {
    const values: number[] = []
    const coalesced = createRafCoalescedCallback((value: number) => values.push(value))

    coalesced.queue(24)
    coalesced.flush()

    expect(values).toEqual([24])
  })

  it('cancels queued work during cleanup', () => {
    const values: number[] = []
    const coalesced = createRafCoalescedCallback((value: number) => values.push(value))

    coalesced.queue(12)
    coalesced.cancel()
    rafCallbacks[0]?.(16)

    expect(values).toEqual([])
  })
})
