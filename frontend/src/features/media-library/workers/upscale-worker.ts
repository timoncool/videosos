/**
 * Upscale Worker
 *
 * Renders a 2x copy of a video: same duration, same frame rate, every frame reconstructed by the
 * Anime4K CNN on WebGPU. The output is written to an OPFS scratch file; the service imports it
 * into the media library and deletes the scratch copy.
 *
 * Like frame interpolation, this cannot use mediabunny's `Conversion` API — that is a straight
 * transcode with no hook to replace frames. So we drive `VideoSampleSink` for decode and
 * `VideoSampleSource` for encode, with the network in between. The shared plumbing for that lives
 * in `render-support.ts`.
 */

import { ensureProResDecoderRegistered } from '@/infrastructure/browser/register-prores-decoder'
import {
  Anime4kUpscaler,
  canUpscale,
  upscaledSize,
  type UpscaleVariant,
} from '@/infrastructure/upscale'
import { createLogger } from '@/shared/logging/logger'
import { planarRgbToRgba, rgbaToPlanarRgb } from '@/shared/utils/planar-rgb'
import { RenderProgress } from '@/shared/utils/render-progress'
import {
  UPSCALE_TMP_DIR,
  upscaleTmpPath,
  type UpscaleResult,
  type UpscaleStage,
} from '../upscale-constants'
import {
  Cancelled,
  CancellationRegistry,
  createMp4Encoder,
  createRenderCanvas,
  EncodeQueue,
  getSourceBlobFromOpfs,
  medianFps,
  OpfsScratch,
  openVideoSource,
  setupAudioCopy,
  type InputInstance,
  type Mediabunny,
} from './render-support'

const logger = createLogger('UpscaleWorker')

export interface UpscaleRequest {
  type: 'upscale'
  jobId: string
  source?: Blob
  sourceOpfsPath?: string
  sourceMimeType?: string
  /** Only a hint, for the ETA before the first frame decodes. The true rate is measured. */
  sourceFps: number
  variant: UpscaleVariant
}

export interface UpscaleCancelRequest {
  type: 'cancel'
  jobId: string
}

export interface UpscaleProgressResponse {
  type: 'progress'
  jobId: string
  stage: UpscaleStage
  /** 0..1 within the current stage. */
  progress: number
  /** Seconds left in the render, or null while the rate estimate warms up. */
  etaSeconds?: number | null
}

export interface UpscaleCompleteResponse {
  type: 'complete'
  jobId: string
  opfsPath: string
  result: UpscaleResult
}

export interface UpscaleErrorResponse {
  type: 'error'
  jobId: string
  error: string
}

export interface UpscaleCancelledResponse {
  type: 'cancelled'
  jobId: string
}

export type UpscaleWorkerRequest = UpscaleRequest | UpscaleCancelRequest
export type UpscaleWorkerResponse =
  | UpscaleProgressResponse
  | UpscaleCompleteResponse
  | UpscaleErrorResponse
  | UpscaleCancelledResponse

const jobs = new CancellationRegistry()
const scratch = new OpfsScratch(UPSCALE_TMP_DIR)

/** Compiled sessions survive across jobs, keyed by variant — each session costs ~500ms. */
const upscalers = new Map<UpscaleVariant, Anime4kUpscaler>()

const loadMediabunny = async () => import('mediabunny')

function post(message: UpscaleWorkerResponse): void {
  self.postMessage(message)
}

/**
 * The UI gates on this too, but a stale menu or a lying probe would otherwise waste an entire
 * render before `configure()` rejected the frame size.
 */
function assertEncodableOutput(width: number, height: number): void {
  if (!canUpscale(width, height)) {
    const out = upscaledSize(width, height)
    throw new Error(
      `Upscaling ${width}x${height} would produce ${out.width}x${out.height}, which exceeds what video encoders accept`,
    )
  }
}

/** Warm the session for this variant. Sessions are per (variant, resolution) and cached. */
async function ensureUpscaler(variant: UpscaleVariant): Promise<Anime4kUpscaler> {
  let upscaler = upscalers.get(variant)
  if (!upscaler) {
    upscaler = new Anime4kUpscaler(variant)
    upscalers.set(variant, upscaler)
  }
  await upscaler.ready()
  return upscaler
}

/** Render targets + encoder. Split out so `upscale` can dispose the decoder if it throws. */
async function setupRender(
  mb: Mediabunny,
  request: UpscaleRequest,
  input: InputInstance,
  width: number,
  height: number,
) {
  const out = upscaledSize(width, height)
  const source = createRenderCanvas(width, height)
  const target = createRenderCanvas(out.width, out.height)
  const { output, videoSource, codec } = await createMp4Encoder(
    mb,
    await scratch.createWritable(request.jobId),
    { width: out.width, height: out.height, fps: request.sourceFps },
  )
  // Every track must be declared before `start()`.
  const audio = await setupAudioCopy(mb, input, output)
  await output.start()
  return { out, source, target, output, videoSource, audio, codec }
}

