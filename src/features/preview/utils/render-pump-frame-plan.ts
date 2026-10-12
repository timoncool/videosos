import type { PlaybackState } from '@/shared/state/playback/types'
import {
  FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES,
  FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES,
  FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS,
  FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME,
  FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS,
  FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME,
  FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME,
  FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD,
  FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD,
  FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS,
  type FastScrubBoundarySource,
} from './preview-constants'

const COMMITTED_SCRUB_SNAPSHOT_GUARD_MS = 30_000

export type RenderPumpFrameState = Pick<
  PlaybackState,
  'currentFrame' | 'currentFrameEpoch' | 'previewFrame' | 'previewFrameEpoch'
>

type PreviewPresentationHandoffState = Pick<
  PlaybackState,
  'currentFrame' | 'previewFrame' | 'isPlaying'
>

export type RenderedPlaybackState = Pick<PlaybackState, 'isPlaying' | 'playbackRate'>

type ScrubDirection = -1 | 0 | 1

interface ResolveRenderPumpTargetFrameParams {
  state: RenderPumpFrameState
  forceFastScrubOverlay: boolean
  isPausedInsideTransition: boolean
  settlingReleasedScrubFrame?: number | null
}

interface ResolveActivePreviewPresentationTargetParams {
  state: PreviewPresentationHandoffState
  prev: PreviewPresentationHandoffState
  settlingReleasedScrubFrame: number | null
  forceFastScrubOverlay: boolean
}

interface ShouldRejectBlankTransportHandoffParams {
  isTransportSettling: boolean
  renderedFrame: number
  displayedFrame: number | null
  /**
   * Lazy pixel probes. Evaluating them eagerly forces a synchronous GPU
   * readback even when the cheap frame gate below already fails, so callers
   * pass thunks and the helper only samples when a rejection is still possible.
   */
  probeRenderedFrameBlank: () => boolean
  probeDisplayedFrameBlank: () => boolean
}

interface ShouldRejectBlankReleasedScrubHandoffParams {
  releaseGuardFrame: number | null
  renderedFrame: number
  currentFrame: number
  previewFrame: number | null
  isPlaying: boolean
  snapshotFrame: number | null
  /** Lazy pixel probes — see ShouldRejectBlankTransportHandoffParams. */
  probeRenderedFrameBlank: () => boolean
  probeSnapshotFrameBlank: () => boolean
}

interface ShouldPreservePausedTransportPresentationParams {
  holdActive: boolean
  heldFrame: number | null
  renderedFrame: number
  displayedFrame: number | null
  currentFrame: number
  previewFrame: number | null
  isPlaying: boolean
}

interface ShouldDropStalePausedPreviewRenderParams {
  renderedFrame: number
  currentFrame: number
  previewFrame: number | null
  isPlaying: boolean
}

interface ShouldRestoreCommittedPreviewSnapshotParams {
  previewFrame: number | null
  previousPreviewFrame: number | null
  currentFrame: number
  snapshotFrame: number | null
}

interface ShouldRecoverFailedActivePreseekScheduleParams {
  effectDisposed: boolean
  recoveredFailedSchedule: boolean
  scheduleVersion: number
  activeScheduleVersion: number
  mounted: boolean
  isPlaying: boolean
  currentTarget: number
  targetFrame: number
}

/**
 * Browser media elements cannot sustain negative playback rates. Reverse
 * shuttle therefore shares the display-cadenced composition render lane used
 * by workspaces that always require the rendered overlay.
 */
export function shouldUseRenderedPlaybackOverlay(
  state: RenderedPlaybackState,
  forceFastScrubOverlay: boolean,
): boolean {
  return state.isPlaying && (forceFastScrubOverlay || state.playbackRate < 0)
}

/**
 * Pixel probes are useful when a paused scrub handoff may be replacing a known
 * good canvas with a cleared one. During playback, however, probing a WebGPU-
 * backed canvas forces a synchronous GPU readback and can block the UI thread
 * for several frames. Active playback relies on the renderer's aborted/pending
 * contract instead of sampling pixels.
 */
export function shouldProbePreviewSourcePixels(isPlaying: boolean): boolean {
  return !isPlaying
}

/**
 * Keeps the last valid rendered surface pinned while an exact replacement is
 * prepared. Scrubs always own this lane; continuous-overlay playback also
 * borrows it for the single play/pause handoff frame so nested composition
 * canvases cannot expose their freshly-cleared backing surface.
 */
