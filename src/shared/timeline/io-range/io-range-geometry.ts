import { useCallback, useRef, useState, type RefObject } from 'react'

/**
 * Geometry + shared constants for the in/out (IO) range markers. Kept separate
 * from the component file so fast-refresh stays happy (a module that exports
 * components must not also export plain functions/values).
 */

export const IO_HANDLE_WIDTH = 6
export const IO_HANDLE_COLOR = 'var(--color-timeline-io-handle)'

/**
 * Grip width that avoids the "solid blue block" artifact: when the in/out range
 * collapses to a few pixels wide the two fixed-width side grips would overlap and
 * cover the range bar. Cap each grip to half the range so they meet at the
 * midpoint (a clean pill spanning exactly the range) instead of overlapping.
 * `spanPx === null` (only one point set) renders a full-width grip.
 */
export function computeIoGripWidth(spanPx: number | null, nominal = IO_HANDLE_WIDTH): number {
  if (spanPx === null) return nominal
  return Math.max(0, Math.min(nominal, spanPx / 2))
}

/**
 * Tracks an element's live pixel width (for callers that position via `%`).
 *
 * Attach the returned `measureRef` as the element's `ref` — it's a callback ref,
 * so it fires whenever the element mounts, unmounts, or is replaced. This handles
 * conditionally-rendered targets (e.g. the source monitor's IO strip, which only
 * mounts once an in/out point exists): a plain `useEffect(..., [ref])` attaches
 * the observer only once and would miss a late mount, leaving width stuck at 0.
 * Measuring inside the callback ref (commit phase, before paint) also avoids the
 * first-frame zero-width flash a post-paint effect would show. Pass an optional
 * `ref` to also receive the node for imperative reads (e.g. `getBoundingClientRect`).
 */
export function useMeasuredWidth<T extends HTMLElement>(
  ref?: RefObject<T | null>,
): {
  width: number
  measureRef: (node: T | null) => void
} {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measureRef = useCallback(
    (node: T | null) => {
      if (ref) ref.current = node
      observerRef.current?.disconnect()
      if (!node) {
        observerRef.current = null
        return
      }
      const update = () => setWidth(node.clientWidth)
      update()
      const observer = new ResizeObserver(update)
      observer.observe(node)
      observerRef.current = observer
    },
    [ref],
  )

  return { width, measureRef }
}
