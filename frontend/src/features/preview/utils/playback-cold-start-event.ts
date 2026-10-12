/**
 * Wide-event instrumentation for playback cold start: the window between the
 * user pressing Play and the first advancing frame becoming visibly presented.
 *
 * One measurement is active at a time (playback is a singleton):
 * - `beginPlaybackColdStart` on the store's `isPlaying` false-to-true transition
 * - `markPlaybackColdStart` to attach gate/readiness context
 * - `resolvePlaybackColdStartFrameAdvance` records the first Clock advance
 * - `resolvePlaybackColdStartVisibleFrame` emits when that advancing frame is
 *   actually presented by a visible DOM video or rendered preview canvas
 * - `cancelPlaybackColdStart` emits an aborted start that never presented
 *
 * A measurement overlapping a hidden tab is retained but flagged so it can be
 * excluded from cold-start analysis.
 */
import { createLogger, createOperationId, type WideEvent } from '@/shared/logging/logger'

const log = createLogger('PlaybackColdStart')
const PLAYBACK_COLD_START_PERF_LOG_ENABLED = import.meta.env.MODE === 'perf'

// Perf builds are production-optimized, but cold-start profiling still needs
// the completed wide event. Keep normal production logging unchanged.
if (import.meta.env.MODE === 'perf') {
  log.setLevel(1)
}

export interface PlaybackColdStartContext {
  startFrame: number
  forceFastScrubOverlay: boolean
  audioContextState: string | null
}

interface ActivePlaybackColdStart {
  event: WideEvent
  perfData: Record<string, unknown>
  startFrame: number
  startMs: number
  hiddenDuringMeasurement: boolean
  firstAdvancedFrame: number | null
}

export type PlaybackColdStartPresentationSource =
  | 'dom_video'
  | 'rendered_overlay'
  | 'composition_paint'

export type PlaybackStartLookaheadOrigin = 'initial_load' | 'post_pause'

export interface PlaybackStartReadiness {
  rendererInitStartedMs: number | null
  rendererReadyMs: number | null
  rendererInitFailedMs: number | null
  rendererPreloadStartedMs: number | null
  rendererPriorityMediaReadyMs: number | null
  rendererPreloadFinishedMs: number | null
  gpuWarmStartedMs: number | null
  gpuWarmFinishedMs: number | null
  gpuWarmAvailable: boolean | null
  lookaheadFrame: number | null
  lookaheadOrigin: PlaybackStartLookaheadOrigin | null
  lookaheadReadyMs: number | null
}

const emptyReadiness = (): PlaybackStartReadiness => ({
  rendererInitStartedMs: null,
  rendererReadyMs: null,
  rendererInitFailedMs: null,
  rendererPreloadStartedMs: null,
  rendererPriorityMediaReadyMs: null,
  rendererPreloadFinishedMs: null,
  gpuWarmStartedMs: null,
  gpuWarmFinishedMs: null,
  gpuWarmAvailable: null,
  lookaheadFrame: null,
  lookaheadOrigin: null,
  lookaheadReadyMs: null,
})

let active: ActivePlaybackColdStart | null = null
let readiness = emptyReadiness()

export function resetPlaybackStartReadiness(options: { preserveGpu?: boolean } = {}): void {
  const previous = readiness
  readiness = emptyReadiness()
  if (options.preserveGpu !== false) {
    readiness.gpuWarmStartedMs = previous.gpuWarmStartedMs
    readiness.gpuWarmFinishedMs = previous.gpuWarmFinishedMs
    readiness.gpuWarmAvailable = previous.gpuWarmAvailable
  }
}

export function markPlaybackStartReadiness(data: Partial<PlaybackStartReadiness>): void {
  Object.assign(readiness, data)
}

function elapsedMs(startMs: number | null, endMs: number | null): number | null {
  if (startMs === null || endMs === null) return null
  return Math.round(endMs - startMs)
}

function ageMs(timestampMs: number | null, nowMs: number): number | null {
  if (timestampMs === null) return null
  return Math.max(0, Math.round(nowMs - timestampMs))
}

function getRendererStateAtPlay(): 'ready' | 'failed' | 'initializing' | 'not_started' {
  if (readiness.rendererReadyMs !== null) return 'ready'
  if (readiness.rendererInitFailedMs !== null) return 'failed'
  if (readiness.rendererInitStartedMs !== null) return 'initializing'
  return 'not_started'
}

function getPreloadStateAtPlay(): 'complete' | 'loading' | 'not_started' {
  if (readiness.rendererPreloadFinishedMs !== null) return 'complete'
  if (readiness.rendererPreloadStartedMs !== null) return 'loading'
  return 'not_started'
}

function getGpuWarmStateAtPlay(): 'ready' | 'unavailable' | 'warming' | 'not_started' {
  if (readiness.gpuWarmAvailable === true) return 'ready'
  if (readiness.gpuWarmFinishedMs !== null) return 'unavailable'
  if (readiness.gpuWarmStartedMs !== null) return 'warming'
  return 'not_started'
}

