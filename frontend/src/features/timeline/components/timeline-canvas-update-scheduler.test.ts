import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  _resetTimelineCanvasUpdateSchedulerForTest,
  cancelTimelineCanvasUpdate,
  scheduleTimelineCanvasUpdate,
} from './timeline-canvas-update-scheduler'

describe('timeline canvas update scheduler', () => {
  let callbacks: FrameRequestCallback[]

  beforeEach(() => {
    callbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    _resetTimelineCanvasUpdateSchedulerForTest()
  })

  it('coalesces a burst by key and runs the latest callback on the next frame', () => {
    const key = {}
    const first = vi.fn()
    const latest = vi.fn()

    scheduleTimelineCanvasUpdate(key, first)
    scheduleTimelineCanvasUpdate(key, latest)
    expect(callbacks).toHaveLength(1)

    callbacks.shift()!(10)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
  })

  it('retains pending work until its sharp redraw interval is available', () => {
    const key = {}
    const first = vi.fn()
    const second = vi.fn()

    scheduleTimelineCanvasUpdate(key, first, 32)
    callbacks.shift()!(10)
    scheduleTimelineCanvasUpdate(key, second, 32)
    callbacks.shift()!(26)
    expect(second).not.toHaveBeenCalled()
    callbacks.shift()!(43)
    expect(second).toHaveBeenCalledOnce()
  })

  it('cancels a lane without running its pending callback', () => {
    const key = {}
    const update = vi.fn()
    scheduleTimelineCanvasUpdate(key, update)
    cancelTimelineCanvasUpdate(key)

    expect(update).not.toHaveBeenCalled()
    expect(cancelAnimationFrame).toHaveBeenCalledOnce()
  })
})
