import type { backgroundBatchPreseek } from './decoder-prewarm'

const DEFAULT_REVERSE_WINDOW_SAMPLES = 20
const DEFAULT_PRESENTATION_FPS = 60

export interface ReversePlaybackWindowPlan {
  highFrame: number
  lowFrame: number
  refillFrame: number
  strideFrames: number
  targetFrames: number[]
}

/**
 * Build the timeline-frame targets for a reverse decoded-frame window.
 *
 * The signed transport clock remains authoritative. At faster shuttle rates we
 * sample only frames that can plausibly reach the display, letting the clock
 * skip intermediate authored frames instead of making decoding slow transport.
 */
export function resolveReversePlaybackWindowPlan(input: {
  targetFrame: number
  fps: number
  playbackRate: number
  maxSamples?: number
  presentationFps?: number
}): ReversePlaybackWindowPlan {
  const targetFrame = Math.max(0, Math.round(input.targetFrame))
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30
  const rate =
    Number.isFinite(input.playbackRate) && input.playbackRate !== 0
      ? Math.abs(input.playbackRate)
      : 1
  const presentationFps =
    Number.isFinite(input.presentationFps) && Number(input.presentationFps) > 0
      ? Number(input.presentationFps)
      : DEFAULT_PRESENTATION_FPS
  const maxSamples = Math.max(
    2,
    Math.round(input.maxSamples ?? DEFAULT_REVERSE_WINDOW_SAMPLES),
  )
  const strideFrames = Math.max(1, Math.round((rate * fps) / presentationFps))
  const targetFrames: number[] = []

  for (let index = 0; index < maxSamples; index += 1) {
    const frame = targetFrame - index * strideFrames
    if (frame < 0) break
    targetFrames.push(frame)
  }

  const lowFrame = targetFrames.at(-1) ?? targetFrame
  const spanFrames = Math.max(0, targetFrame - lowFrame)
  return {
    highFrame: targetFrame,
    lowFrame,
    // Refill after roughly 60% of the prepared interval has been consumed,
    // preserving the remaining frames while the next forward decode settles.
    refillFrame: Math.max(lowFrame, targetFrame - Math.round(spanFrames * 0.6)),
    strideFrames,
    targetFrames,
  }
}

export function shouldQueueReversePlaybackWindow(input: {
  targetFrame: number
  preparedLowFrame: number | null
  preparedHighFrame: number | null
  refillFrame: number | null
  requestInFlight: boolean
}): boolean {
  if (input.requestInFlight) return false
  if (
    input.preparedLowFrame === null ||
    input.preparedHighFrame === null ||
    input.refillFrame === null
  ) {
    return true
  }
  if (
    input.targetFrame > input.preparedHighFrame ||
    input.targetFrame < input.preparedLowFrame
  ) {
    return true
  }
  return input.targetFrame <= input.refillFrame
}

export interface ReversePlaybackWindowSchedulerDeps {
  /** Timeline fps the window is planned against. */
  fps: number
  /** Proxy previews are in use, so scheduled sources also get a fallback. */
  useProxy: boolean
  getPlaybackState: () => { isPlaying: boolean; playbackRate: number }
  /** Source timestamps the visible tracks need at `frame`. */
  collectSourceTimes: (frame: number) => Map<string, number[]>
  batchPreseek: typeof backgroundBatchPreseek
  scheduleProxyFallback: (src: string, timestamp: number) => void
}

export interface ReversePlaybackWindowScheduler {
  /** Preseek the window behind `targetFrame`, replacing any older window. */
  schedule: (targetFrame: number) => void
  /** Drop the prepared window and abort anything in flight. */
  reset: () => void
}

/**
 * Owns the reverse-playback decode window: which frames are prepared behind the
 * transport clock, and which request is filling them.
 *
 * The window's state stays private, so the callers only decide *when* to
 * preseek (the rAF pump for playback, and the playback-lifecycle handler for
 * direction changes) and reset on every transport discontinuity. Resetting is
 * what stops a window prepared for the previous direction from being presented
 * as current, which is why `reset` bumps the generation rather than just
 * clearing timestamps.
 */
export function createReversePlaybackWindowScheduler(
  deps: ReversePlaybackWindowSchedulerDeps,
): ReversePlaybackWindowScheduler {
  let generation = 0
  let request: Promise<void> | null = null
  let abortController: AbortController | null = null
  let preparedLowFrame: number | null = null
  let preparedHighFrame: number | null = null
  let refillFrame: number | null = null
  let queuedTargetFrame: number | null = null
  let retryAfterMs = 0

  const reset = (): void => {
    generation += 1
    abortController?.abort()
    abortController = null
    request = null
    preparedLowFrame = null
    preparedHighFrame = null
    refillFrame = null
    queuedTargetFrame = null
    retryAfterMs = 0
  }

  function schedule(targetFrame: number): void {
    const playbackState = deps.getPlaybackState()
    if (!playbackState.isPlaying || playbackState.playbackRate >= 0) return
    if (request) {
      queuedTargetFrame = targetFrame
      return
    }
    if (performance.now() < retryAfterMs) return
    if (
      !shouldQueueReversePlaybackWindow({
        targetFrame,
        preparedLowFrame,
        preparedHighFrame,
        refillFrame,
        requestInFlight: false,
      })
    ) {
      return
    }

    const plan = resolveReversePlaybackWindowPlan({
      targetFrame,
      fps: deps.fps,
      playbackRate: playbackState.playbackRate,
    })
    const bySource = new Map<string, number[]>()
    for (const frame of plan.targetFrames) {
      for (const [src, timestamps] of deps.collectSourceTimes(frame)) {
        const accumulated = bySource.get(src) ?? []
        accumulated.push(...timestamps)
        bySource.set(src, accumulated)
      }
    }

    if (bySource.size === 0) {
      preparedLowFrame = plan.lowFrame
      preparedHighFrame = plan.highFrame
      refillFrame = plan.refillFrame
      return
    }

    if (deps.useProxy) {
      for (const [src, timestamps] of bySource) {
        const currentTimestamp = timestamps[0]
        if (currentTimestamp !== undefined) {
          deps.scheduleProxyFallback(src, currentTimestamp)
        }
      }
    }

    const windowGeneration = ++generation
    const controller = new AbortController()
    abortController = controller
    request = Promise.all(
      [...bySource].map(([src, timestamps]) =>
        deps.batchPreseek(src, timestamps, {
          signal: controller.signal,
          cacheCapacity: 28,
          // Reverse windows are transient preview proxies. Keeping them
          // modestly sized yields a much deeper frame runway for the same
          // memory than full-resolution ImageBitmaps.
          maxDimension: 720,
        }),
      ),
    )
      .then((results) => {
        if (windowGeneration !== generation || controller.signal.aborted) return
        const decodedFrameCount = results.reduce((sum, frames) => sum + frames.size, 0)
        if (decodedFrameCount === 0) {
          preparedLowFrame = null
          preparedHighFrame = null
          refillFrame = null
          retryAfterMs = performance.now() + 120
          return
        }
        preparedLowFrame = plan.lowFrame
        preparedHighFrame = plan.highFrame
        refillFrame = plan.refillFrame
      })
      .finally(() => {
        if (windowGeneration !== generation) return
        request = null
        abortController = null
        const queuedTarget = queuedTargetFrame
        queuedTargetFrame = null
        if (queuedTarget !== null) {
          schedule(queuedTarget)
        }
      })
  }

  return { schedule, reset }
}
