/**
 * Safari has no requestIdleCallback, and the editor schedules its deferred work with it; without this the editor
 * fails to open there. Runs before any other module.
 */
if (typeof window !== 'undefined' && typeof window.requestIdleCallback !== 'function') {
  const BUDGET_MS = 50
  window.requestIdleCallback = (callback: IdleRequestCallback, options?: IdleRequestOptions) => {
    const start = performance.now()
    return window.setTimeout(
      () =>
        callback({
          didTimeout: options?.timeout !== undefined && performance.now() - start >= options.timeout,
          timeRemaining: () => Math.max(0, BUDGET_MS - (performance.now() - start)),
        }),
      1,
    )
  }
  window.cancelIdleCallback = (handle: number) => window.clearTimeout(handle)
}

export {}
