import { startTransition, useEffect, useRef, useState } from 'react'

/**
 * Keeps a high-cost consumer on its last committed value until the next frame.
 *
 * `useDeferredValue` can still flush its follow-up render in the same microtask
 * as a synchronous external-store update. Scheduling the handoff through rAF
 * guarantees pointerup can finish first, while the transition keeps the later
 * render interruptible.
 *
 * This hook must live below, not beside, a `useSyncExternalStore`/Zustand
 * subscription. React promotes pending concurrent work on a fiber whose store
 * snapshot changes; keeping the bridge and deferred boundary on separate
 * fibers prevents a later store commit from pulling the expensive consumer
 * back into the synchronous input task.
 */
export function useRafDeferredValue<T>(value: T): T {
  const [deferredValue, setDeferredValue] = useState(value)
  const latestValueRef = useRef(value)
  latestValueRef.current = value

  useEffect(() => {
    if (Object.is(deferredValue, value)) return

    const rafId = requestAnimationFrame(() => {
      startTransition(() => {
        setDeferredValue(latestValueRef.current)
      })
    })

    return () => cancelAnimationFrame(rafId)
  }, [deferredValue, value])

  return deferredValue
}
