// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { renderVideoItem } from './video'
import type { ItemRenderContext, ItemTransform } from './types'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const transform: ItemTransform = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

const item = {
  id: 'clip-1',
  type: 'video',
  src: 'file.mp4',
  from: 0,
  durationInFrames: 30,
  sourceStart: 0,
  sourceFps: 30,
  sourceDuration: 30,
  speed: 1,
  transform,
} as VideoItem

function createCanvasContext(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D
}

function createRenderContext(overrides: Partial<ItemRenderContext> = {}): ItemRenderContext {
  return {
    fps: 30,
    renderMode: 'preview',
    canvasSettings: { width: 1920, height: 1080, fps: 30 },
    videoExtractors: new Map(),
    videoElements: new Map(),
    useMediabunny: new Set(),
    mediabunnyDisabledItems: new Set(),
    mediabunnyFailureCountByItem: new Map(),
    scrubbingCache: null,
    ...overrides,
  } as unknown as ItemRenderContext
}

describe('renderVideoItem', () => {
  it('waits for cold MediaBunny only after every preview fallback misses', async () => {
    const ready = createDeferred<boolean>()
    const useMediabunny = new Set<string>()
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      init: vi.fn(async () => true),
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      captureFrame: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 1),
      prewarmBatch: vi.fn(async () => 0),
      isBatchPrewarmAvailable: vi.fn(() => true),
      dispose: vi.fn(),
    }
    const ensureVideoItemReady = vi.fn(async () => {
      const initialized = await ready.promise
      if (initialized) useMediabunny.add(item.id)
      return initialized
    })
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny,
      ensureVideoItemReady,
    } as Partial<ItemRenderContext>)

    const renderPromise = renderVideoItem(createCanvasContext(), item, transform, 0, renderContext)

    await expect(
      Promise.race([renderPromise.then(() => 'rendered'), Promise.resolve('waiting')]),
    ).resolves.toBe('waiting')

    ready.resolve(true)
    await renderPromise

    expect(ensureVideoItemReady).toHaveBeenCalledOnce()
    expect(drawFrame).toHaveBeenCalledOnce()
  })

  it('draws a cached worker bitmap without waiting for cold MediaBunny', async () => {
    const ready = createDeferred<boolean>()
    const ensureVideoItemReady = vi.fn(() => ready.promise)
    const bitmap = { width: 1920, height: 1080 } as ImageBitmap
    const ctx = createCanvasContext()
    const renderContext = createRenderContext({
      ensureVideoItemReady,
      getCachedPredecodedBitmap: vi.fn(() => bitmap),
    })

    const renderPromise = renderVideoItem(ctx, item, transform, 0, renderContext)

    await expect(
      Promise.race([renderPromise.then(() => 'rendered'), ready.promise.then(() => 'initialized')]),
    ).resolves.toBe('rendered')
    await expect(renderPromise).resolves.toBe(true)
    expect(ensureVideoItemReady).toHaveBeenCalledOnce()
    expect(ctx.drawImage).toHaveBeenCalled()

    ready.resolve(false)
  })

  it('skips the full-resolution capture copy for isolated overview seeks', async () => {
    const drawFrame = vi.fn(async () => true)
    const drawFrameWithCapture = vi.fn(async () => ({
      success: true,
      capturedFrame: null,
      capturedSourceTime: null,
    }))
    const extractor = {
      drawFrame,
      drawFrameWithCapture,
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const scrubbingCache = {
      getVideoFrameEntry: vi.fn(() => undefined),
      putVideoFrame: vi.fn(),
    }
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      scrubbingCache,
      captureDecodedVideoFrames: false,
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(drawFrame).toHaveBeenCalledOnce()
    expect(drawFrameWithCapture).not.toHaveBeenCalled()
    expect(scrubbingCache.putVideoFrame).not.toHaveBeenCalled()
  })

  it('passes a live supersede probe to the extractor draw', async () => {
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    let superseded = false
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      isActivePreviewFrameSuperseded: vi.fn(() => superseded),
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(drawFrame).toHaveBeenCalledOnce()
    const firstCall = drawFrame.mock.calls[0] as unknown as unknown[]
    const shouldContinue = firstCall?.[6] as unknown as () => boolean
    expect(typeof shouldContinue).toBe('function')
    expect(shouldContinue()).toBe(true)
    superseded = true
    expect(shouldContinue()).toBe(false)
  })

  it('skips the fallback seek when the frame is superseded during the exact decode', async () => {
    let superseded = false
    const drawFrame = vi.fn(async () => {
      // Simulate the pointer moving on mid-decode: the exact path misses for
      // a frame that is already dead.
      superseded = true
      return false
    })
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'decode-error' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const markActivePreviewFramePending = vi.fn()
    const video = { currentTime: 0, readyState: 2, duration: 30 } as HTMLVideoElement
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      videoElements: new Map([[item.id, video]]),
      useMediabunny: new Set([item.id]),
      isActivePreviewFrameSuperseded: vi.fn(() => superseded),
      markActivePreviewFramePending,
    } as unknown as Partial<ItemRenderContext>)

    await expect(
      renderVideoItem(createCanvasContext(), item, transform, 12, renderContext),
    ).resolves.toBe(false)

    expect(drawFrame).toHaveBeenCalledOnce()
    expect(markActivePreviewFramePending).toHaveBeenCalled()
    // A fallback seek would have moved currentTime toward the frame's ~0.4s
    // source time and returned true; neither may happen for a dead frame.
    expect(video.currentTime).toBe(0)
  })

  it('awaits an existing worker decode for isolated seeks instead of blocking on MediaBunny', async () => {
    const bitmap = { width: 1920, height: 1080 } as ImageBitmap
    const waitForInflightPredecodedBitmap = vi.fn(async () => bitmap)
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const ctx = createCanvasContext()
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      getCachedPredecodedBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap,
      workerPredecodeWaitMs: 0,
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(ctx, item, transform, 12, renderContext)

    expect(waitForInflightPredecodedBitmap).toHaveBeenCalledWith(
      item.src,
      expect.any(Number),
      expect.any(Number),
      0,
    )
    expect(ctx.drawImage).toHaveBeenCalled()
    expect(drawFrame).not.toHaveBeenCalled()
  })

  it('does not replace a cancelled stale scrub decode with main-thread MediaBunny work', async () => {
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const isActivePreviewFrameSuperseded = vi.fn(() => true)
    const isActivePreviewTargetSuperseded = vi.fn(() => false)
    const markActivePreviewFramePending = vi.fn()
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      getCachedPredecodedBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      isActivePreviewFrameSuperseded,
      isActivePreviewTargetSuperseded,
      markActivePreviewFramePending,
      workerPredecodeWaitMs: 0,
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(isActivePreviewFrameSuperseded).toHaveBeenCalledWith(12)
    expect(isActivePreviewTargetSuperseded).not.toHaveBeenCalled()
    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
    expect(drawFrame).not.toHaveBeenCalled()
  })

  it('aborts a video render superseded after its worker lookup started', async () => {
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const isActivePreviewFrameSuperseded = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const markActivePreviewFramePending = vi.fn()
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      getCachedPredecodedBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      isActivePreviewFrameCurrent: vi.fn(() => false),
      isActivePreviewFrameSuperseded,
      isActivePreviewTargetSuperseded: vi.fn(() => false),
      markActivePreviewFramePending,
      workerPredecodeWaitMs: 0,
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(isActivePreviewFrameSuperseded).toHaveBeenCalledTimes(2)
    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
    expect(drawFrame).not.toHaveBeenCalled()
  })

  it('holds the front buffer when only the nested source target is superseded', async () => {
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const markActivePreviewFramePending = vi.fn()
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      getCachedPredecodedBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      getResolvedVideoSource: vi.fn(() => 'blob:nested-source'),
      isActivePreviewFrameCurrent: vi.fn(() => false),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
      isActivePreviewTargetSuperseded: vi.fn(() => true),
      markActivePreviewFramePending,
      workerPredecodeWaitMs: 0,
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
    expect(drawFrame).not.toHaveBeenCalled()
  })

  it('holds the previous preview until the exact active worker frame is ready', async () => {
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getCanBeTransparent: vi.fn(() => false),
      getDuration: vi.fn(() => 30),
    }
    const markActivePreviewFramePending = vi.fn()
    const waitForInflightPredecodedBitmap = vi.fn(async () => null)
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      getCachedPredecodedBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap,
      isActivePreviewFrameCurrent: vi.fn(() => true),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
      markActivePreviewFramePending,
      workerPredecodeWaitMs: 900,
    } as unknown as Partial<ItemRenderContext>)

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(waitForInflightPredecodedBitmap).toHaveBeenCalledWith(
      item.src,
      expect.any(Number),
      expect.any(Number),
      12,
    )
    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
    expect(drawFrame).not.toHaveBeenCalled()
  })

  it('draws a scrub-proxy fallback immediately while the exact worker frame settles', async () => {
    const fallbackBitmap = { width: 480, height: 270 } as ImageBitmap
    const waitForInflightPredecodedBitmap = vi.fn(async () => null)
    const getCachedActivePreviewFallbackBitmap = vi.fn(() => fallbackBitmap)
    const ctx = createCanvasContext()
    const renderContext = createRenderContext({
      getCachedPredecodedBitmap: vi.fn(() => null),
      getCachedActivePreviewFallbackBitmap,
      getResolvedVideoSource: vi.fn(() => 'blob:resolved-proxy'),
      waitForInflightPredecodedBitmap,
      isActivePreviewFrameCurrent: vi.fn(() => true),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
    })

    await renderVideoItem(ctx, item, transform, 12, renderContext)

    expect(ctx.drawImage).toHaveBeenCalledWith(
      fallbackBitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    )
    expect(waitForInflightPredecodedBitmap).not.toHaveBeenCalled()
    expect(getCachedActivePreviewFallbackBitmap).toHaveBeenCalledWith(
      'blob:resolved-proxy',
      expect.any(Number),
      expect.any(Number),
    )
    expect(renderContext.getResolvedVideoSource).toHaveBeenCalledWith(
      item,
      expect.any(Number),
      expect.any(Number),
    )
  })

  it('holds the previous frame while a scheduled compound proxy target is pending', async () => {
    const markActivePreviewFramePending = vi.fn()
    const renderContext = createRenderContext({
      getCachedPredecodedBitmap: vi.fn(() => null),
      getCachedActivePreviewFallbackBitmap: vi.fn(() => null),
      getResolvedVideoSource: vi.fn(() => 'blob:compound-proxy'),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      isActivePreviewFrameCurrent: vi.fn(() => true),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
      isActivePreviewSourceTarget: vi.fn(() => true),
      markActivePreviewFramePending,
    })

    const drewVideoFrame = await renderVideoItem(
      createCanvasContext(),
      item,
      transform,
      12,
      renderContext,
    )

    expect(drewVideoFrame).toBe(false)
    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
  })

  it('holds the front buffer when a cold nested source target was replaced on ruler exit', async () => {
    const markActivePreviewFramePending = vi.fn()
    const renderContext = createRenderContext({
      getCachedPredecodedBitmap: vi.fn(() => null),
      getCachedActivePreviewFallbackBitmap: vi.fn(() => null),
      getResolvedVideoSource: vi.fn(() => 'blob:compound-proxy'),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      isActivePreviewFrameCurrent: vi.fn(() => false),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
      isActivePreviewSourceTarget: vi.fn(() => false),
      isActivePreviewTargetSuperseded: vi.fn(() => true),
      markActivePreviewFramePending,
    })

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
  })

  it('holds the previous frame while a nested DOM video is temporarily not drawable on resume', async () => {
    const markActivePreviewFramePending = vi.fn()
    const settlingVideo = {
      readyState: 1,
      videoWidth: 1920,
      videoHeight: 1080,
      currentTime: 0,
    } as HTMLVideoElement
    const renderContext = createRenderContext({
      domVideoElementProvider: vi.fn(() => settlingVideo),
      getCachedPredecodedBitmap: vi.fn(() => null),
      getCachedActivePreviewFallbackBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      isActivePreviewFrameCurrent: vi.fn(() => false),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
      isActivePreviewSourceTarget: vi.fn(() => false),
      markActivePreviewFramePending,
    })

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
  })

  it('prefers a nearby worker frame over a nested DOM seek during reverse delivery', async () => {
    const nearbyWorkerBitmap = { width: 480, height: 270 } as ImageBitmap
    const staleDomVideo = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
      currentTime: 0.5,
      dataset: {},
    } as HTMLVideoElement
    const getCachedPredecodedBitmap = vi.fn(
      (_src: string, _sourceTime: number, toleranceSeconds: number) =>
        toleranceSeconds >= 0.5 ? nearbyWorkerBitmap : null,
    )
    const extractor = {
      drawFrame: vi.fn(async () => true),
      drawFrameWithCapture: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getDuration: vi.fn(() => 1),
    }
    const ctx = createCanvasContext()
    const renderContext = createRenderContext({
      domVideoElementProvider: vi.fn(() => staleDomVideo),
      nonBlockingVideoFrameToleranceSeconds: 0.5,
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny: new Set([item.id]),
      getCachedPredecodedBitmap,
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      workerPredecodeWaitMs: 0,
    } as unknown as Partial<ItemRenderContext>)

    await expect(renderVideoItem(ctx, item, transform, 12, renderContext)).resolves.toBe(true)

    expect(ctx.drawImage).toHaveBeenCalledWith(
      nearbyWorkerBitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    )
    expect(ctx.drawImage).not.toHaveBeenCalledWith(
      staleDomVideo,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    )
    expect(extractor.drawFrame).not.toHaveBeenCalled()
  })

  it('holds the front buffer when an active video item temporarily has no source target', async () => {
    const markActivePreviewFramePending = vi.fn()
    const renderContext = createRenderContext({
      getCachedPredecodedBitmap: vi.fn(() => null),
      getCachedActivePreviewFallbackBitmap: vi.fn(() => null),
      waitForInflightPredecodedBitmap: vi.fn(async () => null),
      isActivePreviewFrameCurrent: vi.fn(() => true),
      isActivePreviewFrameSuperseded: vi.fn(() => false),
      isActivePreviewSourceTarget: vi.fn(() => false),
      markActivePreviewFramePending,
    })

    await renderVideoItem(createCanvasContext(), item, transform, 12, renderContext)

    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
  })

  it('holds a paused ramp-owned transition video without blocking on its seek', async () => {
    const target = new EventTarget()
    const mutableVideo = Object.assign(target, {
      currentTime: 0.6,
      dataset: { transitionHold: '1', transitionSourceRamp: '1' },
      paused: true,
      readyState: 1,
      videoHeight: 1080,
      videoWidth: 1920,
    })
    const domVideo = mutableVideo as unknown as HTMLVideoElement
    const markActivePreviewFramePending = vi.fn()
    const ctx = createCanvasContext()
    const renderContext = createRenderContext({
      domVideoElementProvider: vi.fn(() => domVideo),
      isRenderingTransition: true,
      markActivePreviewFramePending,
    })

    await expect(
      renderVideoItem(ctx, item, transform, 12, renderContext, 0, {
        from: 0,
        durationInFrames: 30,
        sourceStart: 0,
        sourceTimeRamp: {
          anchor: 'start',
          rampStart: 0,
          rampEnd: 20,
          slope: 0.5,
        },
      }),
    ).resolves.toBe(false)
    expect(ctx.drawImage).not.toHaveBeenCalled()
    expect(markActivePreviewFramePending).toHaveBeenCalledOnce()
  })
})
