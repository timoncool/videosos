import { useSyncExternalStore } from 'react'

/** Narrower than Tailwind's `lg`: tablets held upright and phones. */
const COMPACT_QUERY = '(max-width: 1023.98px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useCompactLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}