export function resolveActivePreviewPresentationTarget({
  state,
  prev,
  settlingReleasedScrubFrame,
  forceFastScrubOverlay,
}: ResolveActivePreviewPresentationTargetParams): number | null {
  return (
    state.previewFrame ??
    settlingReleasedScrubFrame ??
    (forceFastScrubOverlay && state.isPlaying !== prev.isPlaying ? state.currentFrame : null)
  )
}

/**
 * A play/pause handoff for the frame already on screen must be visually
 * idempotent. If the shared render target was cleared while a nested source
 * was settling, keep the known-good front buffer instead of presenting black.
 */
export function shouldRejectBlankTransportHandoff({
  isTransportSettling,
  renderedFrame,
  displayedFrame,
  probeRenderedFrameBlank,
  probeDisplayedFrameBlank,
}: ShouldRejectBlankTransportHandoffParams): boolean {
  return (
    isTransportSettling &&
    displayedFrame !== null &&
    Math.abs(renderedFrame - displayedFrame) <= 1 &&
    probeRenderedFrameBlank() &&
    !probeDisplayedFrameBlank()
  )
}

/**
 * A committed snapshot is authoritative for the exact frame from which a
 * ruler skim began. A delayed/cancelled compound render may finish after
 * release with a cleared canvas; it must not replace that known-good frame or
 * become the cached representation for the playhead.
 */
export function shouldRejectBlankReleasedScrubHandoff({
  releaseGuardFrame,
  renderedFrame,
  currentFrame,
  previewFrame,
  isPlaying,
  snapshotFrame,
  probeRenderedFrameBlank,
  probeSnapshotFrameBlank,
}: ShouldRejectBlankReleasedScrubHandoffParams): boolean {
  return (
    releaseGuardFrame !== null &&
    renderedFrame === releaseGuardFrame &&
    currentFrame === releaseGuardFrame &&
    previewFrame === null &&
    !isPlaying &&
    snapshotFrame === releaseGuardFrame &&
    probeRenderedFrameBlank() &&
    !probeSnapshotFrameBlank()
  )
}

export function resolveReleasedScrubSnapshotGuardUntilMs({ nowMs }: { nowMs: number }): number {
  return nowMs + COMMITTED_SCRUB_SNAPSHOT_GUARD_MS
}

/** Prevents a delayed quality/decoder pass from visibly replacing the frame
 * that was on screen when transport paused. A new preview target or playback
 * lifecycle releases the hold at the call site. */
export function shouldPreservePausedTransportPresentation({
  holdActive,
  heldFrame,
  renderedFrame,
  displayedFrame,
  currentFrame,
  previewFrame,
  isPlaying,
}: ShouldPreservePausedTransportPresentationParams): boolean {
  return (
    holdActive &&
    heldFrame !== null &&
    !isPlaying &&
    previewFrame === null &&
    currentFrame === heldFrame &&
    renderedFrame === heldFrame &&
    displayedFrame === heldFrame
  )
}

/** A hover target can be superseded while its render is in flight. Only the
 * latest paused target may take ownership of the shared offscreen canvas,
 * regardless of whether the workspace normally forces the overlay. */
export function shouldDropStalePausedPreviewRender({
  renderedFrame,
  currentFrame,
  previewFrame,
  isPlaying,
}: ShouldDropStalePausedPreviewRenderParams): boolean {
  if (isPlaying) return false
  return renderedFrame !== (previewFrame ?? currentFrame)
}

export function shouldRestoreCommittedPreviewSnapshot({
  previewFrame,
  previousPreviewFrame,
  currentFrame,
  snapshotFrame,
}: ShouldRestoreCommittedPreviewSnapshotParams): boolean {
  return previewFrame === null && previousPreviewFrame !== null && snapshotFrame === currentFrame
}

/**
 * A decoder promise can settle after the render-pump effect that created it
 * has been replaced. The shared mounted ref may already be true for the new
 * effect, so the old effect's own disposed state must participate in the
 * generation check before it can release the active-preview gate.
 */
export function shouldRecoverFailedActivePreseekSchedule({
  effectDisposed,
  recoveredFailedSchedule,
  scheduleVersion,
  activeScheduleVersion,
  mounted,
  isPlaying,
  currentTarget,
  targetFrame,
}: ShouldRecoverFailedActivePreseekScheduleParams): boolean {
  return (
    !effectDisposed &&
    !recoveredFailedSchedule &&
    scheduleVersion === activeScheduleVersion &&
    mounted &&
    !isPlaying &&
    currentTarget === targetFrame
  )
}

