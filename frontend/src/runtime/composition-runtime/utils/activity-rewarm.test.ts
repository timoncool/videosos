import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { subscribeToWarmupActivity } from './activity-rewarm'

describe('subscribeToWarmupActivity', () => {
  let unsubscribe: (() => void) | null = null
  let nowSpy: ReturnType<typeof vi.spyOn> | null = null

  function mockNow(ms: number) {
    nowSpy?.mockRestore()
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(ms)
  }

  afterEach(() => {
    unsubscribe?.()
    unsubscribe = null
    nowSpy?.mockRestore()
    nowSpy = null
  })

  it('fires on the first input after the idle threshold, not on continuous input', () => {
    const callback = vi.fn()
    mockNow(0)
    unsubscribe = subscribeToWarmupActivity(callback)

    // Input shortly after subscribing — user was never idle.
    mockNow(1_000)
    window.dispatchEvent(new Event('pointermove'))
    expect(callback).not.toHaveBeenCalled()

    // Input after the 10s idle threshold — fires once.
    mockNow(12_000)
    window.dispatchEvent(new Event('pointermove'))
    expect(callback).toHaveBeenCalledTimes(1)

    // Immediate follow-up input — no longer idle, no second fire.
    mockNow(12_100)
    window.dispatchEvent(new Event('keydown'))
    expect(callback).toHaveBeenCalledTimes(1)

    // Another idle stretch — fires again.
    mockNow(30_000)
    window.dispatchEvent(new Event('pointerdown'))
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('fires when the document becomes visible regardless of idle time', () => {
    const callback = vi.fn()
    mockNow(0)
    unsubscribe = subscribeToWarmupActivity(callback)

    mockNow(500)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('stops firing after unsubscribe', () => {
    const callback = vi.fn()
    mockNow(0)
    unsubscribe = subscribeToWarmupActivity(callback)
    unsubscribe()
    unsubscribe = null

    mockNow(20_000)
    window.dispatchEvent(new Event('pointermove'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(callback).not.toHaveBeenCalled()
  })

  it('supports multiple subscribers', () => {
    const a = vi.fn()
    const b = vi.fn()
    mockNow(0)
    unsubscribe = subscribeToWarmupActivity(a)
    const unsubB = subscribeToWarmupActivity(b)

    mockNow(15_000)
    window.dispatchEvent(new Event('pointermove'))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    unsubB()
    mockNow(30_000)
    window.dispatchEvent(new Event('pointermove'))
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
