import type { TimelineItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { pixelsToTimeNow } from '../utils/zoom-conversions'
import { useSnapCalculator } from './use-snap-calculator'

type SelectionState = ReturnType<typeof useSelectionStore.getState>

export type DragInteractionPreamble = ReturnType<typeof useSnapCalculator> & {
  pixelsToTime: typeof pixelsToTimeNow
  fps: number
  setDragState: SelectionState['setDragState']
  setActiveSnapTarget: SelectionState['setActiveSnapTarget']
}

/**
 * Shared preamble for pointer-drag item hooks (trim, slip/slide, track push).
 * Subscribes to the stable selection actions plus fps, and wires the magnetic
 * snap calculator for the dragged item.
 */
export function useDragInteractionPreamble(
  item: TimelineItem,
  timelineDuration: number,
): DragInteractionPreamble {
  const pixelsToTime = pixelsToTimeNow
  const fps = useTimelineSettingsStore((s) => s.fps)
  const setDragState = useSelectionStore((s) => s.setDragState)
  const setActiveSnapTarget = useSelectionStore((s) => s.setActiveSnapTarget)
  const snap = useSnapCalculator(timelineDuration, item.id)
  return { pixelsToTime, fps, setDragState, setActiveSnapTarget, ...snap }
}
