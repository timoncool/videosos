/**
 * Scene detection service.
 *
 * - `histogram`: sparse, fast video-element sampling.
 * - `adaptive`: frame-accurate sequential decode with rolling content-change classification.
 *
 * Either path can optionally feed deterministic candidates into a local VLM verifier.
 */

import {
  getObjectUrlBlob,
  getObjectUrlSourceMetadata,
} from '@/infrastructure/browser/object-url-registry'
import { createLogger } from '@/shared/logging/logger'
import { createAdaptiveSceneDetectionWorker } from './create-adaptive-scene-detection-worker'
import { detectScenesHistogram } from './histogram-scene-detection'
import { seekVideo } from './scene-detection-utils'
import type {
  AdaptiveSceneWorkerRequest,
  AdaptiveSceneWorkerResponse,
} from './adaptive-scene-detection-worker.types'
import type {
  SceneCut,
  SceneDetectionMethod,
  SceneDetectionProgress,
} from './scene-detection-types'
import { SCENE_DETECTOR_VERSION } from './scene-detection-types'
import { getSceneVerificationProvider, type VerificationModel } from './verification/registry'
import type { SceneVerificationProvider } from './verification/types'

const log = createLogger('SceneDetection')

const HISTOGRAM_SAMPLE_INTERVAL_MS = 250
const VERIFY_MAX_DIM = 480
const VERIFY_WORKER_INACTIVITY_MS = 30_000
const VERIFY_CANDIDATE_TIMEOUT_MS = 60_000

const resultsCache = new Map<string, SceneCut[]>()

export interface DetectScenesOptions {
  method?: SceneDetectionMethod
  /** Sparse histogram sampling interval. Ignored by the adaptive detector. */
  sampleIntervalMs?: number
  /** Local VLM used to verify deterministic candidates. */
  verificationModel?: VerificationModel | null
  onProgress?: (progress: SceneDetectionProgress) => void
  signal?: AbortSignal
  mediaId?: string
  /** Native source FPS, used to capture adjacent verification frames. */
  sourceFps?: number
}

function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

function cloneCuts(cuts: readonly SceneCut[]): SceneCut[] {
  return cuts.map((cut) => ({ ...cut, metrics: { ...cut.metrics } }))
}

function cacheKeyFor(
  mediaId: string,
  method: SceneDetectionMethod,
  sampleIntervalMs: number,
  verificationModel?: VerificationModel,
): string {
  const cadence = method === 'adaptive' ? 'every-frame' : `${sampleIntervalMs}ms`
  return `${mediaId}:v${SCENE_DETECTOR_VERSION}:${method}:${cadence}:${verificationModel ?? 'none'}`
}

function resolveVerificationModel(
  method: SceneDetectionMethod,
  requested: VerificationModel | null | undefined,
): VerificationModel | undefined {
  if (requested !== undefined) return requested ?? undefined
  return method === 'adaptive' ? 'gemma' : undefined
}

function readCachedCuts(cacheKey: string | undefined, mediaId: string | undefined) {
  if (!cacheKey) return undefined
  const cached = resultsCache.get(cacheKey)
  if (!cached) return undefined

  log.info('Returning cached scene detection results', { mediaId, cuts: cached.length })
  return cloneCuts(cached)
}

async function detectCandidates(
  video: HTMLVideoElement,
  method: SceneDetectionMethod,
  sampleIntervalMs: number,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  if (method === 'histogram') {
    return detectScenesHistogram(video, { sampleIntervalMs, onProgress, signal })
  }
  return detectScenesAdaptive(video, onProgress, signal)
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
}

