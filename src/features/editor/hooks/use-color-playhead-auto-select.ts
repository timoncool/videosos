import { useEffect } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import type { TimelineItem } from '@/types/timeline'

// Lower value wins — grade the actual footage before overlays sharing the frame.
const GRADE_TYPE_PRIORITY: Record<TimelineItem['type'], number> = {
  video: 0,
  image: 1,
  lottie: 1,
  composition: 2,
  adjustment: 3,
  shape: 4,
  text: 5,
  subtitle: 6,
  controller: Number.POSITIVE_INFINITY,
  audio: Number.POSITIVE_INFINITY,
}

function spansFrame(item: TimelineItem, frame: number): boolean {
  return frame >= item.from && frame < item.from + item.durationInFrames
}

function findGradeTargetAtFrame(frame: number): TimelineItem | null {
  const { items, tracks } = useItemsStore.getState()
  const trackById = new Map(tracks.map((track) => [track.id, track]))

  let best: TimelineItem | null = null
  let bestPriority = Number.POSITIVE_INFINITY
  let bestOrder = Number.POSITIVE_INFINITY
  for (const item of items) {
    if (item.type === 'audio' || !spansFrame(item, frame)) continue
    const track = trackById.get(item.trackId)
    if (!track || track.isGroup || !track.visible) continue
    const priority = GRADE_TYPE_PRIORITY[item.type]
    if (priority < bestPriority || (priority === bestPriority && track.order < bestOrder)) {
      best = item
      bestPriority = priority
      bestOrder = track.order
    }
  }
  return best
}

/**
 * Color-workspace selection follower: keeps a visual clip targeted for
 * grading. When the current selection no longer covers a visual clip under
 * the playhead (selection cleared, clip ended, playhead moved on), the best
 * clip at the current frame is selected automatically. Manual selections of
 * another clip at the same frame are left alone, and the last selection is
 * kept while the playhead sits in a gap.
 */
export function useColorPlayheadAutoSelect(): void {
  useEffect(() => {
    const apply = () => {
      const playback = usePlaybackStore.getState()
      // Defer while a scrub preview is in flight — re-selecting per scrub frame
      // re-renders the grading panels mid-gesture. The previewFrame -> null
      // transition on release triggers the catch-up apply below.
      if (playback.previewFrame !== null) return
      const frame = playback.currentFrame
      const selection = useSelectionStore.getState()
      const { itemById } = useItemsStore.getState()

      const hasGradeTargetSelected = selection.selectedItemIds.some((id) => {
        const item = itemById[id]
        return item && item.type !== 'audio' && spansFrame(item, frame)
      })
      if (hasGradeTargetSelected) return

      const target = findGradeTargetAtFrame(frame)
      if (target) selection.selectItems([target.id])
    }

    apply()

    const unsubscribePlayback = usePlaybackStore.subscribe((state, previous) => {
      if (
        state.currentFrame !== previous.currentFrame ||
        state.previewFrame !== previous.previewFrame
      ) {
        apply()
      }
    })
    const unsubscribeSelection = useSelectionStore.subscribe((state, previous) => {
      if (state.selectedItemIds !== previous.selectedItemIds) apply()
    })
    const unsubscribeItems = useItemsStore.subscribe((state, previous) => {
      if (state.items !== previous.items) apply()
    })
    return () => {
      unsubscribePlayback()
      unsubscribeSelection()
      unsubscribeItems()
    }
  }, [])
}
