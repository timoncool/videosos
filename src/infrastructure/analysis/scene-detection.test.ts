// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type {
  AdaptiveSceneWorkerRequest,
  AdaptiveSceneWorkerResponse,
} from './adaptive-scene-detection-worker.types'
import type { SceneCut } from './scene-detection-types'

const workerFactory = vi.hoisted(() => vi.fn())

vi.mock('./create-adaptive-scene-detection-worker', () => ({
  createAdaptiveSceneDetectionWorker: workerFactory,
}))

import { detectScenes } from './scene-detection'

class FakeWorker extends EventTarget {
  posted: AdaptiveSceneWorkerRequest[] = []
  terminated = false

  postMessage(message: AdaptiveSceneWorkerRequest) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(response: AdaptiveSceneWorkerResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
}

function fakeVideo(source = 'https://example.test/video.mp4'): HTMLVideoElement {
  return {
    currentSrc: source,
    src: source,
    duration: 12,
  } as HTMLVideoElement
}

function sceneCut(time = 2): SceneCut {
  return {
    time,
    score: 70,
    confidence: 0.9,
    type: 'cut',
    metrics: {
      kind: 'adaptive',
      contentScore: 70,
      adaptiveRatio: 8,
      hueDelta: 80,
      saturationDelta: 70,
      lumaDelta: 60,
    },
  }
}

describe('adaptive scene detection worker client', () => {
  beforeEach(() => {
    workerFactory.mockReset()
  })

  it('forwards progress and resolves completed cuts', async () => {
    const worker = new FakeWorker()
    workerFactory.mockReturnValue(worker)
    const onProgress = vi.fn()
    const resultPromise = detectScenes(fakeVideo(), {
      method: 'adaptive',
      verificationModel: null,
      onProgress,
    })
    const requestId = worker.posted[0]!.requestId

    worker.emit({
      type: 'progress',
      requestId,
      stage: 'analyzing',
      percent: 45,
      decodedFrames: 120,
      sceneCuts: 0,
    })
    worker.emit({
      type: 'complete',
      requestId,
      decodedFrames: 300,
      cuts: [sceneCut()],
    })

    await expect(resultPromise).resolves.toEqual([sceneCut()])
    expect(onProgress).toHaveBeenCalledWith({
      percent: 45,
      completed: 120,
      total: 0,
      sceneCuts: 0,
      stage: 'analyzing',
    })
    expect(worker.terminated).toBe(true)
  })

  it('ignores stale response IDs', async () => {
    const worker = new FakeWorker()
    workerFactory.mockReturnValue(worker)
    const resultPromise = detectScenes(fakeVideo(), {
      method: 'adaptive',
      verificationModel: null,
    })
    const requestId = worker.posted[0]!.requestId

    worker.emit({
      type: 'complete',
      requestId: 'stale-request',
      decodedFrames: 1,
      cuts: [sceneCut(1)],
    })
    worker.emit({ type: 'complete', requestId, decodedFrames: 2, cuts: [sceneCut(2)] })

    await expect(resultPromise).resolves.toEqual([sceneCut(2)])
  })

  it('aborts, terminates, and never returns partial cuts', async () => {
    const worker = new FakeWorker()
    workerFactory.mockReturnValue(worker)
    const controller = new AbortController()
    const resultPromise = detectScenes(fakeVideo(), {
      method: 'adaptive',
      verificationModel: null,
      signal: controller.signal,
    })
    const requestId = worker.posted[0]!.requestId

    controller.abort()

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.posted).toContainEqual({ type: 'abort', requestId })
    expect(worker.terminated).toBe(true)
  })

  it('rejects worker-reported errors and terminates', async () => {
    const worker = new FakeWorker()
    workerFactory.mockReturnValue(worker)
    const resultPromise = detectScenes(fakeVideo(), {
      method: 'adaptive',
      verificationModel: null,
    })
    const requestId = worker.posted[0]!.requestId

    worker.emit({ type: 'error', requestId, error: 'decoder failed' })

    await expect(resultPromise).rejects.toThrow('decoder failed')
    expect(worker.terminated).toBe(true)
  })

  it('uses the versioned in-memory cache after completion', async () => {
    const worker = new FakeWorker()
    workerFactory.mockReturnValue(worker)
    const video = fakeVideo()
    const firstPromise = detectScenes(video, {
      method: 'adaptive',
      verificationModel: null,
      mediaId: 'cache-media',
    })
    const requestId = worker.posted[0]!.requestId
    worker.emit({ type: 'complete', requestId, decodedFrames: 2, cuts: [sceneCut()] })
    await firstPromise

    const cached = await detectScenes(video, {
      method: 'adaptive',
      verificationModel: null,
      mediaId: 'cache-media',
    })

    expect(cached).toEqual([sceneCut()])
    expect(workerFactory).toHaveBeenCalledTimes(1)
  })
})
