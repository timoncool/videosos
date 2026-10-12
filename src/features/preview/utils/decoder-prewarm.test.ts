// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  activePreviewPreseek,
  backgroundBatchPreseek,
  backgroundPreseek,
  cacheActivePreviewFallbackBitmap,
  disposePrewarmWorker,
  getCachedActivePreviewFallbackBitmap,
  getDecoderPrewarmMetricsSnapshot,
  isActivePreviewFrameCurrent,
  isActivePreviewFrameDecodeReady,
  isActivePreviewSourceTarget,
  replaceActivePreviewSourceTargets,
  setActivePreviewRenderTarget,
  settleActivePreviewRenderTarget,
  waitForInflightPredecodedBitmap,
  warmDecoderPrewarmWorkerPool,
} from './decoder-prewarm'
import {
  clearObjectUrlRegistry,
  registerObjectUrl,
} from '@/infrastructure/browser/object-url-registry'

type MockWorkerMessage = {
  type: string
  id?: string
  timestamp?: number
  timestamps?: number[]
  generation?: number
  blob?: Blob
  src?: string
  sourceMetadata?: {
    storageType: 'opfs'
    opfsPath: string
    fileSize?: number
  }
  maxDimension?: number
}

class MockWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly addEventListener = vi.fn()
  readonly terminate = vi.fn()
  readonly postMessage = vi.fn((message: MockWorkerMessage) => {
    if (!autoRespondPreseek) return

    if (message.type === 'batch_preseek') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'batch_preseek_done',
            id: message.id,
            success: true,
            entries: (message.timestamps ?? []).map((timestamp) => ({
              timestamp,
              bitmap: mockBitmap,
            })),
          },
        } as MessageEvent)
      })
      return
    }

    if (message.type !== 'preseek' && message.type !== 'active_preseek') return

    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'preseek_done',
          id: message.id,
          success: true,
          timestamp: message.timestamp,
          bitmap: mockBitmap,
        },
      } as MessageEvent)
    })
  })
}

let createdWorkers: MockWorker[] = []
let fetchMock: ReturnType<typeof vi.fn>
let mockBitmap: ImageBitmap
let autoRespondPreseek = true

function getGeneralWorkers(): MockWorker[] {
  return createdWorkers.slice(0, getDecoderPrewarmMetricsSnapshot().poolSize)
}

beforeEach(() => {
  createdWorkers = []
  mockBitmap = { close: vi.fn() } as unknown as ImageBitmap
  fetchMock = vi.fn()
  autoRespondPreseek = true

  vi.stubGlobal('fetch', fetchMock)
  class WorkerStub extends MockWorker {
    constructor() {
      super()
      createdWorkers.push(this)
    }
  }

  vi.stubGlobal('Worker', WorkerStub as unknown as typeof Worker)
})

afterEach(() => {
  disposePrewarmWorker()
  clearObjectUrlRegistry()
  vi.unstubAllGlobals()
})

