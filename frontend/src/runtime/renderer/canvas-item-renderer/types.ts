/**
 * Shared types for the canvas item renderer modules.
 */

import type {
  TimelineItem,
  VideoItem,
  ImageItem,
  TextItem,
  ShapeItem,
  CompositionItem,
} from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type { ResolvedTransform } from '@/types/transform'
import type { ScrubbingCache } from '@/runtime/renderer/deps/preview-contract'
import type { CachedGifFrames } from '@/runtime/renderer/deps/timeline-gif-cache-contract'
import type { LottieExportProvider } from '@/infrastructure/lottie/lottie-frame-provider'
import type { CanvasPool, TextMeasurementCache } from '../canvas-pool'
import type { VideoFrameSource } from '../shared-video-extractor'
import type { ReverseVideoFrameCache } from '../reverse-video-frame-cache'
import type { PreviewPathVerticesOverride } from '@/runtime/renderer/deps/composition-runtime-contract'
import type { GpuTexturePool } from '@/infrastructure/gpu-compositor'
import type {
  MediaBlendPipeline,
  GpuMediaRect,
  GpuMediaRenderParams,
  MediaRenderPipeline,
} from '@/infrastructure/gpu-media'
import type { ShapeRenderPipeline } from '@/infrastructure/gpu-shapes'
import type { GlyphAtlasTextPipeline } from '@/infrastructure/gpu-text'
import type { MaskCombinePipeline } from '@/infrastructure/gpu-masks'
import type { AdjustmentLayerWithTrackOrder, EffectSourceMask } from '../canvas-effects'
import type { RenderTimelineSpan } from '../render-span'
import type { calculateMediaCropLayout } from '@/shared/utils/media-crop'
import type {
  CompositionControlOverrides,
  CompositionControlSchema,
} from '@/types/composition-controls'

// Re-exported helper-type used internally by shared transforms.
export type { ResolvedTransform }

/**
 * Canvas settings for rendering – width/height/fps of the composition.
 */
export interface CanvasSettings {
  width: number
  height: number
  /** Authored composition width when preview pixels are rendered at a lower resolution. */
  logicalWidth?: number
  /** Authored composition height when preview pixels are rendered at a lower resolution. */
  logicalHeight?: number
  fps: number
  /** Same-composition sources for deterministic scalar property expressions. */
  getExpressionItem?: (itemId: string) => TimelineItem | undefined
  getExpressionKeyframes?: (itemId: string) => ItemKeyframes | undefined
  /** Live transform overrides used by the interactive preview renderer. */
  getPreviewTransform?: (itemId: string) => Partial<ResolvedTransform> | undefined
}

/**
 * Resolved transform for a single item at a specific frame.
 */
export interface ItemTransform {
  x: number
  y: number
  width: number
  height: number
  anchorX?: number
  anchorY?: number
  rotation: number
  opacity: number
  cornerRadius: number
}

export type RenderImageSource = HTMLImageElement | HTMLVideoElement | ImageBitmap

export interface WorkerLoadedImage {
  source: RenderImageSource
  width: number
  height: number
}

export type RenderItemDelegate = (
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset?: number,
  renderSpan?: RenderTimelineSpan,
  preCornerPinMasks?: EffectSourceMask[],
) => Promise<void>

/**
 * Bundles the mutable/shared state that the item-level renderers need from the
 * composition renderer.  This replaces the closure captures that existed when
 * all functions lived inside `createCompositionRenderer`.
 */
export interface ItemRenderContext {
  fps: number
  canvasSettings: CanvasSettings
  canvasPool: CanvasPool
  textMeasureCache: TextMeasurementCache
  renderMode: 'export' | 'preview'
  renderItem: RenderItemDelegate
  scrubbingCache?: ScrubbingCache | null
  /** Skip the expensive full-resolution per-video ImageBitmap copy on isolated seeks. */
  captureDecodedVideoFrames?: boolean
  /** Maximum wait for an existing worker decode; undefined uses the short opportunistic wait. */
  workerPredecodeWaitMs?: number
  /**
   * Reverse shuttle must never serialize the transport behind a main-thread
   * video seek. Prefer a nearby decoded frame within this source-time window
   * and keep the exact worker request progressing independently.
   */
  nonBlockingVideoFrameToleranceSeconds?: number
  getResolvedVideoSource?: (
    item: VideoItem,
    sourceTime?: number,
    toleranceSeconds?: number,
  ) => string | null
  getCurrentItemSnapshot?: <TItem extends TimelineItem>(item: TItem) => TItem
  getLiveItemSnapshotById?: (itemId: string) => TimelineItem | undefined
  getCurrentKeyframes?: (itemId: string) => ItemKeyframes | undefined
  getPreviewTransformOverride?: (itemId: string) => Partial<ItemTransform> | undefined
  getPreviewCornerPinOverride?: (itemId: string) => TimelineItem['cornerPin'] | undefined

