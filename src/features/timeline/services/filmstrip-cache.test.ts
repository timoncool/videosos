import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const managedWorkerPoolMocks = vi.hoisted(() => ({
  acquireWorker: vi.fn(),
  releaseWorker: vi.fn(),
  terminateWorker: vi.fn(),
  terminateAll: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}))

const filmstripStorageMocks = vi.hoisted(() => ({
  load: vi.fn(),
  saveMetadata: vi.fn(),
  saveFrameBlob: vi.fn(),
  loadSingleFrame: vi.fn(),
  getExistingIndices: vi.fn(),
  createFrameFromBitmap: vi.fn(),
  createFrameFromBlob: vi.fn(),
  revokeUrls: vi.fn(),
  delete: vi.fn(),
  clearAll: vi.fn(),
}))

vi.mock('@/shared/utils/managed-worker-pool', () => ({
  createManagedWorkerPool: vi.fn(() => managedWorkerPoolMocks),
}))

vi.mock('@/shared/logging/logger', () => ({
  createLogger: vi.fn(() => loggerMocks),
}))

vi.mock('./filmstrip-storage', () => ({
  filmstripStorage: filmstripStorageMocks,
}))

import { filmstripCache } from './filmstrip-cache'

function makeBitmap(): ImageBitmap {
  return {
    width: 80,
    height: 45,
    close: vi.fn(),
  } as unknown as ImageBitmap
}

type SettledFilmstripFrame = { index: number; timestamp: number; url: string }

type TestWorker = Worker & {
  postMessage: ReturnType<typeof vi.fn>
}

type TestFilmstripCache = {
  startExtraction: (
    mediaId: string,
    blobUrl: string,
    duration: number,
    skipIndices: number[],
    existingFrames: SettledFilmstripFrame[],
    onProgress?: (progress: number) => void,
    forceSingleWorker?: boolean,
    priorityRange?: { startIndex: number; endIndex: number },
    options?: { targetFrameIndices?: number[] },
  ) => void
}

function makeWorker(): TestWorker {
  return {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as unknown as TestWorker
}

function getExtractRequest(worker: TestWorker) {
  const request = worker.postMessage.mock.calls.find(
    ([message]) => message?.type === 'extract',
  )?.[0]
  expect(request).toBeDefined()
  return request as {
    requestId: string
    blobUrl: string
    targetIndices: number[]
    skipIndices: number[]
  }
}

async function emitWorkerFrames(
  worker: TestWorker,
  frameIndices: number[],
  frameCount: number,
): Promise<void> {
  const request = getExtractRequest(worker)
  const savedFrames = frameIndices.map((index) => ({
    index,
    blob: new Blob([String(index)], { type: 'image/jpeg' }),
  }))
  await worker.onmessage?.({
    data: {
      type: 'progress',
      requestId: request.requestId,
      frameIndex: frameIndices.at(-1) ?? 0,
      frameCount,
      progress: 50,
      savedFrames,
      savedIndices: [],
      bitmapFrames: [],
    },
  } as MessageEvent)
}

async function emitWorkerComplete(
  worker: TestWorker,
  frameCount: number,
  unavailableIndices: number[] = [],
): Promise<void> {
  const request = getExtractRequest(worker)
  await worker.onmessage?.({
    data: {
      type: 'complete',
      requestId: request.requestId,
      frameCount,
      unavailableIndices,
    },
  } as MessageEvent)
}

function startExactExtraction(
  worker: TestWorker,
  targetFrameIndices: number[],
  blobUrl = 'blob:test',
): void {
  managedWorkerPoolMocks.acquireWorker.mockReturnValueOnce(worker)
  ;(filmstripCache as unknown as TestFilmstripCache).startExtraction(
    'media-1',
    blobUrl,
    10,
    [],
    [],
    undefined,
    true,
    undefined,
    { targetFrameIndices },
  )
}

function buildSettledFilmstrip(pending: unknown, frames: SettledFilmstripFrame[]) {
  return (
    filmstripCache as unknown as {
      buildSettledFilmstrip: (
        pendingArg: unknown,
        framesArg: SettledFilmstripFrame[],
      ) => {
        isComplete: boolean
        progress: number
      }
    }
  ).buildSettledFilmstrip(pending, frames)
}

beforeAll(() => {
  managedWorkerPoolMocks.acquireWorker.mockReturnValueOnce(makeWorker())
  filmstripCache.prewarm()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of Object.values(managedWorkerPoolMocks)) {
    mock.mockReset()
  }
  for (const mock of Object.values(filmstripStorageMocks)) {
    mock.mockReset()
  }
  filmstripStorageMocks.saveMetadata.mockResolvedValue(undefined)
  filmstripStorageMocks.saveFrameBlob.mockResolvedValue(undefined)
  filmstripStorageMocks.createFrameFromBlob.mockImplementation(
    (_mediaId: string, index: number) => ({
      index,
      timestamp: index,
      url: `blob:${index}`,
    }),
  )
})

