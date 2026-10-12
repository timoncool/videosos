// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { resolveScrubbingRamBudgetBytes, ScrubbingCache } from './scrubbing-cache'

type ClosableFrame = ImageBitmap & {
  close: ReturnType<typeof vi.fn>
}

function createMockFrame(): ClosableFrame {
  return {
    close: vi.fn(),
  } as unknown as ClosableFrame
}

function createDeferredBitmap() {
  let resolve!: (bitmap: ImageBitmap) => void
  const promise = new Promise<ImageBitmap>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function installMockWebGpu() {
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }
  const canvasContext = {
    configure: vi.fn(),
    getCurrentTexture: () => ({ createView: () => ({}) }),
  }
  class MockOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return canvasContext
    }
  }
  const texture = {
    createView: () => ({}),
    destroy: vi.fn(),
  }
  const createBindGroup = vi.fn(() => ({}))
  const device = {
    createTexture: vi.fn(() => texture),
    createSampler: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup,
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    })),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn(),
    },
  } as unknown as GPUDevice

  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
  vi.stubGlobal('GPUTextureUsage', {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
  })
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 1 })
  vi.stubGlobal('navigator', {
    gpu: { getPreferredCanvasFormat: () => 'rgba8unorm' },
    deviceMemory: 8,
  })
  return { device, texture, createBindGroup }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ScrubbingCache memory budget', () => {
  it('uses conservative adaptive limits instead of the former multi-gigabyte budget', () => {
    expect(resolveScrubbingRamBudgetBytes()).toBe(384_000_000)
    expect(resolveScrubbingRamBudgetBytes(4)).toBe(256_000_000)
    expect(resolveScrubbingRamBudgetBytes(8)).toBe(500_000_000)
    expect(resolveScrubbingRamBudgetBytes(64)).toBe(1_000_000_000)
  })
})

describe('ScrubbingCache asynchronous RAM writes', () => {
  it('deduplicates frames and caps concurrent ImageBitmap copies', () => {
    const deferredA = createDeferredBitmap()
    const deferredB = createDeferredBitmap()
    const createBitmap = vi
      .fn()
      .mockReturnValueOnce(deferredA.promise)
      .mockReturnValueOnce(deferredB.promise)
    vi.stubGlobal('createImageBitmap', createBitmap)
    const cache = new ScrubbingCache()
    const canvas = {} as OffscreenCanvas

    cache.cacheFrame(10, canvas)
    cache.cacheFrame(10, canvas)
    cache.cacheFrame(11, canvas)
    cache.cacheFrame(12, canvas)

    expect(createBitmap).toHaveBeenCalledTimes(2)
    expect(cache.getStats().pendingRamFrames).toBe(2)
  })

  it('closes a pending bitmap that resolves after selective invalidation', async () => {
    const deferred = createDeferredBitmap()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => deferred.promise),
    )
    const cache = new ScrubbingCache()
    const bitmap = createMockFrame()

    cache.cacheFrame(24, {} as OffscreenCanvas)
    cache.invalidate({ frames: [24] })
    deferred.resolve(bitmap)
    await deferred.promise
    await Promise.resolve()

    expect(bitmap.close).toHaveBeenCalledTimes(1)
    expect(cache.getRamFrame(24)).toBeUndefined()
    expect(cache.getStats().pendingRamFrames).toBe(0)
  })

  it('closes a pending bitmap that resolves after disposal', async () => {
    const deferred = createDeferredBitmap()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => deferred.promise),
    )
    const cache = new ScrubbingCache()
    const bitmap = createMockFrame()

    cache.cacheFrame(30, {} as OffscreenCanvas)
    cache.dispose()
    deferred.resolve(bitmap)
    await deferred.promise
    await Promise.resolve()

    expect(bitmap.close).toHaveBeenCalledTimes(1)
    expect(cache.getRamFrame(30)).toBeUndefined()
  })
})

