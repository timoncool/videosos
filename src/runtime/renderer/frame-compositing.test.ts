// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { compositeFrameResults, type FrameCompositingDeps } from './frame-compositing'

describe('compositeFrameResults resource cleanup', () => {
  it('releases acquired GPU textures and result canvases when upload throws', async () => {
    const texture = {
      width: 1920,
      height: 1080,
      format: 'rgba8unorm',
      createView: vi.fn(),
    } as unknown as GPUTexture
    const releaseTexture = vi.fn()
    const releaseCanvas = vi.fn()
    const source = {} as OffscreenCanvas
    const pooledCanvas = {} as OffscreenCanvas
    const item = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Video',
    } as TimelineItem

    const deps = {
      useGpuCompositor: true,
      gpu: {
        compositor: {},
        maskManager: {},
        effects: {
          getDevice: () => ({
            queue: {
              copyExternalImageToTexture: () => {
                throw new Error('upload failed')
              },
            },
          }),
        },
        texturePool: {
          acquire: () => texture,
          release: releaseTexture,
        },
      },
      gpuCompositeOutput: { canvas: {} as OffscreenCanvas, ctx: {} as GPUCanvasContext },
      canvasSettings: { width: 1920, height: 1080 },
      maskSettings: {},
      renderTasks: [{ type: 'item', item, trackOrder: 0 }],
      results: [{ source, poolCanvases: [pooledCanvas] }],
      activeMasks: [],
      contentCanvas: {} as OffscreenCanvas,
      contentCtx: {} as OffscreenCanvasRenderingContext2D,
      itemRenderContext: {},
      canvasPool: { release: releaseCanvas },
      getCurrentItem: <TItem extends TimelineItem>(candidate: TItem) => candidate,
      getEffectiveBlendMode: () => 'normal',
      applyTrackScopedMasks: (result: unknown) => result,
      renderMasksToGpuTexture: () => null,
      renderTransitionFallbackCanvas: vi.fn(),
      renderItemWithEffects: vi.fn(),
    } as unknown as FrameCompositingDeps

    await expect(compositeFrameResults(deps)).rejects.toThrow('upload failed')
    expect(releaseTexture).toHaveBeenCalledWith(texture)
    expect(releaseCanvas).toHaveBeenCalledWith(pooledCanvas)
  })
})
