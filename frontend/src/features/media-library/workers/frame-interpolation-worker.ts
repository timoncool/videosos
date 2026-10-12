/**
 * Frame Interpolation Worker
 *
 * Renders a higher-frame-rate copy of a video: same duration, `factor`x the frames, with the
 * in-between frames synthesized by RIFE on WebGPU. The output is written to an OPFS scratch
 * file; the service imports it into the media library and deletes the scratch copy.
 *
 * This cannot use mediabunny's high-level `Conversion` API the way proxy generation does —
 * `Conversion` is a straight transcode with no hook to inject invented frames. So we drive
 * `VideoSampleSink` for decode and `VideoSampleSource` for encode, with RIFE in between.
 *
 * Audio is copied through without re-encoding. The output has the same duration as the source,
 * so the original packets stay valid; they are pumped in step with the video timeline rather
 * than up front, or the muxer buffers the entire video track.
 */

import { ensureProResDecoderRegistered } from '@/infrastructure/browser/register-prores-decoder'
import {
  clampRenderSize,
  interpolateGap,
  RifeInterpolator,
  type InterpolationFactor,
} from '@/infrastructure/interpolation'
import { createLogger } from '@/shared/logging/logger'
import { planarRgbToRgba, rgbaToPlanarRgb } from '@/shared/utils/planar-rgb'
import { RenderProgress } from '@/shared/utils/render-progress'
import {
  INTERPOLATION_TMP_DIR,
  interpolationTmpPath,
  type InterpolationResult,
  type InterpolationStage,
} from '../frame-interpolation-constants'
import {
  Cancelled,
  CancellationRegistry,
  createRenderCanvas,
  EncodeQueue,
  getSourceBlobFromOpfs,
  createMp4Encoder,
  medianFps,
  OpfsScratch,
  openVideoSource,
  setupAudioCopy,
  type InputInstance,
  type Mediabunny,
  type VideoSampleInstance,
} from './render-support'

const logger = createLogger('FrameInterpolationWorker')

export interface InterpolateRequest {
  type: 'interpolate'
  jobId: string
  source?: Blob
  sourceOpfsPath?: string
  sourceMimeType?: string
  /** Only a hint, for the ETA before the first frame decodes. The true rate is measured. */
  sourceFps: number
  factor: InterpolationFactor
}

export interface InterpolateCancelRequest {
  type: 'cancel'
  jobId: string
}

export interface InterpolationProgressResponse {
  type: 'progress'
  jobId: string
  stage: InterpolationStage
  /** 0..1 within the current stage. */
  progress: number
  /** Seconds left in the render, or null while the rate estimate warms up. */
  etaSeconds?: number | null
  fromCache?: boolean
}

export interface InterpolationCompleteResponse {
  type: 'complete'
  jobId: string
  opfsPath: string
  result: InterpolationResult
}

export interface InterpolationErrorResponse {
  type: 'error'
  jobId: string
  error: string
}

export interface InterpolationCancelledResponse {
  type: 'cancelled'
  jobId: string
}

export type InterpolationWorkerRequest = InterpolateRequest | InterpolateCancelRequest
export type InterpolationWorkerResponse =
  | InterpolationProgressResponse
  | InterpolationCompleteResponse
  | InterpolationErrorResponse
  | InterpolationCancelledResponse

const jobs = new CancellationRegistry()
const scratch = new OpfsScratch(INTERPOLATION_TMP_DIR)

/** Compiled sessions and model bytes survive across jobs — each session costs ~500ms. */
let interpolator: RifeInterpolator | null = null

const loadMediabunny = async () => import('mediabunny')

function post(message: InterpolationWorkerResponse): void {
  self.postMessage(message)
}

function assertUsableSourceFps(sourceFps: number): void {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) {
    throw new Error(`Frame interpolation needs a known source frame rate, got ${sourceFps}`)
  }
}

/** Release a decoded frame the encode queue never took ownership of. */
function releaseUnqueuedFrame(frame: { encoded: VideoSampleInstance | null } | null): void {
  frame?.encoded?.close()
}

