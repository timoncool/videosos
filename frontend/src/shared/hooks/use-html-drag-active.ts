import { useSyncExternalStore } from 'react'

let active = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (active === next) return
  active = next
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  if (listeners.size === 0) {
    document.addEventListener('dragstart', start, true)
    document.addEventListener('dragend', end, true)
    document.addEventListener('drop', end, true)
  }
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      document.removeEventListener('dragstart', start, true)
      document.removeEventListener('dragend', end, true)
      document.removeEventListener('drop', end, true)
    }
  }
}

function start() {
  set(true)
}

function end() {
  set(false)
}

/** Whether a drag and drop of the page (a library card, a file) is under way. */
export function useHtmlDragActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => false,
  )
}
