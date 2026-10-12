import {
  shouldPreservePausedTransportPresentation,
  shouldProbePreviewSourcePixels,
  shouldRejectBlankReleasedScrubHandoff,
  shouldRejectBlankTransportHandoff,
} from './render-pump-frame-plan'
import {
  drawSourceToPreviewDisplayCanvas,
  type CommittedPreviewSnapshotState,
} from './preview-display-canvas'

const BLANK_PROBE_SIZE_PX = 8
/** A probe whose summed RGB stays at or below this is treated as blank. */
const BLANK_PROBE_RGB_TOTAL = 8

export interface PreviewPresentationGateDeps {
  /** Display canvas frames are presented on; null while unmounted. */
  getDisplayCanvas: () => HTMLCanvasElement | null
  /** Frame the preview bridge considers displayed. */
  getDisplayedFrame: () => number | null
  getPlaybackState: () => {
    currentFrame: number
    previewFrame: number | null
    isPlaying: boolean
  }
  /** Whether the fast-scrub canvas is the visible presentation. */
  isDisplayVisible: () => boolean
  /**
   * The released-scrub guard snapshot. Mutated in place, and shared with the
   * scrub-target router, so the same object must be handed back every call.
   */
  getCommittedSnapshot: () => CommittedPreviewSnapshotState
  /** The scrub offscreen surface the rendered frames come from. */
  getOffscreenCanvas: () => OffscreenCanvas | null
  /** Drops a rejected offscreen render instead of presenting it. */
  discardOffscreenRender: (
    source: OffscreenCanvas | HTMLCanvasElement,
    renderedFrame: number,
    options: { invalidateCache: boolean },
  ) => void
  getPausedTransportHold: () => { heldFrame: number | null; holdUntilMs: number }
  /** Timestamp until which a freshly settled transport keeps its presentation. */
  getTransportSettlingUntilMs: () => number
  setDisplayedFrame: (frame: number) => void
  recordPresentation: (frame: number, usedFallback: boolean) => void
  settleActiveRenderTarget: (frame: number) => void
  markColdStartVisibleFrame: (frame: number) => void
}

export interface PreviewPresentationGate {
  captureCommittedSnapshot: (frame: number) => void
  clearReleasedScrubGuard: () => void
  drawToDisplay: (renderedFrame: number, usedFallback?: boolean) => void
  drawSourceToDisplay: (
    source: OffscreenCanvas | HTMLCanvasElement,
    renderedFrame: number,
    usedFallback?: boolean,
  ) => void
  /** Pixel probe used by the pump's own blank-frame rejection rules. */
  isEffectivelyBlankPreviewSource: (source: OffscreenCanvas | HTMLCanvasElement) => boolean
}

/**
 * Decides what reaches the preview display.
 *
 * Rendering may finish late, out of order or with a blank surface after a
 * resize, so a frame is only presented once the gates here agree: the released
 * scrub guard is not protecting a newer committed snapshot, the paused
 * transport is not holding its frame, and a transport that just settled is not
 * handed a blank replacement. The committed snapshot taken on gesture entry is
 * what these gates fall back to, which is why it is captured and mutated by
 * this module rather than by the caller.
 */
