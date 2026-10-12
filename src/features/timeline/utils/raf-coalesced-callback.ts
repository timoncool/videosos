export interface RafCoalescedCallback<T> {
  queue: (value: T) => void
  flush: () => void
  cancel: () => void
}

/**
 * Coalesces a high-frequency browser event stream to the newest value once per
 * painted frame. `flush` synchronously applies the final queued value before an
 * interaction commits on pointer release.
 */
export function createRafCoalescedCallback<T>(
  callback: (value: T) => void,
): RafCoalescedCallback<T> {
  let pending: T | null = null
  let rafId: number | null = null

  const run = () => {
    rafId = null
    const value = pending
    pending = null
    if (value !== null) callback(value)
  }

  const cancel = () => {
    pending = null
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return {
    queue(value) {
      pending = value
      if (rafId === null) rafId = requestAnimationFrame(run)
    },
    flush() {
      if (rafId !== null) cancelAnimationFrame(rafId)
      run()
    },
    cancel,
  }
}