/** Warm the shared RIFE session, reporting the one-time model download against `jobId`. */
async function ensureInterpolator(jobId: string): Promise<RifeInterpolator> {
  if (!interpolator) {
    interpolator = new RifeInterpolator({
      onDownloadProgress: ({ receivedBytes, totalBytes, fromCache }) => {
        post({
          type: 'progress',
          jobId,
          stage: 'downloading-model',
          progress: totalBytes > 0 ? receivedBytes / totalBytes : 0,
          fromCache,
        })
      },
    })
  }
  const rife = interpolator
  await rife.ready()
  return rife
}

/** Render target + encoder. Split out so `interpolate` can dispose the decoder if it throws. */
async function setupRender(
  mb: Mediabunny,
  request: InterpolateRequest,
  input: InputInstance,
  sourceWidth: number,
  sourceHeight: number,
) {
  const { width, height } = clampRenderSize(sourceWidth, sourceHeight)
  const outputFps = request.sourceFps * request.factor
  const { canvas, ctx } = createRenderCanvas(width, height)
  const { output, videoSource, codec } = await createMp4Encoder(
    mb,
    await scratch.createWritable(request.jobId),
    { width, height, fps: outputFps },
  )
  // Every track must be declared before `start()`.
  const audio = await setupAudioCopy(mb, input, output)
  await output.start()
  return { width, height, outputFps, canvas, ctx, output, videoSource, audio, codec }
}

