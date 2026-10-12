/**
 * Drives RIFE frame interpolation jobs and imports each result into the media library.
 *
 * One job at a time: RIFE saturates the GPU, so a second concurrent render makes both slower
 * without finishing either sooner.
 *
 * Statuses are keyed by the *source* media id — that is what the user sees a spinner on. The
 * generated item arrives via `onMediaCreated`, which the store wires to `prependMediaItem`.
 */

import type { InterpolationFactor } from '@/infrastructure/interpolation'
import { createLogger } from '@/shared/logging/logger'
import { createManagedWorker } from '@/shared/utils/managed-worker'
import type { MediaMetadata } from '@/types/storage'
import {
  INTERPOLATED_MEDIA_TAG,
  INTERPOLATION_TMP_DIR,
  interpolatedFileName,
  type InterpolationStage,
} from '../frame-interpolation-constants'
import type {
  InterpolationWorkerRequest,
  InterpolationWorkerResponse,
} from '../workers/frame-interpolation-worker'

const logger = createLogger('FrameInterpolationService')

const PROGRESS_EMIT_INTERVAL_MS = 150
const PROGRESS_EMIT_MIN_DELTA = 0.01

type InterpolationStatus = 'generating' | 'ready' | 'error' | 'idle'

type InterpolationStatusListener = (
  mediaId: string,
  status: InterpolationStatus,
  progress?: number,
  stage?: InterpolationStage,
  etaSeconds?: number | null,
) => void

type InterpolationMediaListener = (media: MediaMetadata, projectId: string) => void

type InterpolationSourceLoader = () => Promise<Blob | null>
interface InterpolationOpfsSource {
  kind: 'opfs'
  path: string
  mimeType?: string
}
type InterpolationSourceInput = Blob | InterpolationSourceLoader | InterpolationOpfsSource

interface InterpolationRequest {
  /** The source media item; statuses and progress are reported against this id. */
  mediaId: string
  projectId: string
  fileName: string
  factor: InterpolationFactor
  source: InterpolationSourceInput
  sourceFps: number
}

interface Job extends InterpolationRequest {
  jobId: string
}

async function readTmpFile(jobId: string): Promise<File | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(INTERPOLATION_TMP_DIR, { create: true })
    const handle = await dir.getFileHandle(`${jobId}.mp4`)
    return await handle.getFile()
  } catch {
    return null
  }
}

async function removeTmpFile(jobId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(INTERPOLATION_TMP_DIR, { create: true })
    await dir.removeEntry(`${jobId}.mp4`)
  } catch {
    // Already gone.
  }
}

export class FrameInterpolationService {
  private readonly pendingJobs: Job[] = []
  private readonly jobsByMediaId = new Map<string, Job>()
  private activeJob: Job | null = null
  private readonly cancelledJobIds = new Set<string>()

  private statusListener: InterpolationStatusListener | null = null
  private mediaListener: InterpolationMediaListener | null = null
  private readonly lastEmit = new Map<string, { at: number; progress: number }>()

  private readonly workerManager = createManagedWorker({
    createWorker: () =>
      new Worker(new URL('../workers/frame-interpolation-worker.ts', import.meta.url), {
        type: 'module',
      }),
    setupWorker: (worker) => {
      worker.onmessage = (event: MessageEvent<InterpolationWorkerResponse>) => {
        void this.handleWorkerMessage(event.data)
      }
      worker.onerror = (error) => logger.error('Frame interpolation worker error', { error })
      return () => {
        worker.onmessage = null
        worker.onerror = null
      }
    },
  })

  onStatusChange(listener: InterpolationStatusListener): void {
    this.statusListener = listener
  }

  onMediaCreated(listener: InterpolationMediaListener): void {
    this.mediaListener = listener
  }

  /** Only video sources have frames to interpolate between. */
  canInterpolate(mimeType: string): boolean {
    return mimeType.startsWith('video/')
  }

  isGenerating(mediaId: string): boolean {
    return this.jobsByMediaId.has(mediaId)
  }

  generate(request: InterpolationRequest): void {
    if (this.jobsByMediaId.has(request.mediaId)) return

    const job: Job = { ...request, jobId: crypto.randomUUID() }
    this.jobsByMediaId.set(request.mediaId, job)
    this.pendingJobs.push(job)
    this.statusListener?.(request.mediaId, 'generating', 0, 'preparing')
    void this.drain()
  }

  cancel(mediaId: string): void {
    const job = this.jobsByMediaId.get(mediaId)
    if (!job) return

    const queuedIndex = this.pendingJobs.findIndex((pending) => pending.jobId === job.jobId)
    if (queuedIndex >= 0) {
      this.pendingJobs.splice(queuedIndex, 1)
      this.finish(job, 'idle')
      return
    }

    this.cancelledJobIds.add(job.jobId)
    this.finish(job, 'idle')
    if (this.activeJob?.jobId === job.jobId) {
      this.post({ type: 'cancel', jobId: job.jobId })
    }
  }

  cancelAll(): void {
    for (const mediaId of [...this.jobsByMediaId.keys()]) {
      this.cancel(mediaId)
    }
  }

