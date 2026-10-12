export const HYBRID_TIMELINE_TOTAL_ITEM_THRESHOLD = 120
export const HYBRID_TIMELINE_TRACK_ITEM_THRESHOLD = 24

// Profiling budgets for dense interaction work. The browser still owns part
// of every 16.67ms frame, so timeline scripting/layout should stay below half
// of that frame while marquee, scroll, or drag previews are active.
export const HYBRID_TIMELINE_FRAME_BUDGET_MS = 1000 / 60
export const HYBRID_TIMELINE_MAIN_THREAD_BUDGET_MS = 8

export function shouldUseHybridTimelineRenderer({
  totalItemCount,
  trackItemCount,
}: {
  totalItemCount: number
  trackItemCount: number
}): boolean {
  return (
    totalItemCount >= HYBRID_TIMELINE_TOTAL_ITEM_THRESHOLD ||
    trackItemCount >= HYBRID_TIMELINE_TRACK_ITEM_THRESHOLD
  )
}