async function verifyCandidates(
  video: HTMLVideoElement,
  candidates: SceneCut[],
  verificationModel: VerificationModel | undefined,
  sourceFps: number,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  if (!verificationModel || candidates.length === 0) return candidates

  const provider = getSceneVerificationProvider(verificationModel)
  try {
    const verified = await verifyWithVlm(
      provider,
      video,
      candidates,
      verificationModel,
      sourceFps,
      onProgress,
      signal,
    )
    log.info('VLM verification complete', {
      model: verificationModel,
      confirmed: verified.length,
      candidates: candidates.length,
    })
    provider.disposeWorker()
    return verified
  } catch (error) {
    provider.resetWorker()
    if (isAbortFailure(error, signal)) throw createAbortError()

    log.warn('VLM verification failed, using deterministic scene candidates', {
      model: verificationModel,
      error: error instanceof Error ? error.message : String(error),
    })
    return candidates
  }
}

export async function detectScenes(
  video: HTMLVideoElement,
  options: DetectScenesOptions = {},
): Promise<SceneCut[]> {
  const { method = 'histogram', onProgress, signal, mediaId } = options
  const sampleIntervalMs = options.sampleIntervalMs ?? HISTOGRAM_SAMPLE_INTERVAL_MS
  const verificationModel = resolveVerificationModel(method, options.verificationModel)

  throwIfAborted(signal)

  const cacheKey = mediaId
    ? cacheKeyFor(mediaId, method, sampleIntervalMs, verificationModel)
    : undefined
  const cached = readCachedCuts(cacheKey, mediaId)
  if (cached) return cached

  const candidates = await detectCandidates(video, method, sampleIntervalMs, onProgress, signal)
  throwIfAborted(signal)

  const results = await verifyCandidates(
    video,
    candidates,
    verificationModel,
    options.sourceFps ?? 30,
    onProgress,
    signal,
  )
  throwIfAborted(signal)

  if (cacheKey) resultsCache.set(cacheKey, cloneCuts(results))
  return results
}

async function detectScenesAdaptive(
  video: HTMLVideoElement,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  throwIfAborted(signal)

  const sourceUrl = video.currentSrc || video.src
  if (!sourceUrl) throw new Error('Scene analysis requires a resolved media source')

  const requestId = crypto.randomUUID()
  const worker = createAdaptiveSceneDetectionWorker()
  const fallbackBlob = getObjectUrlBlob(sourceUrl) ?? undefined
  const sourceMetadata = getObjectUrlSourceMetadata(sourceUrl) ?? undefined

  return new Promise<SceneCut[]>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onWorkerError)
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const finish = (result: { cuts: SceneCut[] } | { error: unknown }) => {
      if (settled) return
      settled = true
      cleanup()
      if ('error' in result) reject(result.error)
      else resolve(result.cuts)
    }
    const onAbort = () => {
      const abortRequest: AdaptiveSceneWorkerRequest = { type: 'abort', requestId }
      worker.postMessage(abortRequest)
      finish({ error: createAbortError() })
    }
    const onWorkerError = (event: ErrorEvent) => {
      finish({ error: new Error(event.message || 'Adaptive scene worker failed') })
    }
    const onMessage = (event: MessageEvent<AdaptiveSceneWorkerResponse>) => {
      const response = event.data
      if (response.requestId !== requestId) return

      if (response.type === 'progress') {
        onProgress?.({
          percent: response.percent,
          completed: response.decodedFrames,
          total: 0,
          sceneCuts: response.sceneCuts,
          stage: response.stage,
        })
      } else if (response.type === 'complete') {
        log.info('Adaptive scene pass complete', {
          decodedFrames: response.decodedFrames,
          cuts: response.cuts.length,
        })
        finish({ cuts: response.cuts })
      } else if (response.type === 'aborted') {
        finish({ error: createAbortError() })
      } else {
        finish({ error: new Error(response.error) })
      }
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onWorkerError)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    const request: AdaptiveSceneWorkerRequest = {
      type: 'analyze',
      requestId,
      sourceUrl,
      fallbackBlob,
      sourceMetadata,
      duration: video.duration,
    }
    worker.postMessage(request)
  })
}

