import {
  activePreviewPreseek,
  backgroundPreseek,
  isActivePreviewFrameDecodeReady,
  replaceActivePreviewSourceTargets,
  setActivePreviewRenderTarget,
} from './decoder-prewarm'
import { resolveActivePreviewLookaheadTimestamps } from './render-pump-preseek'
import { shouldRecoverFailedActivePreseekSchedule } from './render-pump-frame-plan'
import { scheduleScrubProxyFallback } from './scrub-proxy-fallback'
import { recordPreviewPreseekPlan } from '@/shared/logging/preview-scrub-performance'

export interface ActiveScrubPreseekSchedulerDeps {
  fps: number
  useProxy: boolean
  /** Source timestamps the visible tracks need at `frame`. */
  collectSourceTimes: (frame: number) => Map<string, number[]>
  getPlaybackState: () => {
    currentFrame: number
    previewFrame: number | null
    isPlaying: boolean
  }
  isEffectDisposed: () => boolean
  isMounted: () => boolean
  isRenderInFlight: () => boolean
  clearOffscreenRenderedFrameIf: (frame: number) => void
  requestFrame: (frame: number) => void
  /** Hands a recovered target back to the single-owner render pump. */
  pumpRenderLoop: () => void
}

export interface ActiveScrubPreseekScheduler {
  /**
   * Preseek `targetFrame` for a held drag. The top source owns the isolated
   * latency-critical lane; stacked secondary sources use the bounded pool.
   */
  schedule: (
    targetFrame: number,
    direction: -1 | 0 | 1,
    nowMs: number,
    retryFailedTarget: boolean,
  ) => void
  /** Warm the commandeered lane for a frame that is about to be dragged. */
  primeDecoderAtFrame: (targetFrame: number) => void
}

interface TimedSource {
  src: string
  timestamps: number[]
  exactTimestamp: number
}

/** Sources whose nearest timestamp is known, in first-seen order. */
function collectTimedSources(bySource: Map<string, number[]>): TimedSource[] {
  const sources: TimedSource[] = []
  for (const [src, timestamps] of bySource) {
    const exactTimestamp = timestamps[0]
    if (exactTimestamp === undefined) continue
    sources.push({ src, timestamps, exactTimestamp })
  }
  return sources
}

/**
 * Requests the isolated latency-critical lane for the source the user is
 * watching: a lookahead window keeps a continuing drag ahead of the clock, and
 * the source's remaining timestamps go to the bounded pool behind it.
 */
function preseekDedicatedLane(input: {
  source: TimedSource
  previousSourceTimes: Map<string, number>
  elapsedMs: number
  direction: -1 | 0 | 1
  fps: number
  useProxy: boolean
  onRequiredPreseek: (promise: Promise<ImageBitmap | null>) => void
}): void {
  const { src, timestamps, exactTimestamp } = input.source
  if (input.useProxy) {
    scheduleScrubProxyFallback(src, exactTimestamp)
  }
  input.onRequiredPreseek(
    activePreviewPreseek({
      src,
      timestamp: exactTimestamp,
      lookaheadTimestamps: resolveActivePreviewLookaheadTimestamps({
        sourceTime: exactTimestamp,
        previousSourceTime: input.previousSourceTimes.get(src) ?? null,
        elapsedMs: input.elapsedMs,
        sourceFps: input.fps,
        fallbackDirection: input.direction,
      }),
    }),
  )
  if (timestamps.length > 1) {
    for (const timestamp of timestamps.slice(1)) {
      input.onRequiredPreseek(backgroundPreseek(src, timestamp))
    }
  }
}

/**
 * Stacked secondary sources share the existing bounded pool; only the top
 * active source owns the latency-critical lane.
 */
function preseekPoolSources(input: {
  sources: TimedSource[]
  useProxy: boolean
  onRequiredPreseek: (promise: Promise<ImageBitmap | null>) => void
}): void {
  for (const { src, timestamps, exactTimestamp } of input.sources) {
    if (input.useProxy) {
      scheduleScrubProxyFallback(src, exactTimestamp)
    }
    for (const timestamp of timestamps) {
      input.onRequiredPreseek(backgroundPreseek(src, timestamp))
    }
  }
}

/**
 * Requests decodes for every source the target frame needs and returns the
 * exact timestamp registered per source.
 */
function preseekActiveSources(input: {
  bySource: Map<string, number[]>
  previousSourceTimes: Map<string, number>
  elapsedMs: number
  direction: -1 | 0 | 1
  fps: number
  useProxy: boolean
  onRequiredPreseek: (promise: Promise<ImageBitmap | null>) => void
}): Map<string, number> {
  const sources = collectTimedSources(input.bySource)
  const nextSourceTimes = new Map(sources.map((source) => [source.src, source.exactTimestamp]))
  const [primary, ...secondary] = sources
  if (primary) {
    preseekDedicatedLane({
      source: primary,
      previousSourceTimes: input.previousSourceTimes,
      elapsedMs: input.elapsedMs,
      direction: input.direction,
      fps: input.fps,
      useProxy: input.useProxy,
      onRequiredPreseek: input.onRequiredPreseek,
    })
  }
  preseekPoolSources({
    sources: secondary,
    useProxy: input.useProxy,
    onRequiredPreseek: input.onRequiredPreseek,
  })
  return nextSourceTimes
}