  // Video state
  videoExtractors: Map<string, VideoFrameSource>
  videoElements: Map<string, HTMLVideoElement>
  useMediabunny: Set<string>
  mediabunnyDisabledItems: Set<string>
  mediabunnyFailureCountByItem: Map<string, number>
  ensureVideoItemReady?: (itemId: string, item?: VideoItem) => Promise<boolean>
  /** Permit isolated comparison renders to consume exact worker-predecoded frames. */
  allowPredecodedVideoFrames?: boolean
  getCachedPredecodedBitmap?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
  ) => ImageBitmap | null
  getCachedActivePreviewFallbackBitmap?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
  ) => ImageBitmap | null
  waitForInflightPredecodedBitmap?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
    maxWaitMs?: number,
  ) => Promise<ImageBitmap | null>
  isActivePreviewTargetSuperseded?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
  ) => boolean
  isActivePreviewFrameSuperseded?: (frame: number) => boolean
  isActivePreviewFrameCurrent?: (frame: number) => boolean
  isActivePreviewFrameDecodeReady?: (frame: number) => boolean
  isActivePreviewSourceTarget?: (
    src: string,
    timestamp: number,
    toleranceSeconds?: number,
  ) => boolean
  markActivePreviewFramePending?: () => void
  markActivePreviewFallbackUsed?: () => void
  previewRootTimelineFrame?: number
  reverseVideoFrameCache?: ReverseVideoFrameCache

  // Image / GIF state
  imageElements: Map<string, WorkerLoadedImage>
  gifFramesMap: Map<string, CachedGifFrames>
  ensureImageItemReady?: (item: ImageItem) => Promise<void>
  /** Preloaded Lottie renderers keyed by item id; renders a frame on demand. */
  lottieProvider: LottieExportProvider
  ensureLottieItemReady?: (item: import('@/types/timeline').LottieItem) => Promise<void>

  // Keyframes & adjustment layers
  keyframesMap: Map<string, ItemKeyframes>
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getPreviewPathVerticesOverride?: PreviewPathVerticesOverride

  // Pre-computed sub-composition render data (built once during preload)
  subCompRenderData: Map<string, SubCompRenderData>
  /** Per-wrapper resolved sub-composition data for reusable control overrides. */
  instanceSubCompRenderDataCache?: Map<
    string,
    {
      source: SubCompRenderData
      overrides: CompositionControlOverrides
      resolved: SubCompRenderData
    }
  >

  // GPU effects pipeline (lazily initialized)
  gpuPipeline?: import('@/infrastructure/gpu-effects').EffectsPipeline | null

  // GPU transition pipeline (lazily initialized, shares device with gpuPipeline)
  gpuTransitionPipeline?: import('@/infrastructure/gpu-transitions').TransitionPipeline | null

  // GPU media renderer (lazily initialized, shares device with gpuPipeline)
  gpuMediaPipeline?: MediaRenderPipeline | null

  // GPU media blend renderer for non-normal subcomp layer blending.
  gpuMediaBlendPipeline?: MediaBlendPipeline | null

  // GPU shape renderer (lazily initialized, shares device with gpuPipeline)
  gpuShapePipeline?: ShapeRenderPipeline | null

  // GPU glyph-atlas/SDF text renderer (lazily initialized, shares device with gpuPipeline)
  gpuTextPipeline?: GlyphAtlasTextPipeline | null

  // GPU mask combiner for intersecting layer masks.
  gpuMaskCombinePipeline?: MaskCombinePipeline | null

  // Cached text glyph/layout textures for GPU transition participants.
  gpuTextTextureCache?: Map<string, GpuTextTextureCacheEntry>

  // Cached CPU-rasterized text blocks (preview only). Keyed on the text's
  // content/style/box-size — NOT on frame/opacity/transform — so a static text
  // item isn't re-laid-out and re-rasterized (expensive at large font sizes /
  // shadow blur) on every scrub frame. Map insertion order doubles as LRU.
  textRasterCache?: Map<string, TextRasterCacheEntry>

  // Cached projective corner-pin warp output for text (preview only). The CPU
  // per-pixel projective warp is the dominant cost for corner-pinned text; its
  // output is frame-invariant for static text/pin/size, so it's cached and
  // re-blitted across scrub frames. Map insertion order doubles as LRU.
  cornerPinWarpCache?: Map<string, CornerPinWarpCacheEntry>

  // Cached CPU-rasterized bitmap masks uploaded for GPU sub-composition layers.
  gpuBitmapMaskTextureCache?: Map<string, GpuBitmapMaskTextureCacheEntry>

  // Scratch GPU textures for per-layer sub-composition intermediates.
  gpuScratchTexturePool?: Pick<GpuTexturePool, 'acquire' | 'release'>

  // DOM video element provider for zero-copy playback rendering.
  // During playback, the Player's <video> elements are already at
  // the correct frame — use them directly instead of mediabunny decode.
  domVideoElementProvider?: (itemId: string) => HTMLVideoElement | null

  // Set to true when rendering transition participant clips. Widens the
  // DOM video drift threshold to prefer stale zero-copy frames over
  // 170ms mediabunny stalls during transition ramp-up / exit.
  isRenderingTransition?: boolean

  // Composition IDs currently resolving through the GPU subcomp path.
  gpuCompositionStack?: Set<string>
}