describe('filmstripCache completion semantics', () => {
  afterEach(async () => {
    await filmstripCache.dispose()
  })

  it('unions concurrent exact targets and continues in one follow-up phase', async () => {
    const firstWorker = makeWorker()
    const followUpWorker = makeWorker()
    startExactExtraction(firstWorker, [1, 2])
    managedWorkerPoolMocks.acquireWorker.mockReturnValueOnce(followUpWorker)

    const firstWaiter = filmstripCache.getFilmstrip(
      'media-1',
      'blob:test',
      10,
      undefined,
      undefined,
      { targetFrameIndices: [2, 3] },
    )
    const secondWaiter = filmstripCache.getFilmstrip(
      'media-1',
      'blob:test',
      10,
      undefined,
      undefined,
      { targetFrameIndices: [4, 5] },
    )
    const internals = filmstripCache as unknown as {
      activeExtractions: Set<string>
      pendingExtractions: Map<
        string,
        {
          phaseTargetIndices: number[]
          targetIndices: number[]
          skipIndices: number[]
          workers: unknown[]
          isVideoFallback: boolean
        }
      >
    }
    expect(internals.activeExtractions.has('media-1')).toBe(true)
    expect(internals.pendingExtractions.get('media-1')).toMatchObject({
      phaseTargetIndices: [1, 2],
      targetIndices: [1, 2, 3, 4, 5],
      skipIndices: [],
    })
    let settled = false
    void Promise.all([firstWaiter, secondWaiter]).then(() => {
      settled = true
    })

    expect(firstWorker.postMessage).toHaveBeenCalledTimes(1)
    expect(managedWorkerPoolMocks.terminateWorker).not.toHaveBeenCalled()

    await emitWorkerFrames(firstWorker, [1, 2], 2)
    await emitWorkerComplete(firstWorker, 2)

    expect(settled).toBe(false)
    expect(managedWorkerPoolMocks.releaseWorker).toHaveBeenCalledWith(
      firstWorker,
      expect.any(Object),
    )
    expect(getExtractRequest(followUpWorker)).toMatchObject({
      targetIndices: [1, 2, 3, 4, 5],
      skipIndices: [1, 2],
    })
    expect(managedWorkerPoolMocks.terminateWorker).not.toHaveBeenCalled()

    await emitWorkerFrames(followUpWorker, [3, 4, 5], 5)
    await emitWorkerComplete(followUpWorker, 5)
    const [firstResult, secondResult] = await Promise.all([firstWaiter, secondWaiter])

    expect(firstResult.isComplete).toBe(true)
    expect(secondResult.isComplete).toBe(true)
    expect(firstResult.frames.map((frame) => frame.index)).toEqual([1, 2, 3, 4, 5])
    expect(filmstripCache.getMetricsSnapshot().totals).toMatchObject({
      started: 1,
      completed: 1,
      aborted: 0,
    })
  })

  it('keeps an exact target extension that arrives during final metadata persistence', async () => {
    const firstWorker = makeWorker()
    const followUpWorker = makeWorker()
    startExactExtraction(firstWorker, [1])
    managedWorkerPoolMocks.acquireWorker.mockReturnValueOnce(followUpWorker)
    await emitWorkerFrames(firstWorker, [1], 1)

    let resolveMetadata!: () => void
    const pendingMetadata = new Promise<void>((resolve) => {
      resolveMetadata = resolve
    })
    filmstripStorageMocks.saveMetadata.mockImplementationOnce(() => pendingMetadata)
    const firstCompletion = emitWorkerComplete(firstWorker, 1)

    const mergedWaiter = filmstripCache.getFilmstrip(
      'media-1',
      'blob:test',
      10,
      undefined,
      undefined,
      { targetFrameIndices: [1, 2] },
    )
    let settled = false
    void mergedWaiter.then(() => {
      settled = true
    })

    resolveMetadata()
    await firstCompletion

    expect(settled).toBe(false)
    expect(getExtractRequest(followUpWorker)).toMatchObject({
      targetIndices: [1, 2],
      skipIndices: [1],
    })
    expect(managedWorkerPoolMocks.terminateWorker).not.toHaveBeenCalled()

    await emitWorkerFrames(followUpWorker, [2], 2)
    await emitWorkerComplete(followUpWorker, 2)
    await expect(mergedWaiter).resolves.toMatchObject({
      isComplete: true,
      progress: 100,
    })
  })

  it('retains unavailable targets when an exact union needs a follow-up phase', async () => {
    const firstWorker = makeWorker()
    const followUpWorker = makeWorker()
    startExactExtraction(firstWorker, [1, 2])
    managedWorkerPoolMocks.acquireWorker.mockReturnValueOnce(followUpWorker)
    const waiter = filmstripCache.getFilmstrip('media-1', 'blob:test', 10, undefined, undefined, {
      targetFrameIndices: [2, 3],
    })

    await emitWorkerFrames(firstWorker, [1], 1)
    await emitWorkerComplete(firstWorker, 2, [2])

    expect(getExtractRequest(followUpWorker)).toMatchObject({
      targetIndices: [1, 2, 3],
      skipIndices: [1, 2],
    })

    await emitWorkerFrames(followUpWorker, [3], 3)
    await emitWorkerComplete(followUpWorker, 3)
    const result = await waiter

    expect(result.isComplete).toBe(true)
    expect(result.frames.map((frame) => frame.index)).toEqual([1, 3])
    expect(filmstripCache.getMetricsSnapshot().totals.aborted).toBe(0)
  })

  it('still restarts an exact request when the media source changes', async () => {
    const firstWorker = makeWorker()
    const replacementWorker = makeWorker()
    startExactExtraction(firstWorker, [1])
    managedWorkerPoolMocks.acquireWorker.mockReturnValueOnce(replacementWorker)

    const replacement = filmstripCache.getFilmstrip(
      'media-1',
      'blob:replacement',
      10,
      undefined,
      undefined,
      { targetFrameIndices: [2] },
    )

    expect(managedWorkerPoolMocks.terminateWorker).toHaveBeenCalledWith(firstWorker)
    expect(getExtractRequest(replacementWorker)).toMatchObject({
      blobUrl: 'blob:replacement',
      targetIndices: [2],
    })
    expect(filmstripCache.getMetricsSnapshot().totals.aborted).toBe(1)

    filmstripCache.abort('media-1')
    await replacement
  })

  it('keeps priority-only prewarm results incomplete for long clips', () => {
    const pending = {
      priorityOnly: true,
      targetIndices: [0, 1, 2],
      totalFrames: 120,
      priorityRange: {
        startIndex: 0,
        endIndex: 3,
      },
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 1, timestamp: 1, url: 'blob:1' },
      { index: 2, timestamp: 2, url: 'blob:2' },
    ]

    const result = buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(false)
    expect(result.progress).toBeLessThan(100)
  })

  it('marks a priority warm complete when it already covers the whole clip', () => {
    const pending = {
      priorityOnly: true,
      targetIndices: [0, 1, 2],
      totalFrames: 3,
      priorityRange: {
        startIndex: 0,
        endIndex: 3,
      },
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 1, timestamp: 1, url: 'blob:1' },
      { index: 2, timestamp: 2, url: 'blob:2' },
    ]

    const result = buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(true)
    expect(result.progress).toBe(100)
  })

  it('treats decoder-unavailable target frames as settled', () => {
    const pending = {
      priorityOnly: false,
      targetIndices: [0, 1, 2, 3],
      totalFrames: 4,
      priorityRange: null,
      unavailableTargetIndices: new Set([3]),
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 1, timestamp: 1, url: 'blob:1' },
      { index: 2, timestamp: 2, url: 'blob:2' },
    ]

    const result = buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(true)
    expect(result.progress).toBe(100)
  })

  it('keeps a viewport-limited refinement complete when cached frames already cover it', () => {
    const pending = {
      priorityOnly: true,
      targetIndices: [10, 11],
      totalFrames: 120,
      priorityRange: {
        startIndex: 10,
        endIndex: 12,
      },
      targetFrameCount: 4,
      requestedFrameIndices: [10, 11],
    }
    const frames = [
      { index: 0, timestamp: 0, url: 'blob:0' },
      { index: 10, timestamp: 10, url: 'blob:10' },
      { index: 11, timestamp: 11, url: 'blob:11' },
      { index: 119, timestamp: 119, url: 'blob:119' },
    ]

    const result = buildSettledFilmstrip(pending, frames)

    expect(result.isComplete).toBe(true)
    expect(result.progress).toBe(100)
  })
})