describe('decoder prewarm', () => {
  it('uses registered object URL blobs without re-fetching them', async () => {
    const blob = new Blob(['video'])
    registerObjectUrl('blob:clip-1', blob)

    const bitmap = await backgroundPreseek('blob:clip-1', 1)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(1)
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-1',
      timestamp: 1,
      blob,
    })
    expect(bitmap).toBe(mockBitmap)
  })

  it('prefers direct OPFS metadata over cloning blobs into the worker', async () => {
    const blob = new Blob(['video'])
    registerObjectUrl('blob:clip-opfs', blob, {
      storageType: 'opfs',
      opfsPath: 'content/aa/bb/data',
      fileSize: blob.size,
    })

    const bitmap = await backgroundPreseek('blob:clip-opfs', 2)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(1)
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-opfs',
      timestamp: 2,
      sourceMetadata: {
        storageType: 'opfs',
        opfsPath: 'content/aa/bb/data',
        fileSize: blob.size,
      },
    })
    expect(preseekPosts[0]?.blob).toBeUndefined()
    expect(bitmap).toBe(mockBitmap)
  })

  it('fails fast for unregistered blob URLs without ever calling fetch', async () => {
    // Any blob: URL that isn't in the object-url registry is, by
    // construction, unreachable from our JS — `blobUrlManager` is the
    // only place we create blob URLs, and it always registers. Calling
    // fetch() in that case would produce an uncatchable ERR_FILE_NOT_FOUND
    // in the DevTools console (Chrome logs network errors before the JS
    // .catch runs). The module now bails silently instead.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const firstResult = await backgroundPreseek('blob:stale', 1)
    const secondResult = await backgroundPreseek('blob:stale', 2)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(firstResult).toBeNull()
    expect(secondResult).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(0)
  })

  it('cancels stale comparison batches through their abort signal', async () => {
    autoRespondPreseek = false
    registerObjectUrl('blob:comparison', new Blob(['comparison']))
    const controller = new AbortController()

    const pending = backgroundBatchPreseek('blob:comparison', [1], {
      signal: controller.signal,
    })
    const worker = getGeneralWorkers()[0]!
    const batchPost = worker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'batch_preseek')
    expect(batchPost?.id).toBeTruthy()

    controller.abort()

    await expect(pending).resolves.toEqual(new Map())
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'batch_cancel',
      id: batchPost?.id,
    })
  })

  it('exposes comparison batch frames to renderer inflight waits', async () => {
    registerObjectUrl('blob:comparison-ready', new Blob(['comparison']))
    const controller = new AbortController()

    const batch = backgroundBatchPreseek('blob:comparison-ready', [3], {
      signal: controller.signal,
    })
    const waited = waitForInflightPredecodedBitmap('blob:comparison-ready', 3, 1 / 240, 100)

    await expect(waited).resolves.toBe(mockBitmap)
    await expect(batch).resolves.toEqual(new Map([[3, mockBitmap]]))
  })

  it('passes transient reverse-window sizing to the optimized batch decoder', async () => {
    registerObjectUrl('blob:reverse-window', new Blob(['reverse-window']))

    await backgroundBatchPreseek('blob:reverse-window', [3, 2, 1], {
      cacheCapacity: 28,
      maxDimension: 720,
    })

    const batchPost = getGeneralWorkers()
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'batch_preseek')
    expect(batchPost).toMatchObject({
      type: 'batch_preseek',
      src: 'blob:reverse-window',
      timestamps: [1, 2, 3],
      maxDimension: 720,
    })
    expect(getDecoderPrewarmMetricsSnapshot().cacheBitmaps).toBe(3)
  })

  it('warmDecoderPrewarmWorkerPool eagerly spawns the pool exactly once', () => {
    warmDecoderPrewarmWorkerPool()

    expect(createdWorkers.length).toBeGreaterThan(0)
    for (const worker of createdWorkers) {
      // Each worker preloads mediabunny WASM on creation.
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'warmup' })
    }

    const spawnedCount = createdWorkers.length
    warmDecoderPrewarmWorkerPool()
    expect(createdWorkers.length).toBe(spawnedCount)
  })

  it('isolates active preview decoding on a dedicated warm worker', async () => {
    warmDecoderPrewarmWorkerPool()
    const poolSize = getGeneralWorkers().length
    const activeWorker = createdWorkers[poolSize]
    expect(activeWorker).toBeDefined()

    registerObjectUrl('blob:active', new Blob(['active']))
    await expect(activePreviewPreseek({ src: 'blob:active', timestamp: 4 })).resolves.toBe(
      mockBitmap,
    )

    expect(
      getGeneralWorkers().some((worker) =>
        worker.postMessage.mock.calls.some(
          ([message]) => (message as MockWorkerMessage).type === 'active_preseek',
        ),
      ),
    ).toBe(false)
    expect(activeWorker!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'active_preseek',
        src: 'blob:active',
        timestamp: 4,
      }),
    )
  })

  it('bounds independent active decodes and retains only the latest held-scrub target', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()
    const activeWorker = createdWorkers[getGeneralWorkers().length]!
    registerObjectUrl('blob:drag', new Blob(['drag']))

    const stale = activePreviewPreseek({ src: 'blob:drag', timestamp: 10 })
    const middle = activePreviewPreseek({ src: 'blob:drag', timestamp: 20 })
    const latest = activePreviewPreseek({ src: 'blob:drag', timestamp: 30 })

    await expect(stale).resolves.toBeNull()
    await expect(middle).resolves.toBeNull()
    const initialActivePosts = activeWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'active_preseek')
    expect(initialActivePosts.map((message) => message.timestamp)).toEqual([10, 20])
    expect(activeWorker.terminate).not.toHaveBeenCalled()
    expect(activeWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'active_cancel',
        src: 'blob:drag',
      }),
    )

    const stalePost = initialActivePosts[0]!
    activeWorker.onmessage?.({
      data: {
        type: 'preseek_done',
        id: stalePost.id,
        success: false,
        timestamp: 10,
      },
    } as MessageEvent)

    await vi.waitFor(() => {
      const posts = activeWorker.postMessage.mock.calls
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'active_preseek')
      expect(posts.map((message) => message.timestamp)).toEqual([10, 20, 30])
    })
    const latestPost = activeWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'active_preseek' && message.timestamp === 30)!
    activeWorker.onmessage?.({
      data: {
        type: 'preseek_done',
        id: latestPost.id,
        success: true,
        timestamp: 30,
        bitmap: mockBitmap,
      },
    } as MessageEvent)

    await expect(latest).resolves.toBe(mockBitmap)
    expect(getDecoderPrewarmMetricsSnapshot()).toMatchObject({
      activeCancellations: 2,
      activeWorkerRestarts: 0,
      activeSupersededRequests: 0,
      cacheSources: 1,
      cacheBitmaps: 1,
    })
  })

  it('keeps two source decodes live for compound and transition previews', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()
    const activeWorker = createdWorkers[getGeneralWorkers().length]!
    registerObjectUrl('blob:left', new Blob(['left']))
    registerObjectUrl('blob:right', new Blob(['right']))

    const left = activePreviewPreseek({ src: 'blob:left', timestamp: 3 })
    const right = activePreviewPreseek({ src: 'blob:right', timestamp: 7 })
    const posts = activeWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'active_preseek')

    expect(posts.map((message) => [message.src, message.timestamp])).toEqual([
      ['blob:left', 3],
      ['blob:right', 7],
    ])
    expect(
      activeWorker.postMessage.mock.calls
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'active_cancel'),
    ).toHaveLength(0)

    for (const post of posts) {
      activeWorker.onmessage?.({
        data: {
          type: 'preseek_done',
          id: post.id,
          success: true,
          timestamp: post.timestamp,
          bitmap: mockBitmap,
        },
      } as MessageEvent)
    }

    await expect(left).resolves.toBe(mockBitmap)
    await expect(right).resolves.toBe(mockBitmap)
  })

  it('globally bounds decoded bitmap rings across recently active sources', async () => {
    for (let index = 0; index < 6; index += 1) {
      const src = `blob:bounded-${index}`
      registerObjectUrl(src, new Blob([src]))
      await backgroundPreseek(src, index)
    }

    expect(getDecoderPrewarmMetricsSnapshot()).toMatchObject({
      cacheSources: 4,
      cacheBitmaps: 4,
      cacheSourceEvictions: 2,
    })
  })

  it('presents a bounded fallback first and replaces it with the exact decoded frame', async () => {
    const fallbackBitmap = { close: vi.fn() } as unknown as ImageBitmap
    registerObjectUrl('blob:fallback', new Blob(['fallback']))
    setActivePreviewRenderTarget(44)
    replaceActivePreviewSourceTargets(new Map([['blob:fallback', [2]]]))

    cacheActivePreviewFallbackBitmap('blob:fallback', 2, 2.2, fallbackBitmap)
    expect(isActivePreviewFrameDecodeReady(44)).toBe(true)
    expect(getCachedActivePreviewFallbackBitmap('blob:fallback', 2)).toBe(fallbackBitmap)

    await activePreviewPreseek({ src: 'blob:fallback', timestamp: 2 })

    expect(fallbackBitmap.close).toHaveBeenCalledOnce()
    expect(getCachedActivePreviewFallbackBitmap('blob:fallback', 2)).toBeNull()
    expect(getDecoderPrewarmMetricsSnapshot().exactFallbackReplacements).toBeGreaterThan(0)
  })

  it('keeps the active session alive after fallback presentation until exact settlement', async () => {
    const fallbackBitmap = { close: vi.fn() } as unknown as ImageBitmap
    registerObjectUrl('blob:settle', new Blob(['settle']))
    setActivePreviewRenderTarget(45)
    replaceActivePreviewSourceTargets(new Map([['blob:settle', [3]]]))
    cacheActivePreviewFallbackBitmap('blob:settle', 3, 3, fallbackBitmap)

    settleActivePreviewRenderTarget(45)
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(isActivePreviewFrameCurrent(45)).toBe(true)

    await activePreviewPreseek({ src: 'blob:settle', timestamp: 3 })
    settleActivePreviewRenderTarget(45)
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(isActivePreviewFrameCurrent(45)).toBe(false)
    expect(getCachedActivePreviewFallbackBitmap('blob:settle', 3)).toBeNull()
  })

  it('gates an active composition until every exact source target is cached', async () => {
    registerObjectUrl('blob:gate', new Blob(['gate']))
    setActivePreviewRenderTarget(100)
    replaceActivePreviewSourceTargets(new Map([['blob:gate', [3]]]))

    expect(isActivePreviewFrameDecodeReady(100)).toBe(false)
    expect(isActivePreviewSourceTarget('blob:gate', 3)).toBe(true)
    expect(isActivePreviewSourceTarget('blob:gate', 4)).toBe(false)
    await activePreviewPreseek({ src: 'blob:gate', timestamp: 3 })
    expect(isActivePreviewFrameDecodeReady(100)).toBe(true)
    expect(isActivePreviewFrameDecodeReady(101)).toBe(true)
  })

  it('runs a queued speculative preseek when a saturated worker becomes free', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const poolSize = getGeneralWorkers().length
    expect(poolSize).toBeGreaterThan(0)

    const inflightPromises: ReturnType<typeof backgroundPreseek>[] = []
    for (let index = 0; index < poolSize; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      inflightPromises.push(backgroundPreseek(src, index))
    }

    // A duplicate request for an already-inflight src/timestamp needs no extra
    // worker capacity — even with the pool saturated it must reuse the promise.
    const duplicateResult = backgroundPreseek('blob:busy-0', 0)
    expect(duplicateResult).toBe(inflightPromises[0])

    registerObjectUrl('blob:overflow', new Blob(['overflow']))
    const overflowResult = backgroundPreseek('blob:overflow', 999)
    const duplicateOverflowResult = backgroundPreseek('blob:overflow', 999)
    expect(duplicateOverflowResult).toBe(overflowResult)

    const initialPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')
    expect(initialPosts).toHaveLength(poolSize)

    createdWorkers[0]!.onmessage?.({
      data: { type: 'preseek_done', id: initialPosts[0]!.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await vi.waitFor(() => {
      const queuedPost = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .find((message) => message.type === 'preseek' && message.src === 'blob:overflow')
      expect(queuedPost).toBeDefined()
    })

    const queuedWorker = createdWorkers.find((worker) =>
      worker.postMessage.mock.calls.some(
        ([message]) =>
          (message as MockWorkerMessage).type === 'preseek' &&
          (message as MockWorkerMessage).src === 'blob:overflow',
      ),
    )!
    const queuedPost = queuedWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'preseek' && message.src === 'blob:overflow')!
    queuedWorker.onmessage?.({
      data: { type: 'preseek_done', id: queuedPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await expect(overflowResult).resolves.toBe(mockBitmap)
    const overflowPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek' && message.src === 'blob:overflow')
    expect(overflowPosts).toHaveLength(1)
  })

  it('forwards superseded same-source waiters to the latest decode', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    for (let index = 0; index < getGeneralWorkers().length; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      void backgroundPreseek(src, index)
    }

    registerObjectUrl('blob:latest', new Blob(['latest']))
    const stale = backgroundPreseek('blob:latest', 10)
    const duplicateStale = backgroundPreseek('blob:latest', 10)
    expect(duplicateStale).toBe(stale)
    const latest = backgroundPreseek('blob:latest', 11)

    const busyPost = createdWorkers[0]!.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'preseek')!
    createdWorkers[0]!.onmessage?.({
      data: { type: 'preseek_done', id: busyPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await vi.waitFor(() => {
      const latestPosts = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'preseek' && message.src === 'blob:latest')
      expect(latestPosts.map((message) => message.timestamp)).toEqual([11])
    })

    const latestWorker = createdWorkers.find((worker) =>
      worker.postMessage.mock.calls.some(
        ([message]) => (message as MockWorkerMessage).src === 'blob:latest',
      ),
    )!
    const latestPost = latestWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.src === 'blob:latest')!
    latestWorker.onmessage?.({
      data: { type: 'preseek_done', id: latestPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await expect(Promise.all([stale, duplicateStale, latest])).resolves.toEqual([
      mockBitmap,
      mockBitmap,
      mockBitmap,
    ])
  })
  it('forwards a supersession chain to a synchronously retried target', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    for (let index = 0; index < getGeneralWorkers().length; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      void backgroundPreseek(src, index)
    }

    registerObjectUrl('blob:retry', new Blob(['retry']))
    const stale = backgroundPreseek('blob:retry', 10)
    const newer = backgroundPreseek('blob:retry', 11)
    const retry = backgroundPreseek('blob:retry', 10)
    expect(retry).not.toBe(stale)

    const busyPost = createdWorkers[0]!.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'preseek')!
    createdWorkers[0]!.onmessage?.({
      data: { type: 'preseek_done', id: busyPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await vi.waitFor(() => {
      const retryPosts = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'preseek' && message.src === 'blob:retry')
      expect(retryPosts.map((message) => message.timestamp)).toEqual([10])
    })

    const retryWorker = createdWorkers.find((worker) =>
      worker.postMessage.mock.calls.some(
        ([message]) => (message as MockWorkerMessage).src === 'blob:retry',
      ),
    )!
    const retryPost = retryWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.src === 'blob:retry')!
    retryWorker.onmessage?.({
      data: { type: 'preseek_done', id: retryPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await expect(Promise.all([stale, newer, retry])).resolves.toEqual([
      mockBitmap,
      mockBitmap,
      mockBitmap,
    ])
  })
  it('evicts the oldest sources when the bounded waiting queue is full', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const poolSize = getGeneralWorkers().length
    for (let index = 0; index < poolSize; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      void backgroundPreseek(src, index)
    }

    const queued = Array.from({ length: poolSize + 2 }, (_, index) => {
      const src = `blob:queued-${index}`
      registerObjectUrl(src, new Blob([`queued-${index}`]))
      return { src, promise: backgroundPreseek(src, index + 100) }
    })
    await expect(queued[0]!.promise).resolves.toBeNull()
    await expect(queued[1]!.promise).resolves.toBeNull()

    const busyPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek' && message.src?.startsWith('blob:busy-'))
    for (let index = 0; index < poolSize; index += 1) {
      createdWorkers[index]!.onmessage?.({
        data: {
          type: 'preseek_done',
          id: busyPosts[index]!.id,
          success: true,
          bitmap: mockBitmap,
        },
      } as MessageEvent)
    }

    await vi.waitFor(() => {
      const queuedPosts = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'preseek' && message.src?.startsWith('blob:queued-'))
      expect(queuedPosts.map((message) => message.src)).toEqual(
        queued.slice(2).map(({ src }) => src),
      )
    })
  })

  it('clears active and queued requests on disposal before a clean restart', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const allOldWorkers = [...createdWorkers]
    const oldWorkers = getGeneralWorkers()
    const active = oldWorkers.map((_, index) => {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      return backgroundPreseek(src, index)
    })
    registerObjectUrl('blob:restart', new Blob(['restart']))
    const queued = backgroundPreseek('blob:restart', 5)

    disposePrewarmWorker()

    await expect(queued).resolves.toBeNull()
    await expect(Promise.all(active)).resolves.toEqual(oldWorkers.map(() => null))
    for (const worker of allOldWorkers) {
      expect(worker.terminate).toHaveBeenCalledOnce()
      expect(
        worker.postMessage.mock.calls.some(
          ([message]) => (message as MockWorkerMessage).src === 'blob:restart',
        ),
      ).toBe(false)
    }

    autoRespondPreseek = true
    const oldWorkerCount = createdWorkers.length
    warmDecoderPrewarmWorkerPool()
    await expect(backgroundPreseek('blob:restart', 5)).resolves.toBe(mockBitmap)
    const restartedWorkers = createdWorkers.slice(oldWorkerCount)
    expect(
      restartedWorkers.some((worker) =>
        worker.postMessage.mock.calls.some(
          ([message]) => (message as MockWorkerMessage).src === 'blob:restart',
        ),
      ),
    ).toBe(true)
  })

  it('closes bitmaps from late worker replies after a request is no longer pending', () => {
    warmDecoderPrewarmWorkerPool()

    const worker = createdWorkers[0]!
    worker.onmessage?.({
      data: {
        type: 'preseek_done',
        id: 'missing-request',
        success: true,
        bitmap: mockBitmap,
      },
    } as MessageEvent)

    expect(mockBitmap.close).toHaveBeenCalledTimes(1)
  })
})