/**
 * Pre-computed render data for a sub-composition.
 * Built once during preload to avoid per-frame allocations and O(n) lookups.
 */
export interface SubCompRenderData {
  fps: number
  durationInFrames: number
  compositionControls?: CompositionControlSchema
  /** Tracks sorted bottom-to-top (highest order first), with items pre-assigned */
  sortedTracks: Array<{
    order: number
    visible: boolean
    items: TimelineItem[]
  }>
  /** O(1) keyframe lookup by item ID */
  keyframesMap: Map<string, ItemKeyframes>
  /** O(1) expression-source lookup inside this composition. */
  itemsById?: Map<string, TimelineItem>
  /** Adjustment layers from visible tracks, with their track orders */
  adjustmentLayers?: AdjustmentLayerWithTrackOrder[]
}

export interface GpuTextTextureCacheEntry {
  texture: GPUTexture
  width: number
  height: number
  bytes: number
}

export interface TextRasterCacheEntry {
  /** Pre-rasterized text box (content + shadow), padded for shadow/glyph overflow. */
  canvas: OffscreenCanvas
  /** Padding baked around the box origin so shadow/overflow isn't clipped. */
  padX: number
  padY: number
  bytes: number
}

export interface CornerPinWarpCacheEntry {
  /** Warped bitmap in source-local space. */
  canvas: OffscreenCanvas | HTMLCanvasElement
  /** Placement offset relative to the destination origin (dstX/dstY). */
  offsetX: number
  offsetY: number
  bytes: number
}

export interface GpuBitmapMaskTextureCacheEntry {
  texture: GPUTexture
  width: number
  height: number
  bytes: number
}

export interface TransitionParticipantRenderState<TItem extends TimelineItem = TimelineItem> {
  item: TItem
  transform: ItemTransform
  effects: ItemEffect[]
  renderSpan: RenderTimelineSpan
}

/**
 * Internal: resolved source for a transition participant when going through
 * the GPU direct-render path.
 */
export type ResolvedGpuMediaParticipantSource =
  | {
      kind: 'media'
      item: ImageItem | VideoItem
      source: RenderImageSource | VideoFrame
      sourceWidth: number
      sourceHeight: number
      close?: () => void
    }
  | {
      kind: 'shape'
      item: ShapeItem
      sourceWidth: number
      sourceHeight: number
      fillColor: [number, number, number, number]
      gradientEndColor?: [number, number, number, number]
      gradientAngleRad?: number
      strokeColor?: [number, number, number, number]
      pathVertices?: Array<[number, number, number?]>
      close?: () => void
    }
  | {
      kind: 'text'
      item: TextItem
      sourceWidth: number
      sourceHeight: number
      texture: GPUTexture
      close?: () => void
    }
  | {
      kind: 'composition'
      item: CompositionItem
      sourceWidth: number
      sourceHeight: number
      texture: GPUTexture
      close?: () => void
    }

/**
 * Internal: prepared participant state for direct-GPU rendering.
 */
export type PreparedGpuMediaParticipant = {
  timelineTimeSeconds?: number
  participant: TransitionParticipantRenderState
  media: ResolvedGpuMediaParticipantSource
  sourceRect: GpuMediaRect
  destRect: GpuMediaRect
  transformRect: GpuMediaRect
  featherPixels: ReturnType<typeof calculateMediaCropLayout>['featherPixels']
  cornerRadius: number
  cornerPin?: NonNullable<GpuMediaRenderParams['cornerPin']>
  rotationRad: number
  flipX: boolean
  flipY: boolean
}