describe('filmstripCache bitmap lifecycle', () => {
  afterEach(async () => {
    await filmstripCache.dispose()
  })

  it('closes bitmap-only frames when cached frames are replaced by persisted URLs', () => {
    const bitmap = makeBitmap()
    const service = filmstripCache as unknown as {
      notifyUpdate: (
        mediaId: string,
        filmstrip: {
          frames: Array<{ index: number; timestamp: number; url: string; bitmap?: ImageBitmap }>
          isComplete: boolean
          isExtracting: boolean
          progress: number
        },
      ) => void
    }

    service.notifyUpdate('media-1', {
      frames: [{ index: 0, timestamp: 0, url: '', bitmap }],
      isComplete: false,
      isExtracting: true,
      progress: 1,
    })
    service.notifyUpdate('media-1', {
      frames: [{ index: 0, timestamp: 0, url: 'blob:0' }],
      isComplete: true,
      isExtracting: false,
      progress: 100,
    })

    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('keeps retained bitmaps open across cache updates', () => {
    const bitmap = makeBitmap()
    const service = filmstripCache as unknown as {
      notifyUpdate: (
        mediaId: string,
        filmstrip: {
          frames: Array<{ index: number; timestamp: number; url: string; bitmap?: ImageBitmap }>
          isComplete: boolean
          isExtracting: boolean
          progress: number
        },
      ) => void
    }
    const frame = { index: 0, timestamp: 0, url: '', bitmap }

    service.notifyUpdate('media-1', {
      frames: [frame],
      isComplete: false,
      isExtracting: true,
      progress: 1,
    })
    service.notifyUpdate('media-1', {
      frames: [frame, { index: 1, timestamp: 1, url: 'blob:1' }],
      isComplete: false,
      isExtracting: true,
      progress: 50,
    })

    expect(bitmap.close).not.toHaveBeenCalled()
  })

  it('closes cached bitmaps when clearing all filmstrips', async () => {
    const bitmap = makeBitmap()
    const service = filmstripCache as unknown as {
      notifyUpdate: (
        mediaId: string,
        filmstrip: {
          frames: Array<{ index: number; timestamp: number; url: string; bitmap?: ImageBitmap }>
          isComplete: boolean
          isExtracting: boolean
          progress: number
        },
      ) => void
    }

    service.notifyUpdate('media-1', {
      frames: [{ index: 0, timestamp: 0, url: '', bitmap }],
      isComplete: false,
      isExtracting: false,
      progress: 25,
    })

    await filmstripCache.clearAll()

    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })
})
