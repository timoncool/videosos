import { TimelinePreviewScrubberVisual } from '@/shared/ui/timeline-preview-scrubber-visual'
import { timelineSkimmerScrubSignal } from '@/shared/timeline/main-timeline-scrub'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'
import { frameToPixelsNow } from '../utils/zoom-conversions'
import { IO_LANE_HEIGHT } from './timeline-markers'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'

const MAIN_TIMELINE_SKIMMER_SUPPRESS_REFS = [previewScrubberSuppressRef]
const timelinePreviewScrubberZoomSignal = {
  subscribe(listener: () => void): () => void {
    return useZoomStore.subscribe((state, previousState) => {
      if (state.pixelsPerSecond !== previousState.pixelsPerSecond) listener()
    })
  },
}

interface TimelinePreviewScrubberProps {
  inRuler?: boolean
  maxFrame?: number
  zIndex?: number
}

/** Main timeline adapter for the shared preview scrubber visual. */
export function TimelinePreviewScrubber({
  inRuler = false,
  maxFrame,
  zIndex,
}: TimelinePreviewScrubberProps) {
  const fps = useTimelineSettingsStore((state) => state.fps)

  return (
    <TimelinePreviewScrubberVisual
      frameToPixels={frameToPixelsNow}
      fps={fps}
      inRuler={inRuler}
      maxFrame={maxFrame}
      rulerOffset={IO_LANE_HEIGHT}
      repositionSignal={timelinePreviewScrubberZoomSignal}
      suppressRefs={MAIN_TIMELINE_SKIMMER_SUPPRESS_REFS}
      suppressSignal={timelineSkimmerScrubSignal}
      zIndex={zIndex}
    />
  )
}