  private post(message: InterpolationWorkerRequest): void {
    this.workerManager.getWorker().postMessage(message)
  }

  /** Throttled: a render can emit thousands of progress ticks. */
  private emitProgress(
    job: Job,
    progress: number,
    stage: InterpolationStage,
    etaSeconds?: number | null,
  ): void {
    const last = this.lastEmit.get(job.jobId)
    const now = Date.now()
    if (
      last &&
      now - last.at < PROGRESS_EMIT_INTERVAL_MS &&
      Math.abs(progress - last.progress) < PROGRESS_EMIT_MIN_DELTA &&
      progress < 1
    ) {
      return
    }
    this.lastEmit.set(job.jobId, { at: now, progress })
    this.statusListener?.(job.mediaId, 'generating', progress, stage, etaSeconds)
  }

  private finish(job: Job, status: InterpolationStatus): void {
    this.jobsByMediaId.delete(job.mediaId)
    this.lastEmit.delete(job.jobId)
    this.statusListener?.(job.mediaId, status)
  }

  private async drain(): Promise<void> {
    if (this.activeJob) return
    const job = this.pendingJobs.shift()
    if (!job) return

    this.activeJob = job

    let source: Blob | undefined
    let sourceOpfsPath: string | undefined
    let sourceMimeType: string | undefined

    try {
      if (job.source instanceof Blob) {
        source = job.source
      } else if (typeof job.source === 'function') {
        const loaded = await job.source()
        if (!loaded) throw new Error('Source bytes unavailable')
        source = loaded
      } else {
        sourceOpfsPath = job.source.path
        sourceMimeType = job.source.mimeType
      }
    } catch (error) {
      this.activeJob = null
      if (this.cancelledJobIds.delete(job.jobId)) {
        void this.drain()
        return
      }
      logger.error('Frame interpolation source load failed', { mediaId: job.mediaId, error })
      this.finish(job, 'error')
      void this.drain()
      return
    }

    if (this.cancelledJobIds.delete(job.jobId)) {
      this.activeJob = null
      await removeTmpFile(job.jobId)
      void this.drain()
      return
    }

    this.post({
      type: 'interpolate',
      jobId: job.jobId,
      source,
      sourceOpfsPath,
      sourceMimeType,
      sourceFps: job.sourceFps,
      factor: job.factor,
    })
  }

  private async handleWorkerMessage(message: InterpolationWorkerResponse): Promise<void> {
    const job = this.activeJob
    if (!job || job.jobId !== message.jobId) return

    if (message.type === 'progress') {
      if (!this.cancelledJobIds.has(job.jobId)) {
        this.emitProgress(job, message.progress, message.stage, message.etaSeconds)
      }
      return
    }

    this.activeJob = null

    try {
      if (this.cancelledJobIds.has(job.jobId)) {
        await removeTmpFile(job.jobId)
      } else if (message.type === 'complete') {
        await this.importResult(job, message.result.outputFps)
      } else if (message.type === 'error') {
        logger.error('Frame interpolation failed', { mediaId: job.mediaId, error: message.error })
        this.finish(job, 'error')
      } else {
        this.finish(job, 'idle')
      }
    } finally {
      this.cancelledJobIds.delete(job.jobId)
      void this.drain()
    }
  }

  private async importResult(job: Job, outputFps: number): Promise<void> {
    try {
      const rendered = await readTmpFile(job.jobId)
      if (this.cancelledJobIds.has(job.jobId)) return
      if (!rendered || rendered.size === 0) {
        throw new Error('Interpolated render produced no file')
      }

      const file = new File([rendered], interpolatedFileName(job.fileName, outputFps), {
        type: 'video/mp4',
      })
      // Imported lazily. The media-library store imports this service, so a static import
      // would drag media-library-service's whole graph (mediabunny, OPFS, thumbnails) into
      // every consumer of the store. The `media-library-service-loader` wrapper is avoided
      // deliberately: it registers a loader at import time, a side effect the store's tests
      // stub out.
      const { mediaLibraryService } = await import('./media-library-service')
      if (this.cancelledJobIds.has(job.jobId)) return
      const media = await mediaLibraryService.importGeneratedVideo(file, job.projectId, {
        fps: outputFps,
        tags: [INTERPOLATED_MEDIA_TAG],
      })

      if (this.cancelledJobIds.has(job.jobId)) {
        await mediaLibraryService.deleteMediaFromProject(job.projectId, media.id)
        return
      }

      this.mediaListener?.(media, job.projectId)
      this.finish(job, 'ready')
      logger.info('Interpolated media imported', {
        sourceMediaId: job.mediaId,
        mediaId: media.id,
        fps: outputFps,
      })
    } catch (error) {
      if (this.cancelledJobIds.has(job.jobId)) {
        logger.error('Failed to roll back cancelled interpolation import', {
          mediaId: job.mediaId,
          error,
        })
        return
      }
      logger.error('Failed to import interpolated media', { mediaId: job.mediaId, error })
      this.finish(job, 'error')
    } finally {
      await removeTmpFile(job.jobId)
    }
  }
}

export const frameInterpolationService = new FrameInterpolationService()
