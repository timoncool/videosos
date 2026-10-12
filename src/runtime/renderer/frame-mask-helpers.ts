import { applyMasks, type MaskCanvasSettings, type PreparedMask } from './canvas-masks'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import type { CanvasPool } from './canvas-pool'
import type { CanvasSettings } from './canvas-item-renderer'
import type { GpuPipelineManager } from './gpu-pipeline-manager'

/** A single rendered render-task output: either a pooled canvas or a GPU texture,
 * plus the pool canvases that must be released afterward. */
export interface RenderedTaskResult {
  source?: OffscreenCanvas
  gpuTexture?: GPUTexture
  poolCanvases: OffscreenCanvas[]
}

/**
 * Rasterizes the given masks to a full-canvas alpha texture for GPU compositing.
 * Returns null when there is no GPU texture pool, no masks, or a 2D context can't
 * be obtained. Extracted verbatim from `renderFrame`.
 */
export function renderMasksToGpuTexture(
  masks: PreparedMask[],
  deps: {
    gpu: GpuPipelineManager
    canvasSettings: CanvasSettings
    maskSettings: MaskCanvasSettings
  },
): { texture: GPUTexture; view: GPUTextureView } | null {
  const { gpu, canvasSettings, maskSettings } = deps
  if (!gpu.texturePool || masks.length === 0) return null
  const maskSource = new OffscreenCanvas(canvasSettings.width, canvasSettings.height)
  const maskSourceCtx = maskSource.getContext('2d')
  if (!maskSourceCtx) return null
  maskSourceCtx.fillStyle = 'white'
  maskSourceCtx.fillRect(0, 0, maskSource.width, maskSource.height)

  const maskedCanvas = new OffscreenCanvas(canvasSettings.width, canvasSettings.height)
  const maskedCtx = maskedCanvas.getContext('2d')
  if (!maskedCtx) return null
  applyMasks(maskedCtx, maskSource, masks, maskSettings)

  const texture = gpu.texturePool.acquire(canvasSettings.width, canvasSettings.height)
  gpu
    .effects!.getDevice()
    .queue.copyExternalImageToTexture(
      { source: maskedCanvas, flipY: false },
      { texture },
      { width: canvasSettings.width, height: canvasSettings.height },
    )
  return { texture, view: texture.createView() }
}

/**
 * Applies the masks scoped to `trackOrder` onto a Canvas2D render result.
 * No-ops (returns the input) when the result is a GPU texture, has no source,
 * masking is skipped, or no mask affects this track. Extracted verbatim from
 * `renderFrame`.
 */
export function applyTrackScopedMasks(
  result: RenderedTaskResult | null,
  trackOrder: number,
  skipMasks: boolean,
  deps: {
    activeMasks: PreparedMask[]
    canvasPool: CanvasPool
    maskSettings: MaskCanvasSettings
  },
): RenderedTaskResult | null {
  if (!result) return null
  if (result.gpuTexture) return result
  if (!result.source) return null
  if (skipMasks) {
    return result
  }

  const { activeMasks, canvasPool, maskSettings } = deps
  const applicableMasks = activeMasks.filter((mask) =>
    doesMaskAffectTrack(mask.trackOrder, trackOrder),
  )
  if (applicableMasks.length === 0) {
    return result
  }

  const { canvas: maskedCanvas, ctx: maskedCtx } = canvasPool.acquire()
  applyMasks(maskedCtx, result.source, applicableMasks, maskSettings)
  return {
    source: maskedCanvas,
    poolCanvases: [...result.poolCanvases, maskedCanvas],
  }
}
