import { EffectsPipeline } from '@/infrastructure/gpu-effects'
import { TransitionPipeline } from '@/infrastructure/gpu-transitions'
import { MediaBlendPipeline, MediaRenderPipeline } from '@/infrastructure/gpu-media'
import { ShapeRenderPipeline } from '@/infrastructure/gpu-shapes'
import { GlyphAtlasTextPipeline } from '@/infrastructure/gpu-text'
import { CompositorPipeline, GpuTexturePool } from '@/infrastructure/gpu-compositor'
import { MaskCombinePipeline, MaskTextureManager } from '@/infrastructure/gpu-masks'
import type {
  GpuBitmapMaskTextureCacheEntry,
  GpuTextTextureCacheEntry,
} from './canvas-item-renderer'

/**
 * Owns the per-renderer WebGPU pipeline cluster: the effects pipeline (which
 * acquires the GPU device) plus every device-derived pipeline (transition,
 * media, media-blend, shape, text, mask-combine), the blend-mode compositor,
 * texture pool, mask-texture manager, the offscreen composite output target,
 * and the glyph/bitmap-mask texture caches.
 *
 * All pipelines are lazily initialized on first use to avoid blocking renderer
 * startup. The effects pipeline owns the GPU device; every other pipeline is
 * created from `effects.getDevice()`, so callers must `ensureEffects()` (or
 * confirm `effects` is set) before requesting the others. Behaviour and init
 * ordering are preserved verbatim from the original inline cluster in
 * `createCompositionRenderer`.
 */
export class GpuPipelineManager {
  effects: EffectsPipeline | null = null
  transition: TransitionPipeline | null = null
  media: MediaRenderPipeline | null = null
  mediaBlend: MediaBlendPipeline | null = null
  shape: ShapeRenderPipeline | null = null
  text: GlyphAtlasTextPipeline | null = null
  maskCombine: MaskCombinePipeline | null = null
  compositor: CompositorPipeline | null = null
  texturePool: GpuTexturePool | null = null
  maskManager: MaskTextureManager | null = null

  readonly textTextureCache = new Map<string, GpuTextTextureCacheEntry>()
  readonly bitmapMaskTextureCache = new Map<string, GpuBitmapMaskTextureCacheEntry>()

  private effectsInitPromise: Promise<EffectsPipeline | null> | null = null
  private compositeCanvas: OffscreenCanvas | null = null
  private compositeCtx: GPUCanvasContext | null = null
  private compositeW = 0
  private compositeH = 0
  private compositeConfigureFailed = false

  // === GPU Effects Pipeline === (owns the GPU device; lazily created)
  async ensureEffects(): Promise<EffectsPipeline | null> {
    if (this.effects) return this.effects
    if (this.effectsInitPromise) return this.effectsInitPromise
    this.effectsInitPromise = EffectsPipeline.create().then((p) => {
      this.effects = p
      this.effectsInitPromise = null
      return p
    })
    return this.effectsInitPromise
  }

  ensureTransition(): boolean {
    if (this.transition) return true
    if (!this.effects) return false
    this.transition = TransitionPipeline.create(this.effects.getDevice())
    return this.transition !== null
  }

  ensureMedia(): boolean {
    if (this.media) return true
    if (!this.effects) return false
    this.media = new MediaRenderPipeline(this.effects.getDevice())
    return true
  }

  ensureMediaBlend(): boolean {
    if (this.mediaBlend) return true
    if (!this.effects) return false
    this.mediaBlend = new MediaBlendPipeline(this.effects.getDevice())
    return true
  }

  ensureShape(): boolean {
    if (this.shape) return true
    if (!this.effects) return false
    this.shape = new ShapeRenderPipeline(this.effects.getDevice())
    return true
  }

  ensureText(): boolean {
    if (this.text) return true
    if (!this.effects) return false
    this.text = new GlyphAtlasTextPipeline(this.effects.getDevice())
    return true
  }

  ensureMaskCombine(): boolean {
    if (this.maskCombine) return true
    if (!this.effects) return false
    this.maskCombine = new MaskCombinePipeline(this.effects.getDevice())
    return true
  }

  // === GPU Compositor (for pixel-perfect blend modes) ===
  ensureCompositor(): boolean {
    if (this.compositor) return true
    if (!this.effects) return false
    const device = this.effects.getDevice()
    this.compositor = new CompositorPipeline(device)
    this.texturePool ??= new GpuTexturePool(device)
    this.maskManager = new MaskTextureManager(device)
    return true
  }

  ensureTexturePool(): GpuTexturePool {
    if (this.texturePool) return this.texturePool
    if (!this.effects) {
      throw new Error('GPU texture pool requested before GPU pipeline initialization')
    }
    this.texturePool = new GpuTexturePool(this.effects.getDevice())
    return this.texturePool
  }

  ensureCompositeOutput(width: number, height: number): GpuCompositeOutput | null {
    if (!this.effects) return null

    const dimensionsChanged = this.compositeW !== width || this.compositeH !== height
    if (dimensionsChanged) {
      this.compositeConfigureFailed = false
    }

    if (this.compositeConfigureFailed && this.compositeW === width && this.compositeH === height) {
      return null
    }

    if (!this.compositeCanvas) {
      this.compositeCanvas = new OffscreenCanvas(width, height)
    }

    if (!this.compositeCtx || dimensionsChanged) {
      if (this.compositeCanvas.width !== width || this.compositeCanvas.height !== height) {
        this.compositeCanvas.width = width
        this.compositeCanvas.height = height
      }
      this.compositeCtx = this.effects.configureCanvas(this.compositeCanvas)
      this.compositeW = width
      this.compositeH = height
      if (!this.compositeCtx) {
        this.compositeConfigureFailed = true
        return null
      }
      this.compositeConfigureFailed = false
    }

    return { canvas: this.compositeCanvas, ctx: this.compositeCtx }
  }

  /** Destroys all pipelines, the compositor/texture pool/mask manager, and the
   * texture caches. Mirrors the original renderer teardown order. */
  dispose(): void {
    this.compositor?.destroy()
    this.compositor = null
    this.texturePool?.destroy()
    this.texturePool = null
    this.maskManager?.destroy()
    this.maskManager = null
    this.compositeCtx = null
    this.compositeCanvas = null
    this.compositeW = 0
    this.compositeH = 0
    this.compositeConfigureFailed = false
    this.transition?.destroy()
    this.transition = null
    this.media?.destroy()
    this.media = null
    this.mediaBlend?.destroy()
    this.mediaBlend = null
    this.shape?.destroy()
    this.shape = null
    this.text?.destroy()
    this.text = null
    this.maskCombine?.destroy()
    this.maskCombine = null
    for (const entry of this.textTextureCache.values()) entry.texture.destroy()
    this.textTextureCache.clear()
    for (const entry of this.bitmapMaskTextureCache.values()) entry.texture.destroy()
    this.bitmapMaskTextureCache.clear()
    this.effects?.destroy()
    this.effects = null
  }
}

/** The offscreen canvas compositing renders into, plus its WebGPU context. */
export interface GpuCompositeOutput {
  canvas: OffscreenCanvas
  ctx: GPUCanvasContext
}
