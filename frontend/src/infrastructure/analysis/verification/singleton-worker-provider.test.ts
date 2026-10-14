// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createSingletonSceneVerificationProvider } from './singleton-worker-provider'

function createWorkerDouble(): Worker {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as unknown as Worker
}

describe('createSingletonSceneVerificationProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses a worker until it is reset', () => {
    const firstWorker = createWorkerDouble()
    const secondWorker = createWorkerDouble()
    const createWorker = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker)
    const provider = createSingletonSceneVerificationProvider({
      id: 'test',
      label: 'Test',
      createWorker,
    })

    expect(provider.getWorker()).toBe(firstWorker)
    expect(provider.getWorker()).toBe(firstWorker)
    expect(createWorker).toHaveBeenCalledTimes(1)

    provider.resetWorker()

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(provider.getWorker()).toBe(secondWorker)
    expect(createWorker).toHaveBeenCalledTimes(2)
  })

  it('disposes the worker before terminating it', () => {
    vi.useFakeTimers()
    const worker = createWorkerDouble()
    const provider = createSingletonSceneVerificationProvider({
      id: 'test',
      label: 'Test',
      createWorker: () => worker,
    })

    provider.getWorker()
    provider.disposeWorker()

    expect(worker.postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' })
    expect(worker.terminate).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps the worker for a user that comes back before it idles out', () => {
    vi.useFakeTimers()
    const worker = createWorkerDouble()
    const createWorker = vi.fn(() => worker)
    const provider = createSingletonSceneVerificationProvider({ id: 'test', label: 'Test', createWorker })

    provider.getWorker()
    provider.disposeWorker()
    vi.advanceTimersByTime(30_000)
    expect(provider.getWorker()).toBe(worker)
    vi.advanceTimersByTime(60_000)

    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(createWorker).toHaveBeenCalledTimes(1)
  })
})
