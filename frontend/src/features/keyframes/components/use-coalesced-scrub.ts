import { useCallback, useEffect, useRef } from 'react'
import { createScrubThrottleState, shouldCommitScrubFrame } from '@/shared/utils/scrub-throttle'

interface ScrubCommit {
  frame: number
  pointerX: number
  pixelsPerSecond: number
}

export function useCoalescedScrub(onScrub: ((frame: number) => void) | undefined) {
  const onScrubRef = useRef(onScrub)
  const rafIdRef = useRef<number | null>(null)
  const pendingRef = useRef<ScrubCommit | null>(null)
  const throttleStateRef = useRef(createScrubThrottleState())

  useEffect(() => {
    onScrubRef.current = onScrub
  }, [onScrub])

  const cancelPendingScrub = useCallback(() => {
    pendingRef.current = null
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
  }, [])

  const flushPendingScrub = useCallback((force = false) => {
    rafIdRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return

    if (
      force ||
      shouldCommitScrubFrame({
        state: throttleStateRef.current,
        pointerX: pending.pointerX,
        targetFrame: pending.frame,
        pixelsPerSecond: pending.pixelsPerSecond,
        nowMs: performance.now(),
      })
    ) {
      onScrubRef.current?.(pending.frame)
    }
  }, [])

  const startScrub = useCallback(
    (commit: ScrubCommit) => {
      cancelPendingScrub()
      throttleStateRef.current = createScrubThrottleState({
        pointerX: commit.pointerX,
        frame: commit.frame,
        nowMs: performance.now(),
      })
      onScrubRef.current?.(commit.frame)
    },
    [cancelPendingScrub],
  )

  const queueScrub = useCallback(
    (commit: ScrubCommit) => {
      pendingRef.current = commit
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => flushPendingScrub())
      }
    },
    [flushPendingScrub],
  )

  useEffect(() => cancelPendingScrub, [cancelPendingScrub])

  return { startScrub, queueScrub, flushPendingScrub, cancelPendingScrub }
}
