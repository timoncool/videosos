import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Observes an element's client size via ResizeObserver, returning the latest
 * dimensions. Re-runs when `enabled` flips or when extra dependencies change.
 *
 * `null` is returned for the ref while the element is unmounted; the size
 * then falls back to `{ width: 0, height: 0 }` so callers don't need to
 * guard against undefined.
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  options: { enabled?: boolean; deps?: ReadonlyArray<unknown> } = {},
): ElementSize {
  const { enabled = true, deps = [] } = options
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    if (!enabled) return
    const node = ref.current
    if (!node) return

    const update = () => {
      setSize({ width: node.clientWidth, height: node.clientHeight })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ref, ...deps])

  return size
}