export function createPreviewPresentationGate(
  deps: PreviewPresentationGateDeps,
): PreviewPresentationGate {
  const committedPreviewSnapshot = deps.getCommittedSnapshot()
  let blankProbeCanvas: OffscreenCanvas | null = null

  const clearReleasedScrubGuard = (): void => {
    committedPreviewSnapshot.guardFrame = null
    committedPreviewSnapshot.guardUntilMs = 0
  }

  const captureCommittedSnapshot = (frame: number): void => {
    const displayCanvas = deps.getDisplayCanvas()
    if (!displayCanvas || !deps.isDisplayVisible() || deps.getDisplayedFrame() !== frame) {
      // A hidden scrub canvas is not the visible committed presentation.
      // It may contain an old partial render even though its frame tag still
      // matches the playhead. Never promote those pixels on gesture entry.
      // A transient ruler -> track -> ruler handoff can attempt another
      // capture while the hover frame is on top. Preserve an earlier
      // authoritative snapshot for the same committed playhead frame.
      if (committedPreviewSnapshot.frame !== frame) {
        committedPreviewSnapshot.frame = null
        clearReleasedScrubGuard()
      }
      return
    }
    if (
      !committedPreviewSnapshot.canvas ||
      committedPreviewSnapshot.canvas.width !== displayCanvas.width ||
      committedPreviewSnapshot.canvas.height !== displayCanvas.height
    ) {
      committedPreviewSnapshot.canvas = new OffscreenCanvas(
        displayCanvas.width,
        displayCanvas.height,
      )
    }
    const context = committedPreviewSnapshot.canvas.getContext('2d')
    if (!context) return
    context.clearRect(
      0,
      0,
      committedPreviewSnapshot.canvas.width,
      committedPreviewSnapshot.canvas.height,
    )
    context.drawImage(displayCanvas, 0, 0)
    committedPreviewSnapshot.frame = frame
  }

  const isEffectivelyBlankPreviewSource = (
    source: OffscreenCanvas | HTMLCanvasElement,
  ): boolean => {
    if (!shouldProbePreviewSourcePixels(deps.getPlaybackState().isPlaying)) {
      return false
    }
    try {
      blankProbeCanvas ??= new OffscreenCanvas(BLANK_PROBE_SIZE_PX, BLANK_PROBE_SIZE_PX)
      const context = blankProbeCanvas.getContext('2d', { willReadFrequently: true })
      if (!context) return false
      context.clearRect(0, 0, BLANK_PROBE_SIZE_PX, BLANK_PROBE_SIZE_PX)
      context.drawImage(source, 0, 0, BLANK_PROBE_SIZE_PX, BLANK_PROBE_SIZE_PX)
      const pixels = context.getImageData(0, 0, BLANK_PROBE_SIZE_PX, BLANK_PROBE_SIZE_PX).data
      let rgbTotal = 0
      for (let index = 0; index < pixels.length; index += 4) {
        rgbTotal +=
          (pixels.at(index) ?? 0) + (pixels.at(index + 1) ?? 0) + (pixels.at(index + 2) ?? 0)
        if (rgbTotal > BLANK_PROBE_RGB_TOTAL) return false
      }
      return true
    } catch {
      // A presentation safeguard must never turn a readback limitation into
      // a dropped frame. If probing is unavailable, preserve normal output.
      return false
    }
  }

  const drawSourceToDisplay = (
    source: OffscreenCanvas | HTMLCanvasElement,
    renderedFrame: number,
    usedFallback = false,
  ): void => {
    const displayCanvas = deps.getDisplayCanvas()
    if (!displayCanvas) return
    const displayCtx = displayCanvas.getContext('2d')
    if (!displayCtx) return
    const displayedFrame = deps.getDisplayedFrame()
    const playbackState = deps.getPlaybackState()
    // Pixel probes force a synchronous GPU readback, and the same three
    // surfaces can each be probed from several rejection checks in one draw.
    // Memoize per invocation so repeated checks reuse the first sample.
    let sourceBlank: boolean | null = null
    let snapshotCanvasBlank: boolean | null = null
    let displayCanvasBlank: boolean | null = null
    const probeSourceBlank = () => {
      sourceBlank ??= isEffectivelyBlankPreviewSource(source)
      return sourceBlank
    }
    const probeSnapshotCanvasBlank = () => {
      if (!committedPreviewSnapshot.canvas) return true
      snapshotCanvasBlank ??= isEffectivelyBlankPreviewSource(committedPreviewSnapshot.canvas)
      return snapshotCanvasBlank
    }
    const probeDisplayCanvasBlank = () => {
      displayCanvasBlank ??= isEffectivelyBlankPreviewSource(displayCanvas)
      return displayCanvasBlank
    }
    if (
      committedPreviewSnapshot.guardFrame !== null &&
      performance.now() > committedPreviewSnapshot.guardUntilMs
    ) {
      clearReleasedScrubGuard()
    }
    if (
      committedPreviewSnapshot.guardFrame !== null &&
      committedPreviewSnapshot.canvas &&
      shouldRejectBlankReleasedScrubHandoff({
        releaseGuardFrame: committedPreviewSnapshot.guardFrame,
        renderedFrame,
        currentFrame: playbackState.currentFrame,
        previewFrame: playbackState.previewFrame,
        isPlaying: playbackState.isPlaying,
        snapshotFrame: committedPreviewSnapshot.frame,
        probeRenderedFrameBlank: probeSourceBlank,
        probeSnapshotFrameBlank: probeSnapshotCanvasBlank,
      })
    ) {
      if (source === deps.getOffscreenCanvas()) {
        deps.discardOffscreenRender(source, renderedFrame, { invalidateCache: true })
      }
      // A resize or layout rebuild can clear the display canvas while this
      // delayed render is in flight. Reassert the immutable committed copy
      // instead of merely declining the blank replacement.
      drawSourceToPreviewDisplayCanvas(displayCtx, displayCanvas, committedPreviewSnapshot.canvas)
      deps.setDisplayedFrame(renderedFrame)
      return
    }
    const shouldReleaseScrubSnapshotGuardAfterDraw =
      committedPreviewSnapshot.guardFrame === renderedFrame &&
      source !== committedPreviewSnapshot.canvas &&
      !probeSourceBlank()
    const pausedTransportHold = deps.getPausedTransportHold()
    if (
      shouldPreservePausedTransportPresentation({
        holdActive: performance.now() <= pausedTransportHold.holdUntilMs,
        heldFrame: pausedTransportHold.heldFrame,
        renderedFrame,
        displayedFrame,
        currentFrame: playbackState.currentFrame,
        previewFrame: playbackState.previewFrame,
        isPlaying: playbackState.isPlaying,
      })
    ) {
      return
    }
    if (
      performance.now() <= deps.getTransportSettlingUntilMs() &&
      displayedFrame !== null &&
      Math.abs(renderedFrame - displayedFrame) <= 1 &&
      shouldRejectBlankTransportHandoff({
        isTransportSettling: true,
        renderedFrame,
        displayedFrame,
        probeRenderedFrameBlank: probeSourceBlank,
        probeDisplayedFrameBlank: probeDisplayCanvasBlank,
      })
    ) {
      if (source === deps.getOffscreenCanvas()) {
        deps.discardOffscreenRender(source, renderedFrame, { invalidateCache: false })
      }
      return
    }
    drawSourceToPreviewDisplayCanvas(displayCtx, displayCanvas, source)
    deps.setDisplayedFrame(renderedFrame)
    deps.recordPresentation(renderedFrame, usedFallback)
    if (
      !playbackState.isPlaying &&
      playbackState.previewFrame === null &&
      playbackState.currentFrame === renderedFrame
    ) {
      if (source !== committedPreviewSnapshot.canvas) {
        captureCommittedSnapshot(renderedFrame)
      }
      deps.settleActiveRenderTarget(renderedFrame)
    }
    if (shouldReleaseScrubSnapshotGuardAfterDraw) {
      // Only a replacement that actually reached the front buffer may
      // release the guard. Earlier transport/pause checks can reject a
      // nonblank candidate without presenting it.
      clearReleasedScrubGuard()
    }
    deps.markColdStartVisibleFrame(renderedFrame)
  }

  const drawToDisplay = (renderedFrame: number, usedFallback = false): void => {
    const offscreen = deps.getOffscreenCanvas()
    if (!offscreen) return
    drawSourceToDisplay(offscreen, renderedFrame, usedFallback)
  }

  return {
    captureCommittedSnapshot,
    clearReleasedScrubGuard,
    drawToDisplay,
    drawSourceToDisplay,
    isEffectivelyBlankPreviewSource,
  }
}
