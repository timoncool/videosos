/**
 * The frame the in/out range may not pass, for whichever timeline is loaded.
 *
 * Kept in its own leaf module (domain stores + the pure in/out utils only) so the
 * action layer, the store facade and undo/redo snapshot restore can all share one
 * rule without importing each other.
 */

import type { TimelineItem } from '@/types/timeline'
import { getActiveCompositionId } from './composition-navigation-active'
import { useCompositionsStore } from './compositions-store'
import { useItemsStore } from './items-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { getCompositionMaxFrame, getEffectiveTimelineMaxFrame } from '../utils/in-out-points'

/**
 * A composition's authored range while one is open (Motion, or a drilled compound
 * clip), else the Main-timeline rule. Bounding a comp by Main's rule — content
 * extent with a 10s floor — both refuses the tail of a comp whose canvas outlasts
 * its layers and allows marking past the end of a comp shorter than the floor.
 *
 * `items` / `fps` accept values a caller is about to commit, for sanitizing
 * against pending state rather than what the stores currently hold.
 */
export function getActiveInOutMaxFrame(items?: TimelineItem[], fps?: number): number {
  const activeCompositionId = getActiveCompositionId()

  if (activeCompositionId !== null) {
    const composition = useCompositionsStore.getState().getComposition(activeCompositionId)
    if (composition) {
      return getCompositionMaxFrame(composition.durationInFrames)
    }
  }

  return getEffectiveTimelineMaxFrame(
    items ?? useItemsStore.getState().items,
    fps ?? useTimelineSettingsStore.getState().fps,
  )
}
