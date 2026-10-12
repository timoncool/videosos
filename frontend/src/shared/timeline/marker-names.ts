import type { ProjectMarker } from '@/types/timeline'

/**
 * Display naming for project markers.
 *
 * A marker's `label` is usually empty. Every surface that shows a marker
 * (ruler tooltip, marker list, mini timeline) falls back to an ordinal name —
 * "Marker 1", "Marker 2", … — numbered left-to-right along the timeline. The
 * ordinal is derived, never stored, so inserting a marker earlier renumbers
 * the ones after it.
 */

/** Ties on frame break on id so stacked markers keep a stable order. */
function sortForDisplay(markers: readonly ProjectMarker[]): ProjectMarker[] {
  return [...markers].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
}

/** Maps marker id to its 1-based position along the timeline. */
export function getMarkerOrdinals(markers: readonly ProjectMarker[]): Map<string, number> {
  const ordinals = new Map<string, number>()
  sortForDisplay(markers).forEach((marker, index) => ordinals.set(marker.id, index + 1))
  return ordinals
}

/**
 * Maps marker id to the name to display: its label, or the ordinal fallback.
 * `formatDefault` receives the ordinal so callers pass their own translated
 * "Marker {{index}}" string.
 */
export function resolveMarkerNames(
  markers: readonly ProjectMarker[],
  formatDefault: (ordinal: number) => string,
): Map<string, string> {
  const names = new Map<string, string>()
  sortForDisplay(markers).forEach((marker, index) => {
    names.set(marker.id, marker.label?.trim() || formatDefault(index + 1))
  })
  return names
}
