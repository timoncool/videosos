import type { TimelineItem } from '@/types/timeline'

export interface MediaRelinkingTimelineActions {
  updateProjectItem: (itemId: string, updates: Partial<TimelineItem>) => boolean
  removeProjectItems: (itemIds: string[]) => boolean
  getItemsState: () => {
    items: TimelineItem[]
    itemById: Record<string, TimelineItem | undefined>
  }
  getFps: () => number
  getSynchronizedLinkedItems: (items: TimelineItem[], itemId: string) => TimelineItem[]
}

let timelineActions: MediaRelinkingTimelineActions | null = null

export function registerMediaRelinkingTimelineActions(
  actions: MediaRelinkingTimelineActions,
): () => void {
  timelineActions = actions
  return () => {
    if (timelineActions === actions) {
      timelineActions = null
    }
  }
}

export function getMediaRelinkingTimelineActions(): MediaRelinkingTimelineActions | null {
  return timelineActions
}