async function captureFrameBlob(video: HTMLVideoElement, timeSec: number): Promise<Blob> {
  await seekVideo(video, timeSec)

  const videoWidth = video.videoWidth || 640
  const videoHeight = video.videoHeight || 360
  const scale = Math.min(VERIFY_MAX_DIM / Math.max(videoWidth, videoHeight), 1)
  const width = Math.max(1, Math.round(videoWidth * scale))
  const height = Math.max(1, Math.round(videoHeight * scale))

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to capture scene verification frame')
  context.drawImage(video, 0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}

async function initializeVerificationWorker(
  worker: Worker,
  modelLabel: string,
  verificationModel: VerificationModel,
  candidateCount: number,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)

  await new Promise<void>((resolve, reject) => {
    let timeout = setTimeout(onTimeout, VERIFY_WORKER_INACTIVITY_MS)
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      worker.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (error?: Error | DOMException) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    function onTimeout() {
      finish(new Error(`${modelLabel} worker init timed out after 30s of inactivity`))
    }
    const onAbort = () => finish(createAbortError())
    const onMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'ready') {
        finish()
      } else if (message.type === 'error') {
        finish(new Error(message.message))
      } else if (message.type === 'progress') {
        clearTimeout(timeout)
        timeout = setTimeout(onTimeout, VERIFY_WORKER_INACTIVITY_MS)
        onProgress?.({
          percent: message.percent,
          completed: 0,
          total: candidateCount,
          sceneCuts: 0,
          stage: 'loading-model',
          verificationModel,
        })
      }
    }

    worker.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.postMessage({ type: 'init' })
  })
}

async function verifyCandidate(
  worker: Worker,
  id: number,
  before: Blob,
  after: Blob,
  signal?: AbortSignal,
): Promise<{ isSceneCut: boolean; reason: string }> {
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(
      () => finish({ error: new Error('Scene verification candidate timed out') }),
      VERIFY_CANDIDATE_TIMEOUT_MS,
    )

    const cleanup = () => {
      clearTimeout(timeout)
      worker.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (
      result: { value: { isSceneCut: boolean; reason: string } } | { error: Error | DOMException },
    ) => {
      if (settled) return
      settled = true
      cleanup()
      if ('error' in result) reject(result.error)
      else resolve(result.value)
    }
    const onAbort = () => finish({ error: createAbortError() })
    const onMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'result' && message.id === id) {
        finish({
          value: { isSceneCut: message.isSceneCut, reason: message.reason },
        })
      } else if (message.type === 'error') {
        finish({
          value: { isSceneCut: false, reason: `worker error: ${message.message}` },
        })
      }
    }

    worker.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.postMessage({ type: 'verify', id, before, after })
  })
}

async function verifyWithVlm(
  provider: SceneVerificationProvider,
  video: HTMLVideoElement,
  candidates: SceneCut[],
  verificationModel: VerificationModel,
  sourceFps: number,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  const worker = provider.getWorker()
  const modelLabel = provider.label

  await initializeVerificationWorker(
    worker,
    modelLabel,
    verificationModel,
    candidates.length,
    onProgress,
    signal,
  )

  const verified: SceneCut[] = []
  const adjacentFrameOffsetSec = Math.max(1 / Math.max(sourceFps, 1), 1 / 120)

  for (let index = 0; index < candidates.length; index++) {
    throwIfAborted(signal)
    const candidate = candidates[index]!

    onProgress?.({
      percent: (index / candidates.length) * 100,
      completed: index,
      total: candidates.length,
      sceneCuts: verified.length,
      stage: 'verifying',
      verificationModel,
    })

    const beforeBlob = await captureFrameBlob(
      video,
      Math.max(0, candidate.time - adjacentFrameOffsetSec),
    )
    const afterBlob = await captureFrameBlob(video, candidate.time)
    const result = await verifyCandidate(worker, index, beforeBlob, afterBlob, signal)

    log.info(`${modelLabel} candidate result`, {
      index,
      time: candidate.time.toFixed(3),
      reason: result.reason,
    })
    if (result.isSceneCut) verified.push({ ...candidate, verified: true })
  }

  onProgress?.({
    percent: 100,
    completed: candidates.length,
    total: candidates.length,
    sceneCuts: verified.length,
    stage: 'verifying',
    verificationModel,
  })
  return verified
}
