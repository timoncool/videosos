/**
 * Imperative gesture state shared by the Edit timeline and its keyframe sheet.
 *
 * This intentionally is not React state: both playheads already follow the
 * playback store directly during a scrub, so publishing a render per pointer
 * frame would only add work to the hot path.
 */
export const mainTimelineScrubActiveRef = { current: false }

type TimelineSkimmerScrubOwner = object
type TimelineSkimmerScrubListener = () => void

const timelineSkimmerScrubOwners = new Set<TimelineSkimmerScrubOwner>()
const timelineSkimmerScrubListeners = new Set<TimelineSkimmerScrubListener>()

/** Reactive imperative signal for any linked scrub that owns the cursor visual. */
export const timelineSkimmerScrubSignal = {
  get current(): boolean {
    return timelineSkimmerScrubOwners.size > 0
  },
  subscribe(listener: TimelineSkimmerScrubListener): () => void {
    timelineSkimmerScrubListeners.add(listener)
    return () => timelineSkimmerScrubListeners.delete(listener)
  },
}

function publishTimelineSkimmerScrubChange(wasActive: boolean): void {
  if (wasActive === timelineSkimmerScrubSignal.current) return
  for (const listener of timelineSkimmerScrubListeners) listener()
}

export function beginTimelineSkimmerScrub(owner: TimelineSkimmerScrubOwner): void {
  const wasActive = timelineSkimmerScrubSignal.current
  timelineSkimmerScrubOwners.add(owner)
  publishTimelineSkimmerScrubChange(wasActive)
}

export function endTimelineSkimmerScrub(owner: TimelineSkimmerScrubOwner): void {
  const wasActive = timelineSkimmerScrubSignal.current
  timelineSkimmerScrubOwners.delete(owner)
  publishTimelineSkimmerScrubChange(wasActive)
}

export function resetTimelineSkimmerScrubForTest(): void {
  const wasActive = timelineSkimmerScrubSignal.current
  timelineSkimmerScrubOwners.clear()
  publishTimelineSkimmerScrubChange(wasActive)
}

/** Final global frame retained until the linked editor's props catch up. */
export const mainTimelineScrubHandoffFrameRef: { current: number | null } = {
  current: null,
}
