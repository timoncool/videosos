import type { RefObject } from 'react'
import { DopesheetPlayheadLine } from './dopesheet-playhead-line'
import { TimelinePreviewScrubberVisual } from '@/shared/ui/timeline-preview-scrubber-visual'
import { timelineSkimmerScrubSignal } from '@/shared/timeline/main-timeline-scrub'

export interface DopesheetPlayheadOverlayProps {
  variant: 'sheet' | 'split' | 'skim'
  left: number
  playheadFrame?: number
  currentFrame: number
  itemFrom: number
  totalFrames: number
  clampToItemBounds: boolean
  followPreviewFrame: boolean
  localScrubActiveRef: RefObject<boolean>
  localScrubHandoffFrameRef: RefObject<number | null>
  frameToX: (frame: number) => number
  globalFrameToX?: (globalFrame: number) => number
  positionSyncTargetRef?: RefObject<HTMLDivElement | null>
  maxLeft: number
  fps: number
  isRulerScrubbing: boolean
}

/**
 * Playhead overlay for a dopesheet pane. `sheet`/`split` share the GPU playhead
 * line (differing only in stacking/positioning); `skim` shows the preview
 * scrubber visual instead.
 */
export function DopesheetPlayheadOverlay({
  variant,
  left,
  playheadFrame,
  currentFrame,
  itemFrom,
  totalFrames,
  clampToItemBounds,
  followPreviewFrame,
  localScrubActiveRef,
  localScrubHandoffFrameRef,
  frameToX,
  globalFrameToX,
  positionSyncTargetRef,
  maxLeft,
  fps,
  isRulerScrubbing,
}: DopesheetPlayheadOverlayProps) {
  if (variant === 'skim') {
    return (
      <div
        className="pointer-events-none absolute bottom-0 right-0 top-0 z-[19] overflow-hidden"
        style={{ left }}
      >
        <TimelinePreviewScrubberVisual
          frameToPixels={globalFrameToX ?? ((globalFrame) => frameToX(globalFrame - itemFrom))}
          fps={fps}
          inRuler
          rulerOffset={0}
          showTooltip={false}
          suppressed={isRulerScrubbing}
          suppressRefs={[localScrubActiveRef]}
          suppressSignal={timelineSkimmerScrubSignal}
          positionSyncTargetRef={positionSyncTargetRef}
        />
      </div>
    )
  }
  const isSplit = variant === 'split'
  return (
    <div
      data-testid="dopesheet-playhead-clip"
      className={
        isSplit
          ? 'absolute top-0 right-0 bottom-0 overflow-hidden pointer-events-none z-30'
          : 'absolute top-0 bottom-0 right-0 overflow-hidden pointer-events-none z-20'
      }
      style={{ left }}
    >
      <DopesheetPlayheadLine
        relativeFrame={playheadFrame ?? currentFrame}
        itemFrom={itemFrom}
        totalFrames={totalFrames}
        clampToItemBounds={clampToItemBounds}
        followPreviewFrame={followPreviewFrame}
        localScrubActiveRef={localScrubActiveRef}
        localScrubHandoffFrameRef={localScrubHandoffFrameRef}
        frameToX={frameToX}
        globalFrameToX={globalFrameToX}
        positionSyncTargetRef={positionSyncTargetRef}
        maxLeft={maxLeft}
        className="absolute top-0 bottom-0"
      />
    </div>
  )
}
