/**
 * Drives Anime4K upscale jobs and imports each result into the media library.
 *
 * One job at a time: the render saturates the GPU, so a second concurrent job makes both slower
 * without finishing either sooner.
 *
 * Statuses are keyed by the *source* media id — that is what the user sees a spinner on. The
 * generated item arrives via `onMediaCreated`, which the store wires to `prependMediaItem`.
 */

import { canUpscale, type UpscaleVariant } from '@/infrastructure/upscale'
import { createLogger } from '@/shared/logging/logger'
import { createManagedWorker } from '@/shared/utils/managed-worker'
import type { MediaMetadata } from '@/types/storage'
import {
  UPSCALE_TMP_DIR,
  UPSCALED_MEDIA_TAG,
  upscaledFileName,
  type UpscaleStage,
} from '../upscale-constants'
import type { UpscaleWorkerRequest, UpscaleWorkerResponse } from '../workers/upscale-worker'

const logger = createLogger('UpscaleService')

const PROGRESS_EMIT_INTERVAL_MS = 150
const PROGRESS_EMIT_MIN_DELTA = 0.01

type UpscaleStatus = 'generating' | 'ready' | 'error' | 'idle'

type UpscaleStatusListener = (
  mediaId: string,
  status: UpscaleStatus,
  progress?: number,
  stage?: UpscaleStage,
  etaSeconds?: number | null,
) => void

type UpscaleMediaListener = (media: MediaMetadata, projectId: string) => void

type UpscaleSourceLoader = () => Promise<Blob | null>
interface UpscaleOpfsSource {
  kind: 'opfs'
  path: string
  mimeType?: string
}
type UpscaleSourceInput = Blob | UpscaleSourceLoader | UpscaleOpfsSource

interface UpscaleRequestInput {
  /** The source media item; statuses and progress are reported against this id. */
  mediaId: string
  projectId: string
  fileName: string
  variant: UpscaleVariant
  source: UpscaleSourceInput
  sourceFps: number
}

interface Job extends UpscaleRequestInput {
  jobId: string
}

async function readTmpFile(jobId: string): Promise<File | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(UPSCALE_TMP_DIR, { create: true })
    const handle = await dir.getFileHandle(`${jobId}.mp4`)
    return await handle.getFile()
  } catch {
    return null
  }
}

async function removeTmpFile(jobId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(UPSCALE_TMP_DIR, { create: true })
    await dir.removeEntry(`${jobId}.mp4`)
  } catch {
    // Already gone.
  }
}

export class UpscaleService {
  private readonly pendingJobs: Job[] = []
  private readonly jobsByMediaId = new Map<string, Job>()
  private activeJob: Job | null = null
  private readonly cancelledJobIds = new Set<string>()

  private statusListener: UpscaleStatusListener | null = null
  private mediaListener: UpscaleMediaListener | null = null
  private readonly lastEmit = new Map<string, { at: number; progress: number }>()

  private readonly workerManager = createManagedWorker({
    createWorker: () =>
      new Worker(new URL('../workers/upscale-worker.ts', import.meta.url), { type: 'module' }),
    setupWorker: (worker) => {
      worker.onmessage = (event: MessageEvent<UpscaleWorkerResponse>) => {
        void this.handleWorkerMessage(event.data)
      }
      worker.onerror = (error) => logger.error('Upscale worker error', { error })
      return () => {
        worker.onmessage = null
        worker.onerror = null
      }
    },
  })

  onStatusChange(listener: UpscaleStatusListener): void {
    this.statusListener = listener
  }

  onMediaCreated(listener: UpscaleMediaListener): void {
    this.mediaListener = listener
  }

  /**
   * Video sources only, and only when the 2x output stays inside what an encoder will accept —
   * a 4K source would render for minutes and then fail at `configure()`.
   */
  canUpscaleMedia(mimeType: string, width: number, height: number): boolean {
    return mimeType.startsWith('video/') && canUpscale(width, height)
  }

  isGenerating(mediaId: string): boolean {
    return this.jobsByMediaId.has(mediaId)
  }

  generate(request: UpscaleRequestInput): void {
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

  private post(message: UpscaleWorkerRequest): void {
    this.workerManager.getWorker().postMessage(message)
  }

  /** Throttled: a render can emit thousands of progress ticks. */
  private emitProgress(
    job: Job,
    progress: number,
    stage: UpscaleStage,
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

  private finish(job: Job, status: UpscaleStatus): void {
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
      logger.error('Upscale source load failed', { mediaId: job.mediaId, error })
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
      type: 'upscale',
      jobId: job.jobId,
      source,
      sourceOpfsPath,
      sourceMimeType,
      sourceFps: job.sourceFps,
      variant: job.variant,
    })
  }

  private async handleWorkerMessage(message: UpscaleWorkerResponse): Promise<void> {
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
        await this.importResult(
          job,
          message.result.width,
          message.result.height,
          message.result.fps,
        )
      } else if (message.type === 'error') {
        logger.error('Upscale failed', { mediaId: job.mediaId, error: message.error })
        this.finish(job, 'error')
      } else {
        this.finish(job, 'idle')
      }
    } finally {
      this.cancelledJobIds.delete(job.jobId)
      void this.drain()
    }
  }

  private async importResult(job: Job, width: number, height: number, fps: number): Promise<void> {
    try {
      const rendered = await readTmpFile(job.jobId)
      if (this.cancelledJobIds.has(job.jobId)) return
      if (!rendered || rendered.size === 0) {
        throw new Error('Upscale render produced no file')
      }

      const file = new File([rendered], upscaledFileName(job.fileName, width, height), {
        type: 'video/mp4',
      })
      // Imported lazily. The media-library store imports this service, so a static import would
      // drag media-library-service's whole graph (mediabunny, OPFS, thumbnails) into every
      // consumer of the store. The `media-library-service-loader` wrapper is avoided
      // deliberately: it registers a loader at import time, a side effect the store's tests stub
      // out.
      const { mediaLibraryService } = await import('./media-library-service')
      if (this.cancelledJobIds.has(job.jobId)) return
      const media = await mediaLibraryService.importGeneratedVideo(file, job.projectId, {
        fps,
        tags: [UPSCALED_MEDIA_TAG],
      })

      if (this.cancelledJobIds.has(job.jobId)) {
        await mediaLibraryService.deleteMediaFromProject(job.projectId, media.id)
        return
      }

      this.mediaListener?.(media, job.projectId)
      this.finish(job, 'ready')
      logger.info('Upscaled media imported', {
        sourceMediaId: job.mediaId,
        mediaId: media.id,
        width,
        height,
      })
    } catch (error) {
      if (this.cancelledJobIds.has(job.jobId)) {
        logger.error('Failed to roll back cancelled upscale import', {
          mediaId: job.mediaId,
          error,
        })
        return
      }
      logger.error('Failed to import upscaled media', { mediaId: job.mediaId, error })
      this.finish(job, 'error')
    } finally {
      await removeTmpFile(job.jobId)
    }
  }
}

export const upscaleService = new UpscaleService()