async function upscale(request: UpscaleRequest): Promise<void> {
  const { jobId, variant, sourceFps } = request

  await ensureProResDecoderRegistered()
  const mb = await loadMediabunny()

  const model = await ensureUpscaler(variant)
  jobs.throwIfCancelled(jobId)
  post({ type: 'progress', jobId, stage: 'preparing', progress: 0 })

  const sourceBlob = request.source
    ? request.source
    : await getSourceBlobFromOpfs(request.sourceOpfsPath!, request.sourceMimeType)
  // Frame size comes from the decoder, not from the media library. A rotated phone video reports
  // landscape dimensions in its container metadata while decoding to portrait frames; trusting
  // the library would squash it into the wrong aspect.
  const {
    input,
    sink,
    totalSeconds,
    width: sourceWidth,
    height: sourceHeight,
  } = await openVideoSource(mb, sourceBlob)

  try {
    assertEncodableOutput(sourceWidth, sourceHeight)
  } catch (error) {
    input.dispose()
    throw error
  }

  const { out, source, target, output, videoSource, audio, codec } = await setupRender(
    mb,
    request,
    input,
    sourceWidth,
    sourceHeight,
  ).catch((error: unknown) => {
    input.dispose()
    throw error
  })

  const scratchRgba = new Uint8ClampedArray(out.width * out.height * 4)
  const queue = new EncodeQueue(videoSource)

  // `sourceFps` is a timestamp-derived best guess. The reported rate and progress estimate still
  // re-derive the de facto cadence from decoded timestamps for VFR or dropped-frame sources.
  const gaps: number[] = []
  const progress = new RenderProgress(totalSeconds, sourceFps)
  let prevTimestamp: number | null = null

  try {
    for await (const sample of sink.samples()) {
      jobs.throwIfCancelled(jobId)

      const timestamp = sample.timestamp
      // A source sample can carry a zero duration; the encoder needs a real one.
      const duration = sample.duration > 0 ? sample.duration : 1 / sourceFps
      let planar: Float32Array
      try {
        sample.draw(source.ctx, 0, 0, sourceWidth, sourceHeight)
        planar = rgbaToPlanarRgb(
          source.ctx.getImageData(0, 0, sourceWidth, sourceHeight).data,
          sourceWidth,
          sourceHeight,
        )
      } finally {
        sample.close()
      }

      const upscaled = await model.upscale(planar, sourceWidth, sourceHeight)
      jobs.throwIfCancelled(jobId)

      planarRgbToRgba(upscaled, out.width, out.height, scratchRgba)
      target.ctx.putImageData(new ImageData(scratchRgba, out.width, out.height), 0, 0)
      // `VideoSample` copies the canvas, so overwriting it for the next frame is safe.
      await queue.add(new mb.VideoSample(target.canvas, { timestamp, duration }))

      // Keep the audio track level with the video the muxer has just received.
      await audio.pumpUntil(timestamp)

      const gap = prevTimestamp === null ? null : Math.max(timestamp - prevTimestamp, 1e-6)
      if (gap !== null) gaps.push(gap)
      prevTimestamp = timestamp
      progress.tick(performance.now(), gap)

      post({
        type: 'progress',
        jobId,
        stage: 'rendering',
        progress: progress.fraction,
        etaSeconds: progress.etaSeconds,
      })
    }

    await queue.drain()
    await audio.drain()

    const frameCount = queue.count
    if (frameCount === 0) throw new Error('Source produced no decodable video frames')
    await output.finalize()

    const result: UpscaleResult = {
      variant,
      width: out.width,
      height: out.height,
      sourceWidth,
      sourceHeight,
      fps: medianFps(gaps, sourceFps),
      codec,
      frameCount,
    }

    logger.info('Upscale complete', {
      jobId,
      variant,
      width: out.width,
      height: out.height,
      frames: frameCount,
      backend: model.activeBackend,
    })
    post({ type: 'complete', jobId, opfsPath: upscaleTmpPath(jobId), result })
  } catch (error) {
    // Settle the in-flight encode before cancelling — an un-awaited rejected `add()` would
    // surface as an unhandled rejection.
    await queue.drain().catch(() => {})
    // `output.cancel()` releases the encoder and closes the writable. Without it the partial OPFS
    // file stays locked and a retry cannot reopen it.
    await output.cancel().catch(() => {})
    await scratch.remove(jobId)
    throw error
  } finally {
    input.dispose()
  }
}

self.onmessage = async (event: MessageEvent<UpscaleWorkerRequest>) => {
  const request = event.data

  if (request.type === 'cancel') {
    jobs.cancel(request.jobId)
    return
  }

  const { jobId } = request
  jobs.clear(jobId)

  try {
    await upscale(request)
  } catch (error) {
    if (error instanceof Cancelled || jobs.isCancelled(jobId)) {
      await scratch.remove(jobId)
      post({ type: 'cancelled', jobId })
    } else {
      logger.error('Upscale failed', { jobId, error })
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