interface ResolveScrubDirectionPlanParams {
  state: RenderPumpFrameState
  prev: RenderPumpFrameState
  targetFrame: number | null
  prevTargetFrame: number | null
}

interface ResolveBackwardScrubFlagsParams {
  scrubDirection: ScrubDirection
  forceFastScrubOverlay: boolean
  isAtomicScrubTarget: boolean
  preserveHighFidelityBackwardPreview: boolean
}

interface ResolveBackwardScrubFramePlanParams {
  targetFrame: number
  scrubDirection: ScrubDirection
  isAtomicScrubTarget: boolean
  preserveHighFidelityBackwardPreview: boolean
  nowMs: number
  lastBackwardScrubRenderAt: number
  lastBackwardRequestedFrame: number | null
}

interface SelectBoundaryPrewarmFramesParams {
  boundaryFrames: number[]
  targetFrame: number
  direction: ScrubDirection
  fps: number
}

interface SelectBoundarySourcePrewarmSourcesParams {
  boundarySources: FastScrubBoundarySource[]
  targetFrame: number
  direction: ScrubDirection
  fps: number
}

function selectDirectionalWindowEntries<T>({
  entries,
  targetFrame,
  direction,
  windowFrames,
  maxEntries,
  getFrame,
}: {
  entries: readonly T[]
  targetFrame: number
  direction: ScrubDirection
  windowFrames: number
  maxEntries: number
  getFrame: (entry: T) => number
}): T[] {
  const minFrame = targetFrame - windowFrames
  const maxFrame = targetFrame + windowFrames
  const directionalEntries: T[] = []
  const fallbackEntries: T[] = []

  // Both callers pass entries sorted by frame, so the first out-of-window
  // entry lets us stop scanning the remainder.
  for (const entry of entries) {
    const frame = getFrame(entry)
    if (frame < minFrame) continue
    if (frame > maxFrame) break
    fallbackEntries.push(entry)
    if (direction > 0 && frame < targetFrame - 1) continue
    if (direction < 0 && frame > targetFrame + 1) continue
    directionalEntries.push(entry)
  }

  const candidates = directionalEntries.length > 0 ? directionalEntries : fallbackEntries
  return [...candidates]
    .sort((a, b) => Math.abs(getFrame(a) - targetFrame) - Math.abs(getFrame(b) - targetFrame))
    .slice(0, maxEntries)
}

export function resolveRenderPumpTargetFrame({
  state,
  forceFastScrubOverlay,
  isPausedInsideTransition,
  settlingReleasedScrubFrame = null,
}: ResolveRenderPumpTargetFrameParams): number | null {
  return (
    state.previewFrame ??
    settlingReleasedScrubFrame ??
    (forceFastScrubOverlay || isPausedInsideTransition ? state.currentFrame : null)
  )
}

export function isAtomicPreviewTarget(state: RenderPumpFrameState): boolean {
  return (
    state.previewFrame !== null &&
    state.currentFrame === state.previewFrame &&
    state.currentFrameEpoch === state.previewFrameEpoch
  )
}

export function resolveScrubDirectionPlan({
  state,
  prev,
  targetFrame,
  prevTargetFrame,
}: ResolveScrubDirectionPlanParams): {
  direction: ScrubDirection
  scrubUpdates: number
  scrubDroppedFrames: number
} {
  if (state.previewFrame !== null && prev.previewFrame !== null) {
    const previewDelta = state.previewFrame - prev.previewFrame
    return {
      direction: previewDelta > 0 ? 1 : previewDelta < 0 ? -1 : 0,
      scrubUpdates: 1,
      scrubDroppedFrames: Math.max(0, Math.abs(previewDelta) - 1),
    }
  }

  if (targetFrame !== null && prevTargetFrame !== null) {
    const targetDelta = targetFrame - prevTargetFrame
    return {
      direction: targetDelta > 0 ? 1 : targetDelta < 0 ? -1 : 0,
      scrubUpdates: 0,
      scrubDroppedFrames: 0,
    }
  }

  return {
    direction: 0,
    scrubUpdates: 0,
    scrubDroppedFrames: 0,
  }
}

