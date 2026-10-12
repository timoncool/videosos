import { type ComponentProps, type RefObject } from 'react'
import { TrimInfoOverlay } from './trim-info-overlay'
import { FloatingReadout } from './floating-readout'
import { TrackPushHandle } from './track-push-handle'
import { ToolOperationOverlay } from './tool-operation-overlay'
import { EdgeHalos } from './edge-halos'
import { TransitionDropGhost } from './transition-drop-ghost'
import { FollowerDragGhost } from './drag-ghosts'
import { DragBlockedTooltip } from './drag-blocked-tooltip'
import { TranscribeDialogController } from './transcribe-dialog-controller'
import type { OperationBoundsVisual } from './tool-operation-overlay-utils'
import type { ActiveEdgeState } from './trim-constants'
import type { TimelineItemPointerHint } from './use-timeline-item-pointer-handlers'
import type { ClipTrimInfoLabel } from './use-clip-readout-labels'
import type { CaptionDialogState } from './use-caption-dialog-state'

interface ClipFloatingLayerProps {
  transformRef: RefObject<HTMLDivElement | null>
  ghostRef: RefObject<HTMLDivElement | null>
  showFollowerDragGhost: boolean
  visualLeftFrame: number
  visualWidthFrames: number
  dragOffset: { x: number; y: number }
  trimInfoLabel: ClipTrimInfoLabel | null
  moveInfoLabel: string | null
  trackPushEnabled: boolean
  isTrackPushActive: boolean
  trackPushClipLeftStyle: string
  trackPushZoneStyle: string
  onTrackPushStart: (e: React.MouseEvent) => void
  toolOperationOverlay: OperationBoundsVisual | null
  activeEdges: ActiveEdgeState | null
  transitionDropGhost: { left: number; width: number; cutOffset: number } | null
  left: number
  width: number
  pointerHint: TimelineItemPointerHint | null
  itemMediaId: string | undefined
  hasGeneratedCaptions: boolean
  caption: CaptionDialogState
  onGenerateCaption: ComponentProps<typeof TranscribeDialogController>['onGenerate']
}

/**
 * Overlays that anchor to a timeline clip but render as siblings outside its
 * `contain: paint` box: trim/move readouts, the track-push affordance, the
 * tool-operation bounds box, edge halos, the transition drop ghost, alt-drag
 * ghosts, the drag-blocked tooltip, and the transcription dialog controller.
 */
export function ClipFloatingLayer({
  transformRef,
  ghostRef,
  showFollowerDragGhost,
  visualLeftFrame,
  visualWidthFrames,
  dragOffset,
  trimInfoLabel,
  moveInfoLabel,
  trackPushEnabled,
  isTrackPushActive,
  trackPushClipLeftStyle,
  trackPushZoneStyle,
  onTrackPushStart,
  toolOperationOverlay,
  activeEdges,
  transitionDropGhost,
  left,
  width,
  pointerHint,
  itemMediaId,
  hasGeneratedCaptions,
  caption,
  onGenerateCaption,
}: ClipFloatingLayerProps) {
  return (
    <>
      {trimInfoLabel && (
        <TrimInfoOverlay
          anchorRef={transformRef}
          side={trimInfoLabel.side}
          delta={trimInfoLabel.delta}
          duration={trimInfoLabel.duration}
          measureKey={`${visualLeftFrame}:${visualWidthFrames}:${trimInfoLabel.side}:${trimInfoLabel.delta}:${trimInfoLabel.duration}`}
        />
      )}

      {moveInfoLabel && (
        <FloatingReadout
          anchorRef={transformRef}
          measureKey={`move:${dragOffset.x}:${dragOffset.y}:${moveInfoLabel}`}
          offsetY={6}
        >
          {moveInfoLabel}
        </FloatingReadout>
      )}

      {/* Track push handle - sits in the gap to the LEFT of the clip, outside contain:paint */}
      <TrackPushHandle
        enabled={trackPushEnabled}
        isActive={isTrackPushActive}
        clipLeftStyle={trackPushClipLeftStyle}
        zoneStyle={trackPushZoneStyle}
        onMouseDown={onTrackPushStart}
      />

      <ToolOperationOverlay visual={toolOperationOverlay} />

      {/* Active edge halos - top layer, above both clip and bounds box */}
      <EdgeHalos
        activeEdges={activeEdges}
        visualLeftFrame={visualLeftFrame}
        visualWidthFrames={visualWidthFrames}
      />

      <TransitionDropGhost ghost={transitionDropGhost} />

      {/* Alt-drag ghosts */}
      {showFollowerDragGhost && <FollowerDragGhost ref={ghostRef} left={left} width={width} />}

      <DragBlockedTooltip hint={pointerHint} />
      <TranscribeDialogController
        itemMediaId={itemMediaId}
        hasGeneratedCaptions={hasGeneratedCaptions}
        caption={caption}
        onGenerate={onGenerateCaption}
      />
    </>
  )
}