function getReadinessAtPlay(startFrame: number, nowMs: number): Record<string, unknown> {
  const preparedLookaheadHit =
    readiness.lookaheadReadyMs !== null && readiness.lookaheadFrame === startFrame + 1

  return {
    renderer_state_at_play: getRendererStateAtPlay(),
    renderer_init_ms: elapsedMs(readiness.rendererInitStartedMs, readiness.rendererReadyMs),
    renderer_ready_age_ms: ageMs(readiness.rendererReadyMs, nowMs),
    renderer_preload_state_at_play: getPreloadStateAtPlay(),
    renderer_preload_ms: elapsedMs(
      readiness.rendererPreloadStartedMs,
      readiness.rendererPreloadFinishedMs,
    ),
    priority_media_ready_at_play: readiness.rendererPriorityMediaReadyMs !== null,
    gpu_warm_state_at_play: getGpuWarmStateAtPlay(),
    gpu_warm_ready_at_play: readiness.gpuWarmAvailable === true,
    gpu_warm_ms: elapsedMs(readiness.gpuWarmStartedMs, readiness.gpuWarmFinishedMs),
    prepared_lookahead_hit: preparedLookaheadHit,
    prepared_lookahead_origin: preparedLookaheadHit ? readiness.lookaheadOrigin : null,
    prepared_lookahead_age_ms: preparedLookaheadHit
      ? ageMs(readiness.lookaheadReadyMs, nowMs)
      : null,
  }
}

function readVisibilityState(): DocumentVisibilityState | 'unknown' {
  return typeof document !== 'undefined' ? document.visibilityState : 'unknown'
}

function handleVisibilityChange(): void {
  if (active && readVisibilityState() === 'hidden') {
    active.hiddenDuringMeasurement = true
  }
}

function watchVisibility(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function unwatchVisibility(): void {
  if (typeof document === 'undefined') return
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

export function beginPlaybackColdStart(
  ctx: PlaybackColdStartContext,
  nowMs: number = performance.now(),
): void {
  if (active) {
    emit('cancelled', 'superseded_by_new_play', nowMs)
  }
  const event = log.startEvent('playback_cold_start', createOperationId())
  const visibility = readVisibilityState()
  const initialData = {
    start_frame: ctx.startFrame,
    force_fast_scrub_overlay: ctx.forceFastScrubOverlay,
    audio_context_state: ctx.audioContextState ?? 'unavailable',
    visibility_state_at_play: visibility,
    ...getReadinessAtPlay(ctx.startFrame, nowMs),
  }
  event.merge(initialData)
  active = {
    event,
    perfData: { ...initialData },
    startFrame: ctx.startFrame,
    startMs: nowMs,
    hiddenDuringMeasurement: visibility === 'hidden',
    firstAdvancedFrame: null,
  }
  watchVisibility()
}

/** Attach gate/readiness context to the active measurement. */
export function markPlaybackColdStart(data: Record<string, unknown>): void {
  if (!active) return
  active.event.merge(data)
  Object.assign(active.perfData, data)
}

/** Record the first Clock frame that advanced past the play-start frame. */
export function resolvePlaybackColdStartFrameAdvance(
  frame: number,
  nowMs: number = performance.now(),
): void {
  if (!active || active.firstAdvancedFrame !== null || frame === active.startFrame) return
  active.firstAdvancedFrame = frame
  markPlaybackColdStart({
    first_advanced_frame: frame,
    ms_to_first_frame_advance: Math.round(nowMs - active.startMs),
  })
}

/**
 * Complete the measurement when an advancing frame is visibly presented.
 * Returns true only when this call completed the active measurement.
 */
export function resolvePlaybackColdStartVisibleFrame(
  frame: number,
  source: PlaybackColdStartPresentationSource,
  nowMs: number = performance.now(),
): boolean {
  if (!active || active.firstAdvancedFrame === null || frame === active.startFrame) {
    return false
  }
  markPlaybackColdStart({
    first_visible_frame: frame,
    first_visible_frame_source: source,
    ms_to_first_visible_frame: Math.round(nowMs - active.startMs),
  })
  emit('completed', null, nowMs)
  return true
}

/** Playback stopped before an advancing frame was presented. */
export function cancelPlaybackColdStart(reason: string, nowMs: number = performance.now()): void {
  if (!active) return
  emit('cancelled', reason, nowMs)
}

function emit(result: 'completed' | 'cancelled', cancelReason: string | null, nowMs: number): void {
  if (!active) return
  if (result === 'cancelled') {
    markPlaybackColdStart({ ms_to_cancel: Math.round(nowMs - active.startMs) })
    if (cancelReason !== null) {
      markPlaybackColdStart({ cancel_reason: cancelReason })
    }
  }
  markPlaybackColdStart({ hidden_during_measurement: active.hiddenDuringMeasurement })
  if (PLAYBACK_COLD_START_PERF_LOG_ENABLED) {
    console.warn(
      '[PlaybackColdStart] playback_cold_start_perf',
      JSON.stringify({
        ...active.perfData,
        outcome: 'success',
        duration_ms: Math.round(nowMs - active.startMs),
        result,
      }),
    )
  }
  active.event.success({ result })
  active = null
  unwatchVisibility()
}

/** Test/runtime hook: true while awaiting first visible presentation. */
export function isPlaybackColdStartPending(): boolean {
  return active !== null
}