export function resolveBackwardScrubFlags({
  scrubDirection,
  forceFastScrubOverlay,
  isAtomicScrubTarget,
  preserveHighFidelityBackwardPreview,
}: ResolveBackwardScrubFlagsParams): {
  suppressBackgroundPrewarm: boolean
  fallbackToPlayer: boolean
} {
  return {
    suppressBackgroundPrewarm:
      FAST_SCRUB_DISABLE_BACKGROUND_PREWARM_ON_BACKWARD && scrubDirection < 0,
    fallbackToPlayer:
      !forceFastScrubOverlay &&
      FAST_SCRUB_FALLBACK_TO_PLAYER_ON_BACKWARD &&
      scrubDirection < 0 &&
      !isAtomicScrubTarget &&
      !preserveHighFidelityBackwardPreview,
  }
}

export function resolveBackwardScrubFramePlan({
  targetFrame,
  scrubDirection,
  isAtomicScrubTarget,
  preserveHighFidelityBackwardPreview,
  nowMs,
  lastBackwardScrubRenderAt,
  lastBackwardRequestedFrame,
}: ResolveBackwardScrubFramePlanParams): {
  requestedFrame: number
  throttleRequest: boolean
  nextLastBackwardScrubRenderAt: number
  nextLastBackwardRequestedFrame: number | null
} {
  if (scrubDirection >= 0 || isAtomicScrubTarget || preserveHighFidelityBackwardPreview) {
    return {
      requestedFrame: targetFrame,
      throttleRequest: false,
      nextLastBackwardScrubRenderAt: 0,
      nextLastBackwardRequestedFrame: null,
    }
  }

  const quantizedFrame =
    Math.floor(targetFrame / FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES) *
    FAST_SCRUB_BACKWARD_RENDER_QUANTIZE_FRAMES
  const withinThrottle = nowMs - lastBackwardScrubRenderAt < FAST_SCRUB_BACKWARD_RENDER_THROTTLE_MS
  const jumpDistance =
    lastBackwardRequestedFrame === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(quantizedFrame - lastBackwardRequestedFrame)

  return {
    requestedFrame: quantizedFrame,
    throttleRequest: withinThrottle && jumpDistance < FAST_SCRUB_BACKWARD_FORCE_JUMP_FRAMES,
    nextLastBackwardScrubRenderAt: nowMs,
    nextLastBackwardRequestedFrame: quantizedFrame,
  }
}

export function selectBoundaryPrewarmFrames({
  boundaryFrames,
  targetFrame,
  direction,
  fps,
}: SelectBoundaryPrewarmFramesParams): number[] {
  if (boundaryFrames.length === 0) return []

  const windowFrames = Math.max(4, Math.round(fps * FAST_SCRUB_BOUNDARY_PREWARM_WINDOW_SECONDS))
  const selectedBoundaries = selectDirectionalWindowEntries({
    entries: boundaryFrames,
    targetFrame,
    direction,
    windowFrames,
    maxEntries: FAST_SCRUB_BOUNDARY_PREWARM_MAX_BOUNDARIES_PER_FRAME,
    getFrame: (boundary) => boundary,
  })

  const frames: number[] = []
  const seen = new Set<number>()
  for (const boundary of selectedBoundaries) {
    for (const frame of [boundary - 1, boundary, boundary + 1]) {
      const clampedFrame = Math.max(0, frame)
      if (seen.has(clampedFrame)) continue
      seen.add(clampedFrame)
      frames.push(clampedFrame)
    }
  }

  return frames
}

export function selectBoundarySourcePrewarmSources({
  boundarySources,
  targetFrame,
  direction,
  fps,
}: SelectBoundarySourcePrewarmSourcesParams): string[] {
  if (boundarySources.length === 0) return []

  const windowFrames = Math.max(8, Math.round(fps * FAST_SCRUB_SOURCE_PREWARM_WINDOW_SECONDS))
  const selectedEntries = selectDirectionalWindowEntries({
    entries: boundarySources,
    targetFrame,
    direction,
    windowFrames,
    maxEntries: FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_ENTRIES_PER_FRAME,
    getFrame: (entry) => entry.frame,
  })

  const sources: string[] = []
  for (const entry of selectedEntries) {
    for (const src of entry.srcs) {
      if (sources.length >= FAST_SCRUB_BOUNDARY_SOURCE_PREWARM_MAX_SOURCES_PER_FRAME) {
        return sources
      }
      sources.push(src)
    }
  }

  return sources
}