describe('ScrubbingCache GPU lifecycle', () => {
  it('reuses a cached blit bind group across repeated hits', () => {
    const { device, createBindGroup } = installMockWebGpu()
    const cache = new ScrubbingCache()
    const source = {} as ImageBitmap

    cache.setGpuDevice(device, 64, 64)
    cache.putGpuFrame(12, source)
    expect(cache.getGpuFrame(12)).not.toBeNull()
    expect(cache.getGpuFrame(12)).not.toBeNull()

    expect(createBindGroup).toHaveBeenCalledTimes(1)
  })

  it('drops differently sized RAM frames when render dimensions change', () => {
    const { device } = installMockWebGpu()
    const cache = new ScrubbingCache()
    const bitmap = createMockFrame()

    cache.setGpuDevice(device, 64, 64)
    cache.putRamFrame(4, bitmap)
    cache.setGpuDevice(device, 128, 128)

    expect(bitmap.close).toHaveBeenCalledTimes(1)
    expect(cache.getRamFrame(4)).toBeUndefined()
    expect(cache.getStats().tier3Bytes).toBe(0)
  })

  it('evicts RAM frames at the configured byte budget', () => {
    const { device } = installMockWebGpu()
    const bytesPerFrame = 64 * 64 * 4
    const cache = new ScrubbingCache(10, 10, bytesPerFrame * 2)
    const first = createMockFrame()
    const second = createMockFrame()
    const third = createMockFrame()

    cache.setGpuDevice(device, 64, 64)
    cache.putRamFrame(1, first)
    cache.putRamFrame(2, second)
    cache.putRamFrame(3, third)

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).not.toHaveBeenCalled()
    expect(third.close).not.toHaveBeenCalled()
    expect(cache.getStats()).toMatchObject({
      tier3Size: 2,
      tier3Bytes: bytesPerFrame * 2,
      tier3BudgetBytes: bytesPerFrame * 2,
    })
  })
})

describe('ScrubbingCache tier 2 video frames', () => {
  it('returns an entry when the source time is within tolerance', () => {
    const cache = new ScrubbingCache()
    const frame = createMockFrame()

    cache.putVideoFrame('item-1', frame, 1.0)

    const entry = cache.getVideoFrameEntry('item-1', 1.02, 0.05)

    expect(entry?.frame).toBe(frame)
    expect(entry?.sourceTime).toBe(1.0)
    expect(cache.getStats().tier2Hits).toBe(1)
  })

  it('misses without incrementing hits when the source time is outside tolerance', () => {
    const cache = new ScrubbingCache()

    cache.putVideoFrame('item-1', createMockFrame(), 1.0)

    const entry = cache.getVideoFrameEntry('item-1', 1.2, 0.05)

    expect(entry).toBeUndefined()
    expect(cache.getStats().tier2Hits).toBe(0)
  })

  it('closes the previous frame when replacing a cached entry', () => {
    const cache = new ScrubbingCache()
    const firstFrame = createMockFrame()
    const secondFrame = createMockFrame()

    cache.putVideoFrame('item-1', firstFrame, 1.0)
    cache.putVideoFrame('item-1', secondFrame, 1.1)

    expect(firstFrame.close).not.toHaveBeenCalled()
    expect(secondFrame.close).not.toHaveBeenCalled()
  })

  it('keeps a small recent-frame runway per item and returns the closest match', () => {
    const cache = new ScrubbingCache()
    const frameA = createMockFrame()
    const frameB = createMockFrame()
    const frameC = createMockFrame()

    cache.putVideoFrame('item-1', frameA, 1.0)
    cache.putVideoFrame('item-1', frameB, 1.1)
    cache.putVideoFrame('item-1', frameC, 1.2)

    const entry = cache.getVideoFrameEntry('item-1', 1.11, 0.05)

    expect(entry?.frame).toBe(frameB)
    expect(frameA.close).not.toHaveBeenCalled()
    expect(frameB.close).not.toHaveBeenCalled()
    expect(frameC.close).not.toHaveBeenCalled()
  })

  it('closes cached frames when invalidating tier 2 entries', () => {
    const cache = new ScrubbingCache()
    const frame = createMockFrame()

    cache.putVideoFrame('item-1', frame, 1.0)
    cache.invalidateVideoFrames()

    expect(frame.close).toHaveBeenCalledTimes(1)
    expect(cache.getVideoFrameEntry('item-1')).toBeUndefined()
  })
})

describe('ScrubbingCache frame invalidation', () => {
  it('invalidates only cached frames that overlap the requested ranges', () => {
    const cache = new ScrubbingCache()
    const changedFrame = createMockFrame()
    const untouchedFrame = createMockFrame()

    cache.putRamFrame(10, changedFrame)
    cache.putRamFrame(20, untouchedFrame)

    cache.invalidate({
      ranges: [{ startFrame: 8, endFrame: 12 }],
    })

    expect(changedFrame.close).toHaveBeenCalledTimes(1)
    expect(cache.getFrame(10)).toBeNull()
    expect(untouchedFrame.close).not.toHaveBeenCalled()
    expect(cache.getFrame(20)).toBe(untouchedFrame)
  })
})
