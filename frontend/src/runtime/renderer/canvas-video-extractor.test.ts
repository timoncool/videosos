import { describe, expect, it, vi } from 'vite-plus/test'
import { VideoFrameExtractor } from './canvas-video-extractor'

describe('VideoFrameExtractor lifecycle', () => {
  it('closes a sample yielded after the extractor was disposed', async () => {
    let resolveNext!: (result: IteratorResult<{ close: () => void }>) => void
    const nextResult = new Promise<IteratorResult<{ close: () => void }>>((resolve) => {
      resolveNext = resolve
    })
    const sample = { close: vi.fn() }
    const iterator = {
      next: vi.fn(() => nextResult),
      return: vi.fn(async () => ({ value: undefined, done: true as const })),
      throw: vi.fn(async (error: unknown) => {
        throw error
      }),
      [Symbol.asyncIterator]() {
        return this
      },
    }

    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      sampleIterator: typeof iterator | null
      peekNextSample: () => Promise<{ close: () => void } | null>
    }
    internals.sampleIterator = iterator

    const pendingSample = internals.peekNextSample()
    extractor.dispose()
    resolveNext({ value: sample, done: false })

    await expect(pendingSample).resolves.toBeNull()
    expect(sample.close).toHaveBeenCalledTimes(1)
    expect(iterator.return).toHaveBeenCalledTimes(1)
  })

  it('aborts a draw immediately when shouldContinue is already false', async () => {
    const iterator = {
      next: vi.fn(async () => ({ value: undefined, done: true as const })),
      return: vi.fn(async () => ({ value: undefined, done: true as const })),
      throw: vi.fn(async (error: unknown) => {
        throw error
      }),
      [Symbol.asyncIterator]() {
        return this
      },
    }
    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      ready: boolean
      sink: unknown
      duration: number
      lastRequestedTimestamp: number | null
      sampleIterator: typeof iterator | null
      drawFailureCount: number
      lastFailureKind: string
      sampleLoopError: unknown
    }
    internals.ready = true
    internals.sink = {}
    internals.duration = 10
    internals.lastRequestedTimestamp = 5
    internals.sampleIterator = iterator

    const result = await extractor.drawFrame({} as never, 5, 0, 0, 1, 1, () => false)

    expect(result).toBe(false)
    expect(iterator.next).not.toHaveBeenCalled()
    expect(internals.drawFailureCount).toBe(0)
    expect(internals.lastFailureKind).toBe('none')
    expect(internals.sampleLoopError).toBeNull()
  })

  it('aborts a sample walk when shouldContinue flips mid-decode', async () => {
    const sample = { timestamp: 0, close: vi.fn() }
    const iterator = {
      next: vi.fn(async () => ({ value: sample, done: false as const })),
      return: vi.fn(async () => ({ value: undefined, done: true as const })),
      throw: vi.fn(async (error: unknown) => {
        throw error
      }),
      [Symbol.asyncIterator]() {
        return this
      },
    }
    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      ready: boolean
      sink: unknown
      duration: number
      lastRequestedTimestamp: number | null
      sampleIterator: typeof iterator | null
      drawFailureCount: number
      lastFailureKind: string
    }
    internals.ready = true
    internals.sink = {}
    internals.duration = 10
    internals.lastRequestedTimestamp = 5
    internals.sampleIterator = iterator

    let checks = 0
    const result = await extractor.drawFrame({} as never, 5, 0, 0, 1, 1, () => {
      checks += 1
      return checks <= 3
    })

    expect(result).toBe(false)
    // One sample was consumed (ensure-top probe, loop-top probe, peek, then
    // the post-peek probe threw) — the walk stopped instead of spinning forever.
    expect(iterator.next).toHaveBeenCalledTimes(1)
    expect(internals.drawFailureCount).toBe(0)
    expect(internals.lastFailureKind).toBe('none')
  })
})
