import { useCallback, useEffect, useRef } from 'react'

/**
 * Limits high-frequency input (wheel, pointer move) to one React update per
 * painted frame while always committing the newest value.
 */
export function useRafCoalescedValue<T>(onValue: (value: T) => void) {
  const onValueRef = useRef(onValue)
  const pendingRef = useRef<T | undefined>(undefined)
  const hasPendingRef = useRef(false)
  const rafIdRef = useRef<number | null>(null)

  onValueRef.current = onValue

  const flush = useCallback(() => {
    rafIdRef.current = null
    const pending = pendingRef.current
    const hasPending = hasPendingRef.current
    pendingRef.current = undefined
    hasPendingRef.current = false
    if (hasPending) onValueRef.current(pending as T)
  }, [])

  const queue = useCallback(
    (value: T) => {
      pendingRef.current = value
      hasPendingRef.current = true
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flush)
      }
    },
    [flush],
  )

  const flushNow = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    flush()
  }, [flush])

  const cancel = useCallback(() => {
    pendingRef.current = undefined
    hasPendingRef.current = false
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
  }, [])

  useEffect(() => cancel, [cancel])

  return { queue, flushNow, cancel }
}
