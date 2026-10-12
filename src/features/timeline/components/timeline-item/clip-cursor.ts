import type { TimelineItem } from '@/types/timeline'
import type { SelectionState } from '@/shared/state/selection'
import type { SmartTrimIntent, SmartBodyIntent } from '../../utils/smart-trim-zones'

type ActiveTool = SelectionState['activeTool']

export interface ClipCursorInput {
  trackLocked: boolean
  activeTool: ActiveTool
  smartTrimIntent: SmartTrimIntent | null
  smartBodyIntent: SmartBodyIntent
  hoveredEdge: 'start' | 'end' | null
  itemType: TimelineItem['type']
  isBeingDragged: boolean
}

const SLIP_SLIDE_ITEM_TYPES: ReadonlySet<TimelineItem['type']> = new Set([
  'video',
  'audio',
  'composition',
])

/**
 * Resolve the Tailwind cursor class for a timeline clip given the active tool and
 * the current smart-trim / smart-body hover intent.
 *
 * Branch order is significant and mirrors the original inline ternary in
 * `TimelineItem` exactly — edge intents win over body intents, which win over the
 * tool-default cursors. Keep this behaviour-preserving when editing.
 */
export function getClipCursorClass({
  trackLocked,
  activeTool,
  smartTrimIntent,
  smartBodyIntent,
  hoveredEdge,
  itemType,
  isBeingDragged,
}: ClipCursorInput): string {
  if (trackLocked) return 'cursor-not-allowed opacity-60'
  if (activeTool === 'razor') return 'cursor-scissors'

  const isTrimOrSelect = activeTool === 'trim-edit' || activeTool === 'select'
  if (isTrimOrSelect) {
    switch (smartTrimIntent) {
      case 'roll-start':
      case 'roll-end':
        return 'cursor-trim-center'
      case 'ripple-start':
        return 'cursor-ripple-left'
      case 'ripple-end':
        return 'cursor-ripple-right'
      case 'trim-start':
        return 'cursor-trim-left'
      case 'trim-end':
        return 'cursor-trim-right'
    }
  }

  if (activeTool === 'trim-edit') {
    if (smartBodyIntent === 'slide-body') return 'cursor-slide-smart'
    if (smartBodyIntent === 'slip-body') return 'cursor-slip-smart'
    if (smartBodyIntent !== null) return 'cursor-ew-resize'
    if (hoveredEdge !== null) return 'cursor-ew-resize'
  }

  if (activeTool === 'rate-stretch') return 'cursor-gauge'

  if (activeTool === 'slip' || activeTool === 'slide') {
    return SLIP_SLIDE_ITEM_TYPES.has(itemType) ? 'cursor-ew-resize' : 'cursor-not-allowed'
  }

  if (isBeingDragged) return 'cursor-grabbing'
  return 'cursor-default'
}
