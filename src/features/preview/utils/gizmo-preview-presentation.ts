import type { TimelineItem } from '@/types/timeline'

/**
 * Vector content already responds to gizmo preview state in the DOM Player.
 * Prefer that live path during drags instead of repainting an occluding scrub
 * canvas for every pointer update. Forced rendered effects keep canvas ownership.
 */
export function shouldPreferDomPlayerForGizmo(
  forceRenderedOverlay: boolean,
  itemType: TimelineItem['type'] | null | undefined,
): boolean {
  // Shape/text content has a responsive live DOM presentation, but that path
  // cannot show effects belonging to any other visible layer. Keep the
  // composited canvas in charge when rendered content is active; otherwise use
  // the lightweight DOM path for direct manipulation.
  return !forceRenderedOverlay && (itemType === 'text' || itemType === 'shape')
}
