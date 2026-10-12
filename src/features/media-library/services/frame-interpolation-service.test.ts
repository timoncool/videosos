// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { FrameInterpolationService } from './frame-interpolation-service'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  importGeneratedVideo: vi.fn(),
  deleteMediaFromProject: vi.fn(async () => {}),
}))

vi.mock('./media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const job = {
  mediaId: 'source-1',
  projectId: 'project-1',
  fileName: 'source.mp4',
  factor: 2 as const,
  source: new Blob(['source']),
  sourceFps: 30,
  jobId: 'job-1',
}

function seedJob(service: FrameInterpolationService, active: boolean) {
  const internals = service as unknown as {
    activeJob: typeof job | null
    jobsByMediaId: Map<string, typeof job>
  }
  internals.activeJob = active ? job : null
  internals.jobsByMediaId.set(job.mediaId, job)
}

function makeMedia(): MediaMetadata {
  return {
    id: 'generated-1',
    storageType: 'opfs',
    fileName: 'generated.mp4',
    fileSize: 10,
    mimeType: 'video/mp4',
    duration: 1,
    width: 1920,
    height: 1080,
    fps: 60,
    codec: 'avc',
    bitrate: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('FrameInterpolationService cancellation', () => {
  const removeEntry = vi.fn(async () => {})

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn(async () => ({
          getDirectoryHandle: vi.fn(async () => ({
            getFileHandle: vi.fn(async () => ({
              getFile: vi.fn(async () => new File(['rendered'], 'job-1.mp4')),
            })),
            removeEntry,
          })),
        })),
      },
    })
  })

  it('ignores a complete message that races with active cancellation', async () => {
    const service = new FrameInterpolationService()
    seedJob(service, true)
    const internals = service as unknown as {
      post(message: unknown): void
      importResult(activeJob: typeof job, outputFps: number): Promise<void>
    }
    const post = vi.spyOn(internals, 'post').mockImplementation(() => undefined)
    const importResult = vi.spyOn(internals, 'importResult').mockResolvedValue(undefined)

    service.cancel(job.mediaId)
    await (
      service as unknown as {
        handleWorkerMessage(message: unknown): Promise<void>
      }
    ).handleWorkerMessage({
      type: 'complete',
      jobId: job.jobId,
      opfsPath: 'frame-interpolation/job-1.mp4',
      result: { outputFps: 60 },
    })

    expect(post).toHaveBeenCalledWith({ type: 'cancel', jobId: job.jobId })
    expect(importResult).not.toHaveBeenCalled()
    expect(service.isGenerating(job.mediaId)).toBe(false)
  })

  it('rolls back media when cancellation lands during import', async () => {
    const service = new FrameInterpolationService()
    seedJob(service, false)
    const imported = createDeferred<MediaMetadata>()
    mediaLibraryServiceMocks.importGeneratedVideo.mockReturnValue(imported.promise)
    const onMediaCreated = vi.fn()
    service.onMediaCreated(onMediaCreated)

    const importPromise = (
      service as unknown as {
        importResult(activeJob: typeof job, outputFps: number): Promise<void>
      }
    ).importResult(job, 60)
    await vi.waitFor(() => expect(mediaLibraryServiceMocks.importGeneratedVideo).toHaveBeenCalled())

    service.cancel(job.mediaId)
    imported.resolve(makeMedia())
    await importPromise

    expect(mediaLibraryServiceMocks.deleteMediaFromProject).toHaveBeenCalledWith(
      job.projectId,
      'generated-1',
    )
    expect(onMediaCreated).not.toHaveBeenCalled()
  })
})
