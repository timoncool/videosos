import { useEffect, useState, type RefObject } from 'react'

/**
 * Observe an element's natural (content) height while `enabled`, via a
 * ResizeObserver. Used to drive height-morph animations (settings/shortcut
 * dialogs) from the active content's size.
 *
 * The observed element is expected to live inside a scroll viewport or an
 * `overflow-hidden` animated wrapper, so its `clientHeight` stays the true
 * content height even when the wrapper around it is clamped or scrolling —
 * there's no measurement feedback loop.
 */
export function useNaturalHeight(ref: RefObject<HTMLElement | null>, enabled = true): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const node = ref.current
    if (!node) return
    const update = () => setHeight(node.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, ref])
  return height
}