async function interpolate(request: InterpolateRequest): Promise<void> {
  const { jobId, factor, sourceFps } = request

  assertUsableSourceFps(sourceFps)
  await ensureProResDecoderRegistered()
  const mb = await loadMediabunny()

  const rife = await ensureInterpolator(jobId)
  jobs.throwIfCancelled(jobId)
  post({ type: 'progress', jobId, stage: 'preparing', progress: 0 })

  const sourceBlob = request.source
    ? request.source
    : await getSourceBlobFromOpfs(request.sourceOpfsPath!, request.sourceMimeType)
  // Frame size comes from the decoder, not from the media library. A rotated phone video reports
  // landscape dimensions in its container metadata while decoding to portrait frames; trusting the
  // library would squash it into the wrong aspect.
  const {
    input,
    sink,
    totalSeconds,
    width: sourceWidth,
    height: sourceHeight,
  } = await openVideoSource(mb, sourceBlob)
  const { width, height, canvas, ctx, output, videoSource, audio, codec } = await setupRender(
    mb,
    request,
    input,
    sourceWidth,
    sourceHeight,
  ).catch((error: unknown) => {
    input.dispose()
    throw error
  })

  const scratchRgba = new Uint8ClampedArray(width * height * 4)
  const queue = new EncodeQueue(videoSource)

  /** Encode a frame RIFE invented. Only synthesized frames pay the float -> RGBA cost. */
  const encodePlanar = (planar: Float32Array, timestamp: number, duration: number) => {
    planarRgbToRgba(planar, width, height, scratchRgba)
    ctx.putImageData(new ImageData(scratchRgba, width, height), 0, 0)
    return queue.add(new mb.VideoSample(canvas, { timestamp, duration }))
  }

  /**
   * Draw a decoded frame once, then take two things from the canvas: the planar tensor RIFE
   * needs, and an encoder-ready snapshot. Source frames used to be rebuilt from their own
   * float tensor on the way out — a pointless round trip through 921k pixels of JS.
   * `VideoSample` copies the canvas, so overwriting it for the next frame is safe.
   */
  const decodeFrame = (sample: InstanceType<typeof mb.VideoSample>) => {
    sample.draw(ctx, 0, 0, width, height)
    return {
      planar: rgbaToPlanarRgb(ctx.getImageData(0, 0, width, height).data, width, height),
      // Timestamps are rewritten once the gap to the next frame is known.
      encoded: new mb.VideoSample(canvas, { timestamp: 0, duration: 0 }),
    }
  }

  // `sourceFps` is a timestamp-derived best guess. The output and progress estimate still
  // re-derive the de facto cadence from decoded timestamps for VFR or dropped-frame sources.
  const gaps: number[] = []
  const progress = new RenderProgress(totalSeconds, sourceFps)
  let sourceFramesSeen = 0

  // `encoded` is nulled the moment the queue takes ownership, so the error path can close a
  // frame that was never handed over without risking a double close.
  let prev: { planar: Float32Array; encoded: VideoSampleInstance | null } | null = null
  let prevTimestamp = 0
  let lastGap = 1 / sourceFps

  try {
    for await (const sample of sink.samples()) {
      jobs.throwIfCancelled(jobId)

      const timestamp = sample.timestamp
      let current: ReturnType<typeof decodeFrame>
      try {
        current = decodeFrame(sample)
      } finally {
        sample.close()
      }

      let gapSeconds: number | null = null
      if (prev?.encoded) {
        // Derive the sub-frame step from the real gap rather than 1/sourceFps, so
        // variable-frame-rate sources keep their timing instead of being resampled.
        const gap = Math.max(timestamp - prevTimestamp, 1e-6)
        gapSeconds = gap
        lastGap = gap
        gaps.push(gap)
        const step = gap / factor

        const sourceFrame = prev.encoded
        prev.encoded = null
        sourceFrame.setTimestamp(prevTimestamp)
        sourceFrame.setDuration(step)
        await queue.add(sourceFrame)

        const between = await interpolateGap(
          prev.planar,
          current.planar,
          factor,
          (left, right, timestep) => rife.interpolate(left, right, width, height, timestep),
        )
        for (let k = 0; k < between.length; k++) {
          jobs.throwIfCancelled(jobId)
          await encodePlanar(between[k]!, prevTimestamp + step * (k + 1), step)
        }

        // Keep the audio track level with the video the muxer has just received.
        await audio.pumpUntil(timestamp)
      }

      prev = current
      prevTimestamp = timestamp
      sourceFramesSeen++
      progress.tick(performance.now(), gapSeconds)

      post({
        type: 'progress',
        jobId,
        stage: 'rendering',
        progress: progress.fraction,
        etaSeconds: progress.etaSeconds,
      })
    }

    if (!prev?.encoded) throw new Error('Source produced no decodable video frames')

    // Trailing source frame: nothing follows it, so it gets one inter-frame duration.
    const lastFrame = prev.encoded
    prev.encoded = null
    lastFrame.setTimestamp(prevTimestamp)
    lastFrame.setDuration(lastGap)
    await queue.add(lastFrame)
    await queue.drain()
    await audio.drain()

    const frameCount = queue.count
    await output.finalize()

    const measuredSourceFps = medianFps(gaps, sourceFps)
    const result: InterpolationResult = {
      factor,
      width,
      height,
      sourceWidth,
      sourceHeight,
      sourceFps: measuredSourceFps,
      outputFps: measuredSourceFps * factor,
      codec,
      frameCount,
    }

    logger.info('Frame interpolation complete', {
      jobId,
      factor,
      width,
      height,
      sourceFrames: sourceFramesSeen,
      outputFrames: frameCount,
      backend: rife.activeBackend,
    })
    post({ type: 'complete', jobId, opfsPath: interpolationTmpPath(jobId), result })
  } catch (error) {
    // Release the frame the queue never took, and settle the in-flight encode before
    // cancelling — an un-awaited rejected `add()` would surface as an unhandled rejection.
    releaseUnqueuedFrame(prev)
    await queue.drain().catch(() => {})
    // `output.cancel()` releases the encoder and closes the writable. Without it the partial
    // OPFS file stays locked and a retry cannot reopen it.
    await output.cancel().catch(() => {})
    await scratch.remove(jobId)
    throw error
  } finally {
    input.dispose()
  }
}

self.onmessage = async (event: MessageEvent<InterpolationWorkerRequest>) => {
  const request = event.data

  if (request.type === 'cancel') {
    jobs.cancel(request.jobId)
    return
  }

  const { jobId } = request
  jobs.clear(jobId)

  try {
    await interpolate(request)
  } catch (error) {
    if (error instanceof Cancelled || jobs.isCancelled(jobId)) {
      await scratch.remove(jobId)
      post({ type: 'cancelled', jobId })
    } else {
      logger.error('Frame interpolation failed', { jobId, error })
      post({
        type: 'error',
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    jobs.clear(jobId)
  }
}
