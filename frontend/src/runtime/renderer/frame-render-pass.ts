/**
 * Per-frame render pass for the composition renderer.
 *
 * `renderFrame`'s body lives here verbatim: the pass owns the per-frame flow
 * (cache probe, scene/mask resolution, GPU pipeline warm-up, task execution and
 * compositing) and reads renderer-lifetime dependencies through {@link FrameRenderDeps},
 * assembled once per renderer instead of closed over per call. The four bindings
 * the prewarm/cache paths also read or write are reached through `this.deps` so
 * there is exactly one storage location for them.
 *
 * Extracted from `client-render-engine.ts` per
 * `docs/render-frame-decomposition-plan.md` (Phase B).
 */

import type { MaskCanvasSettings, PreparedMask } from './canvas-masks'
import type { CanvasSettings, ItemRenderContext } from './canvas-item-renderer/types'
import type { CanvasPool } from './canvas-pool'
import type { GpuCompositeOutput, GpuPipelineManager } from './gpu-pipeline-manager'
import type { FrameCompositionScene } from '@/runtime/composition-runtime/utils/frame-scene'
import type { ScrubbingCache } from './deps/preview-contract'
import type { VideoFrameSource } from './shared-video-extractor'
import type { AdjustmentLayerWithTrackOrder } from './canvas-effects'
import type { ActiveTransition } from './canvas-transitions'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type { ResolvedTransform } from '@/types/transform'
import type { LottieItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'
import { recordPreviewCompositionRender } from '@/shared/logging/preview-scrub-performance'
import { isItemFullyOccluding, type FrameOcclusionContext } from './frame-occlusion'
import { renderMasksToGpuTexture as renderMasksToGpuTexturePure, applyTrackScopedMasks as applyTrackScopedMasksPure, type RenderedTaskResult } from './frame-mask-helpers'
import { renderTransitionFallbackCanvas as renderTransitionFallbackCanvasPure, renderItemWithEffects as renderItemWithEffectsPure, type FrameItemRenderDeps } from './frame-render-tasks'
import { compositeFrameResults } from './frame-compositing'
import { getCompositeOperation } from '@/types/blend-mode-css'
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope'
import { hasCornerPin, resolveFrameRenderScene } from '@/runtime/renderer/deps/composition-runtime-contract'
import { renderTransitionToGpuTexture } from './canvas-item-renderer'
import { resolveFrameRenderOptimization } from './render-path-optimizer'
import { shouldRenderResolvedItemAtFrame } from './render-engine-predicates'

// ---------------------------------------------------------------------------
//
// Gated on `window.__SCRUB_PERF__ = true` (off by default -> zero overhead).
// When on, every `run()` records its wall-time + which path it took
// (cache-hit / direct / full) into `window.__scrubPerf` and emits a
// `scrub.renderFrame.<path>` User Timing measure so it shows up on the
// Performance panel's Timings track. Read with:
//   window.__scrubPerf            // raw ring buffer
//   - or record a Performance profile and look for `scrub.renderFrame.*`.

interface ScrubPerfSample {
  f: number
  path: 'cache-hit' | 'direct' | 'full' | 'aborted'
  ms: number
  planMs?: number
  taskMs?: number
  gpuWaitMs?: number
  compositeMs?: number
  finalizeMs?: number
  taskCount?: number
  transitionCount?: number
  slowTasks?: Array<{ id: string; kind: string; ms: number }>
}
type ScrubPerfGlobal = {
  __SCRUB_PERF__?: boolean
  __scrubPerf?: ScrubPerfSample[]
}

function scrubPerfStart(): number {
  return (globalThis as ScrubPerfGlobal).__SCRUB_PERF__ ||
    import.meta.env.DEV ||
    import.meta.env.MODE === 'perf'
    ? performance.now()
    : -1
}

function recordScrubPerf(
  frame: number,
  path: ScrubPerfSample['path'],
  startMs: number,
  details: Omit<ScrubPerfSample, 'f' | 'path' | 'ms'> = {},
): void {
  if (startMs < 0) return
  const w = globalThis as ScrubPerfGlobal
  const ms = Number((performance.now() - startMs).toFixed(2))
  recordPreviewCompositionRender({ frame, path, ms, ...details })
  const buffer = (w.__scrubPerf ??= [])
  buffer.push({ f: frame, path, ms, ...details })
  if (buffer.length > 3000) buffer.shift()
  try {
    performance.measure(`scrub.renderFrame.${path}`, { start: startMs })
  } catch {
    /* User Timing unavailable — ignore */
  }
}

/** Logger for this pass; the tag matches the renderer's so both share one channel. */
function getLog() {
  return createLogger('ClientRenderEngine')
}

/** Masks and scene resolved for one frame by the renderer's scene helper. */
export interface FrameSceneState {
  activeMasks: PreparedMask[]
  frameScene: FrameCompositionScene
}

/**
 * Renderer-lifetime dependencies of one frame render. Assembled once in
 * `createCompositionRenderer`; nothing here is per-frame state.
 */
export interface FrameRenderDeps {
  gpu: GpuPipelineManager
  canvasPool: CanvasPool
  canvasSettings: CanvasSettings
  maskSettings: MaskCanvasSettings
  itemRenderContext: ItemRenderContext
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  lottieItems: LottieItem[]
  transitionTrackOrderById: Map<string, number>
  videoExtractors: Map<string, VideoFrameSource>
  sortedTracks: TimelineTrack[]
  tracksTopToBottom: TimelineTrack[]
  visibleTrackIds: Set<string>
  setupGpuCompositor: (hasNonNormalBlend: boolean) => Promise<{
    useGpuCompositor: boolean
    gpuCompositeOutput: GpuCompositeOutput | null
  }>
  scrubbingCache: ScrubbingCache | null
  ctx: OffscreenCanvasRenderingContext2D
  canvas: OffscreenCanvas
  /** What `resolveCompositionRendererExecutionPolicy` resolved for this renderer. */
  renderMode: 'export' | 'preview'
  scrubbingFrameCacheActive: boolean
  lastRenderAborted: boolean
  activePreviewFramePending: boolean
  activePreviewFallbackUsed: boolean
  cacheRenderedFrame: (frame: number) => void
  detectFrameGpuEffects: (frame: number) => boolean
  discardFrameResults: (results: Array<RenderedTaskResult | null>, contentCanvas: OffscreenCanvas) => void
  ensureFrameGpuPipelines: (hasAnyGpuEffects: boolean, hasActiveTransitions: boolean) => Promise<void>
  ensureLottieOverridesFresh: () => Promise<void>
  lottieOverridesAreStale: () => boolean
  refreshFrameRenderContext: (frame: number) => void
  resolveFrameSceneState: (frame: number) => FrameSceneState
  perfMarkIfEnabled: (enabledMs: number) => number
  getCurrentKeyframes: (itemId: string) => ItemKeyframes | undefined
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getPreviewTransformOverride: ((itemId: string) => Partial<ResolvedTransform> | undefined) | undefined
  getPreviewEffectsOverride: ((itemId: string) => ItemEffect[] | undefined) | undefined
  getPreviewCornerPinOverride: ((itemId: string) => TimelineItem['cornerPin'] | undefined) | undefined
  getLiveItemSnapshot: ((itemId: string) => TimelineItem | undefined) | undefined
}

export class FrameRenderPass {
  constructor(private readonly deps: FrameRenderDeps) {}

  async run(frame: number): Promise<void> {
    const {
      gpu,
      canvasPool,
      canvasSettings,
      maskSettings,
      itemRenderContext,
      adjustmentLayers,
      lottieItems,
      transitionTrackOrderById,
      videoExtractors,
      sortedTracks,
      tracksTopToBottom,
      visibleTrackIds,
      setupGpuCompositor,
      scrubbingCache,
      ctx,
      canvas,
      renderMode,
      cacheRenderedFrame,
      detectFrameGpuEffects,
      discardFrameResults,
      ensureFrameGpuPipelines,
      ensureLottieOverridesFresh,
      lottieOverridesAreStale,
      refreshFrameRenderContext,
      resolveFrameSceneState,
      perfMarkIfEnabled,
      getCurrentKeyframes,
      getCurrentItem,
      getPreviewTransformOverride,
      getPreviewEffectsOverride,
      getPreviewCornerPinOverride,
      getLiveItemSnapshot,
    } = this.deps

    const scrubPerfStartMs = scrubPerfStart()
    this.deps.lastRenderAborted = false
    this.deps.activePreviewFramePending = false
    this.deps.activePreviewFallbackUsed = false
    itemRenderContext.previewRootTimelineFrame = frame
    const isSupersededActivePreviewFrame = () =>
      renderMode === 'preview' &&
      itemRenderContext.isActivePreviewFrameSuperseded?.(frame) === true
    const abortActivePreviewRender = () => {
      if (!this.deps.lastRenderAborted) {
        recordScrubPerf(frame, 'aborted', scrubPerfStartMs)
      }
      this.deps.lastRenderAborted = true
    }
    const runRenderFramePrologue = (): boolean => {
      if (isSupersededActivePreviewFrame()) {
        abortActivePreviewRender()
        return false
      }
      if (
        itemRenderContext.isActivePreviewFrameCurrent?.(frame) &&
        itemRenderContext.isActivePreviewFrameDecodeReady?.(frame) === false
      ) {
        abortActivePreviewRender()
        return false
      }
      // 3-tier cache lookup (preview only)
      // Tier 1 (GPU texture) → Tier 3 (RAM ImageBitmap) → miss → full render
      if (scrubbingCache && this.deps.scrubbingFrameCacheActive) {
        const cached = scrubbingCache.getFrame(frame)
        if (cached) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(cached, 0, 0)
          recordScrubPerf(frame, 'cache-hit', scrubPerfStartMs)
          return false
        }
      }
      return true
    }
    if (!runRenderFramePrologue()) return

    refreshFrameRenderContext(frame)

    // Rebuild any Lottie whose text/color overrides changed since preload, so
    // live recolor/text edits show up. The sync guard keeps this ~free on the
    // hot path — the await only runs the frame after an override edit.
    if (renderMode === 'preview' && lottieItems.length > 0 && lottieOverridesAreStale()) {
      await ensureLottieOverridesFresh()
      if (isSupersededActivePreviewFrame()) {
        abortActivePreviewRender()
        return
      }
    }

    const { activeMasks, frameScene } = resolveFrameSceneState(frame)
    const { activeTransitions, transitionClipIds } = frameScene.transitionFrameState

    const hasAnyGpuEffects = detectFrameGpuEffects(frame)
    await ensureFrameGpuPipelines(hasAnyGpuEffects, activeTransitions.length > 0)
    if (isSupersededActivePreviewFrame()) {
      abortActivePreviewRender()
      return
    }

    /**
     * Render a single item with effects. Returns the canvas to composite
     * (and canvases to release) for deferred compositing, or composites
     * immediately in export mode.
     */
    const itemRenderDeps: FrameItemRenderDeps = {
      frame,
      canvasSettings,
      maskSettings,
      renderMode,
      activeMasks,
      adjustmentLayers,
      gpu,
      itemRenderContext,
      canvasPool,
      getCurrentItem,
      getCurrentKeyframes,
      getPreviewTransformOverride,
      getPreviewCornerPinOverride,
      getPreviewEffectsOverride,
      getLiveItemSnapshot,
    }
    const renderItemWithEffects = (
      baseItem: TimelineItem,
      trackOrder: number,
      deferred: boolean,
      targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      bakeMasks = true,
      preferGpuTextureOutput = false,
      allowDirectGpu = true,
    ): Promise<RenderedTaskResult | null> =>
      renderItemWithEffectsPure(
        baseItem,
        trackOrder,
        deferred,
        targetCtx,
        itemRenderDeps,
        bakeMasks,
        preferGpuTextureOutput,
        allowDirectGpu,
      )

    const getEffectiveBlendMode = (item: TimelineItem): TimelineItem['blendMode'] => {
      const blendMode = item.blendMode
      if (!blendMode || blendMode === 'normal') return blendMode
      return blendMode
    }

    // Helper to check if item should be rendered
    const shouldRenderItem = (baseItem: TimelineItem): boolean =>
      shouldRenderResolvedItemAtFrame(getCurrentItem(baseItem), frame, transitionClipIds)
    // === OCCLUSION CULLING OPTIMIZATION ===
    // Find the topmost (lowest order) track with a fully occluding item.
    // Skip rendering all tracks below it (higher order) since they'll be fully covered.
    //
    // An item is fully occluding if:
    // - Covers entire canvas (after transform/keyframes)
    // - Opacity = 1 (after keyframe animation)
    // - No rotation (or 0/180 that still covers)
    // - No corner radius
    // - Is video/image (opaque content)
    // - Not in a transition
    // - No transparency effects
    // - No active masks (masks could reveal content below)

    const occlusionContext: FrameOcclusionContext = {
      frame,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      canvasSettings,
      renderMode,
      transitionClipIds,
      adjustmentLayers,
      getCurrentItem,
      getCurrentKeyframes,
      getPreviewEffectsOverride,
      getLiveItemSnapshot,
      hasTransparentVideoSource: (occItem) =>
        videoExtractors.get(occItem.id)?.getCanBeTransparent() ?? false,
    }
    const isFullyOccluding = (baseItem: TimelineItem, trackOrder: number): boolean =>
      isItemFullyOccluding(baseItem, trackOrder, occlusionContext)

    // Find occlusion cutoff – the lowest track order with a fully occluding item
    // If masks are active, disable occlusion culling (masks could reveal content)
    const { occlusionCutoffOrder, renderTasks } = resolveFrameRenderScene<ActiveTransition>({
      tracksByOrderDesc: sortedTracks,
      tracksByOrderAsc: tracksTopToBottom,
      visibleTrackIds,
      activeTransitions,
      getTransitionTrackOrder: (activeTransition) =>
        transitionTrackOrderById.get(activeTransition.transition.id) ?? 0,
      disableOcclusion: activeMasks.length > 0,
      shouldRenderItem,
      isFullyOccluding,
    })

    const logOcclusionCulling = (): void => {
      if (occlusionCutoffOrder === null || !import.meta.env.DEV || frame % 30 !== 0) return
      const occludingTask = sortedTracks
        .filter(
          (track) => visibleTrackIds.has(track.id) && (track.order ?? 0) === occlusionCutoffOrder,
        )
        .flatMap((track) => track.items ?? [])
        .find((item) => shouldRenderItem(item) && isFullyOccluding(item, occlusionCutoffOrder))
      if (occludingTask) {
        getLog().debug(
          `Occlusion culling: item ${occludingTask.id.substring(0, 8)} on track order ${occlusionCutoffOrder} fully occludes canvas`,
        )
      }
    }
    logOcclusionCulling()

    const { shouldDirectRenderSingleTask, shouldUseDeferredGpuBatch } =
      resolveFrameRenderOptimization({
        activeMaskCount: activeMasks.length,
        activeTransitionCount: activeTransitions.length,
        hasGpuEffects: hasAnyGpuEffects,
        renderTaskCount: renderTasks.length,
      })
    const hasNonNormalBlendItem = (t: (typeof renderTasks)[number]): boolean => {
      if (t.type !== 'item') return false
      const item = getCurrentItem(t.item)
      const blendMode = getEffectiveBlendMode(item)
      return Boolean(blendMode && blendMode !== 'normal')
    }
    const hasNonNormalBlend = renderTasks.some((t) => hasNonNormalBlendItem(t))
    const { useGpuCompositor, gpuCompositeOutput } = await setupGpuCompositor(hasNonNormalBlend)
    if (shouldUseDeferredGpuBatch && itemRenderContext.gpuPipeline) {
      itemRenderContext.gpuPipeline.beginBatch()
    }

    const tryRenderDirectSingleTask = async (): Promise<boolean> => {
      if (!shouldDirectRenderSingleTask) return false
      if (isSupersededActivePreviewFrame()) {
        abortActivePreviewRender()
        return true
      }
      const directTask = renderTasks[0]
      if (directTask?.type === 'item') {
        const blendMode = getEffectiveBlendMode(getCurrentItem(directTask.item))
        try {
          if (blendMode && blendMode !== 'normal') {
            ctx.globalCompositeOperation = getCompositeOperation(blendMode)
          }

          await renderItemWithEffects(directTask.item, directTask.trackOrder, false, ctx)
        } finally {
          if (blendMode && blendMode !== 'normal') {
            ctx.globalCompositeOperation = 'source-over'
          }
        }
      }

      if (isSupersededActivePreviewFrame() || this.deps.activePreviewFramePending) {
        abortActivePreviewRender()
        return true
      }

      cacheRenderedFrame(frame)
      recordScrubPerf(frame, 'direct', scrubPerfStartMs)
      return true
    }
    if (await tryRenderDirectSingleTask()) return

    // === PERFORMANCE: Use pooled canvas instead of creating new one each frame ===
    const { canvas: contentCanvas, ctx: contentCtx } = canvasPool.acquire()
    const scrubPerfTaskStartMs = perfMarkIfEnabled(scrubPerfStartMs)
    let scrubPerfTaskEndMs = scrubPerfTaskStartMs
    let scrubPerfGpuWaitEndMs = scrubPerfTaskStartMs
    let scrubPerfCompositeEndMs = scrubPerfTaskStartMs

    // Render tracks in order (bottom to top), with transitions at their track position
    // Track order: higher values render first (behind), lower values render last (on top)
    let skippedTracks = 0
    let finalCompositeSource: OffscreenCanvas = contentCanvas

    // Parallelize item rendering (video decode is the bottleneck).
    // Collect all renderable items in z-order, fire all renders concurrently,
    // then composite results in z-order.
    const scrubSlowTasks: Array<{ id: string; kind: string; ms: number }> = []
    {
      if (occlusionCutoffOrder !== null) {
        skippedTracks = sortedTracks.filter(
          (track) => visibleTrackIds.has(track.id) && (track.order ?? 0) > occlusionCutoffOrder,
        ).length
      }

      const renderMasksToGpuTexture = (masks: PreparedMask[]) =>
        renderMasksToGpuTexturePure(masks, { gpu, canvasSettings, maskSettings })

      const renderTransitionFallbackCanvas = (
        task: Extract<(typeof renderTasks)[number], { type: 'transition' }>,
      ): Promise<RenderedTaskResult> =>
        renderTransitionFallbackCanvasPure(task, {
          frame,
          activeMasks,
          itemRenderContext,
          canvasPool,
        })

      const applyTrackScopedMasks = (
        result: RenderedTaskResult | null,
        trackOrder: number,
        skipMasks: boolean,
      ): RenderedTaskResult | null =>
        applyTrackScopedMasksPure(result, trackOrder, skipMasks, {
          activeMasks,
          canvasPool,
          maskSettings,
        })

      const renderTask = async (
        task: (typeof renderTasks)[number],
      ): Promise<RenderedTaskResult | null> => {
        const taskStartMs = perfMarkIfEnabled(scrubPerfStartMs)
        try {
          if (isSupersededActivePreviewFrame()) return null
          if (task.type === 'item') {
            const item = getCurrentItem(task.item)
            const canSeparateMasks =
              useGpuCompositor && gpu.texturePool && !hasCornerPin(item.cornerPin)
            return renderItemWithEffects(
              task.item,
              task.trackOrder,
              true,
              contentCtx,
              !canSeparateMasks,
              false,
            )
          }
          const transitionMasks = activeMasks.filter((mask) =>
            doesMaskAffectTrack(mask.trackOrder, task.trackOrder),
          )
          if (
            useGpuCompositor &&
            gpu.texturePool &&
            transitionMasks.length === 0 &&
            itemRenderContext.gpuTransitionPipeline
          ) {
            const transitionTexture = gpu.texturePool.acquire(
              canvasSettings.width,
              canvasSettings.height,
            )
            const renderedToTexture = await renderTransitionToGpuTexture(
              transitionTexture,
              task.transition,
              frame,
              itemRenderContext,
              task.trackOrder,
              gpu.texturePool,
            )
            if (renderedToTexture) {
              return {
                gpuTexture: transitionTexture,
                poolCanvases: [],
              } satisfies RenderedTaskResult
            }
            gpu.texturePool.release(transitionTexture)
          }
          // Transitions: render to a dedicated canvas
          return renderTransitionFallbackCanvas(task)
        } finally {
          if (taskStartMs >= 0) {
            const taskMs = performance.now() - taskStartMs
            if (taskMs >= 8) {
              const currentItem = task.type === 'item' ? getCurrentItem(task.item) : null
              scrubSlowTasks.push({
                id:
                  currentItem?.id ??
                  (task.type === 'transition' ? task.transition.transition.id : 'unknown'),
                kind: currentItem?.type ?? task.type,
                ms: Number(taskMs.toFixed(2)),
              })
            }
          }
        }
      }

      const renderTasksWithInteractionLimit = async () => {
        const results: Array<RenderedTaskResult | null> = Array(renderTasks.length).fill(null)
        const concurrency =
          renderMode === 'preview' ? Math.min(1, renderTasks.length) : renderTasks.length
        let nextTaskIndex = 0
        const worker = async () => {
          while (nextTaskIndex < renderTasks.length) {
            if (isSupersededActivePreviewFrame()) return
            const taskIndex = nextTaskIndex++
            results[taskIndex] = await renderTask(renderTasks[taskIndex]!)
          }
        }
        await Promise.all(Array.from({ length: concurrency }, () => worker()))
        return results
      }

      let results: Array<RenderedTaskResult | null>
      try {
        // Ordinary playback/export retains full parallelism. Active scrubs
        // cap item-level concurrency so a complex frame cannot exhaust the
        // canvas pool while its exact worker bitmaps are still arriving.
        results = await renderTasksWithInteractionLimit()
        scrubPerfTaskEndMs = perfMarkIfEnabled(scrubPerfStartMs)
      } finally {
        // End GPU pool mode before compositing, even if one task fails.
        if (shouldUseDeferredGpuBatch && itemRenderContext.gpuPipeline) {
          itemRenderContext.gpuPipeline.endBatch()
        }
      }

      if (isSupersededActivePreviewFrame() || this.deps.activePreviewFramePending) {
        discardFrameResults(results, contentCanvas)
        abortActivePreviewRender()
        return
      }

      // Consume pooled WebGPU canvases synchronously below. Awaiting the queue
      // here crosses a task boundary, allowing the browser to present and
      // discard a GPUCanvasContext texture before Canvas2D reads it. The first
      // drawImage performs the required GPU stall and preserves heavy effect
      // stacks without intermittent black frames.
      scrubPerfGpuWaitEndMs = perfMarkIfEnabled(scrubPerfStartMs)

      finalCompositeSource = await compositeFrameResults({
        useGpuCompositor,
        gpu,
        gpuCompositeOutput,
        canvasSettings,
        maskSettings,
        renderTasks,
        results,
        activeMasks,
        contentCanvas,
        contentCtx,
        itemRenderContext,
        canvasPool,
        getCurrentItem,
        getEffectiveBlendMode,
        applyTrackScopedMasks,
        renderMasksToGpuTexture,
        renderTransitionFallbackCanvas,
        renderItemWithEffects,
      })
      scrubPerfCompositeEndMs = perfMarkIfEnabled(scrubPerfStartMs)
    }

    // Log occlusion culling stats periodically (only in development)
    if (import.meta.env.DEV && skippedTracks > 0 && frame % 30 === 0) {
      getLog().debug(`Occlusion culling: skipped ${skippedTracks} tracks at frame ${frame}`)
    }

    ctx.drawImage(finalCompositeSource, 0, 0)

    // Release content canvas back to pool
    canvasPool.release(contentCanvas)
    cacheRenderedFrame(frame)
    const recordFullFramePerf = (): void => {
      if (scrubPerfStartMs < 0) return
      const scrubPerfEndMs = performance.now()
      recordScrubPerf(frame, 'full', scrubPerfStartMs, {
        planMs: Number((scrubPerfTaskStartMs - scrubPerfStartMs).toFixed(2)),
        taskMs: Number((scrubPerfTaskEndMs - scrubPerfTaskStartMs).toFixed(2)),
        gpuWaitMs: Number((scrubPerfGpuWaitEndMs - scrubPerfTaskEndMs).toFixed(2)),
        compositeMs: Number((scrubPerfCompositeEndMs - scrubPerfGpuWaitEndMs).toFixed(2)),
        finalizeMs: Number((scrubPerfEndMs - scrubPerfCompositeEndMs).toFixed(2)),
        taskCount: renderTasks.length,
        transitionCount: activeTransitions.length,
        slowTasks: scrubSlowTasks.length > 0 ? scrubSlowTasks : undefined,
      })
    }
    recordFullFramePerf()
  }
}