/**
 * Unpins a schedule that never produced a ready frame.
 *
 * A latest-target worker failure or cancellation has no ready notification, so
 * leaving the active gate pinned would make every retry abort forever until the
 * pointer requested a different frame. Returns whether the schedule has now
 * recovered (or was already recovered).
 */
function recoverFailedSchedule(input: {
  deps: ActiveScrubPreseekSchedulerDeps
  alreadyRecovered: boolean
  scheduleVersion: number
  activeScheduleVersion: number
  targetFrame: number
  retryFailedTarget: boolean
}): boolean {
  const playbackState = input.deps.getPlaybackState()
  const currentTarget = playbackState.previewFrame ?? playbackState.currentFrame
  if (
    !shouldRecoverFailedActivePreseekSchedule({
      effectDisposed: input.deps.isEffectDisposed(),
      recoveredFailedSchedule: input.alreadyRecovered,
      scheduleVersion: input.scheduleVersion,
      activeScheduleVersion: input.activeScheduleVersion,
      mounted: input.deps.isMounted(),
      isPlaying: playbackState.isPlaying,
      currentTarget,
      targetFrame: input.targetFrame,
    })
  ) {
    return input.alreadyRecovered
  }

  // Retry through the normal DOM/MediaBunny renderer while preserving the
  // visible front buffer.
  setActivePreviewRenderTarget(null)
  input.deps.clearOffscreenRenderedFrameIf(input.targetFrame)
  if (!input.retryFailedTarget) return true
  input.deps.requestFrame(input.targetFrame)
  if (!input.deps.isRenderInFlight()) {
    input.deps.pumpRenderLoop()
  }
  return true
}

/**
 * Owns the active-preview (held-scrub) decode lane.
 *
 * A held drag requests frames far faster than they can be extracted, so this
 * keeps one schedule version and one set of registered source targets: a newer
 * schedule supersedes older work, and a schedule that never yields a ready
 * frame unpins itself instead of pinning every later retry behind a decode that
 * will never arrive.
 */
export function createActiveScrubPreseekScheduler(
  deps: ActiveScrubPreseekSchedulerDeps,
): ActiveScrubPreseekScheduler {
  let lastTargetAtMs = 0
  let lastSourceTimes = new Map<string, number>()
  let scheduleVersion = 0

  const schedule = (
    targetFrame: number,
    direction: -1 | 0 | 1,
    nowMs: number,
    retryFailedTarget: boolean,
  ): void => {
    const currentScheduleVersion = ++scheduleVersion
    const bySource = deps.collectSourceTimes(targetFrame)
    if (bySource.size === 0) {
      // There is no worker-backed source to gate this frame. Drop any source
      // targets left by the previous hover so images/text and the normal
      // renderer path cannot be held behind an unrelated cancelled decode.
      setActivePreviewRenderTarget(null)
      replaceActivePreviewSourceTargets(bySource)
      return
    }

    recordPreviewPreseekPlan(targetFrame, bySource)
    const elapsedMs =
      lastTargetAtMs === 0 ? Number.POSITIVE_INFINITY : nowMs - lastTargetAtMs
    lastTargetAtMs = nowMs
    let recovered = false
    const onRecover = () => {
      recovered = recoverFailedSchedule({
        deps,
        alreadyRecovered: recovered,
        scheduleVersion: currentScheduleVersion,
        activeScheduleVersion: scheduleVersion,
        targetFrame,
        retryFailedTarget,
      })
    }
    const requiredPreseekPromises: Array<Promise<ImageBitmap | null>> = []
    const onRequiredPreseek = (promise: Promise<ImageBitmap | null>) => {
      requiredPreseekPromises.push(promise)
      void promise.then((bitmap) => {
        if (!bitmap) onRecover()
      })
    }

    lastSourceTimes = preseekActiveSources({
      bySource,
      previousSourceTimes: lastSourceTimes,
      elapsedMs,
      direction,
      fps: deps.fps,
      useProxy: deps.useProxy,
      onRequiredPreseek,
    })
    replaceActivePreviewSourceTargets(bySource)
    void Promise.allSettled(requiredPreseekPromises).then(() => {
      if (
        !deps.isEffectDisposed() &&
        currentScheduleVersion === scheduleVersion &&
        !isActivePreviewFrameDecodeReady(targetFrame)
      ) {
        // The bounded background queue can resolve an older same-source
        // request with the newer bitmap that replaced it. Re-check the exact
        // registered target set after all work settles instead of treating a
        // non-null promise value as proof that every compound source arrived.
        onRecover()
      }
    })
  }

  const primeDecoderAtFrame = (targetFrame: number): void => {
    const bySource = deps.collectSourceTimes(targetFrame)
    const primarySource = bySource.entries().next().value as [string, number[]] | undefined
    if (!primarySource) return

    const [src, timestamps] = primarySource
    const exactTimestamp = timestamps[0]
    if (exactTimestamp === undefined) return

    // The worker itself can be warm while its media extractor is still
    // cold. Prime the latency-critical lane while the preview is paused so
    // the first held drag does not pay source registration + demux startup.
    void activePreviewPreseek({
      src,
      timestamp: exactTimestamp,
      lookaheadTimestamps: resolveActivePreviewLookaheadTimestamps({
        sourceTime: exactTimestamp,
        previousSourceTime: null,
        elapsedMs: Number.POSITIVE_INFINITY,
        sourceFps: deps.fps,
        fallbackDirection: 0,
      }),
    })
  }

  return { schedule, primeDecoderAtFrame }
}
