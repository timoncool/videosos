/**
 * Video item rendering: mediabunny extractor, DOM video fallback, and
 * worker-predecoded bitmap fast path.
 */

import type { VideoItem } from '@/types/timeline'
import {
  getItemRenderTimelineSpan,
  isFrameInsideSourceTimeRamp,
  resolveVideoRenderSourceTimeSeconds,
  type RenderTimelineSpan,
} from '../render-span'
import {
  resolvePreviewDomVideoDrawDecision,
  resolvePreviewMediabunnyInitAction,
  shouldAllowPreviewVideoElementFallback,
  shouldTryPreviewWorkerBitmap,
  shouldUsePreviewStrictWaitingFallback,
  waitForPreviewDomVideoDrawDecision,
} from '../frame-source-policy'
import type { CanvasPool } from '../canvas-pool'
import type { VideoDrawContinuationCheck } from '../canvas-video-extractor'
import type { CanvasSettings, ItemRenderContext, ItemTransform } from './types'
import {
  isFrameInsideItemTimelineSpan,
  log,
  TIER2_VIDEO_FRAME_TOLERANCE_FACTOR,
  WORKER_PRESEEK_WAIT_MS,
} from './shared'
import {
  applyCropFeatherMask,
  calculateContainedMediaDrawLayout,
  clipToViewport,
  drawContainedMediaSource,
  hasCropFeather,
} from './media-draw'
import { isPreviewTraceEnabled, recordRenderTrace } from '@/shared/logging/preview-trace'
import { recordPreviewVideoSource } from '@/shared/logging/preview-scrub-performance'

function getTier2VideoFrameToleranceSeconds(sourceFps: number): number {
  const normalizedSourceFps = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30
  return (1 / normalizedSourceFps) * TIER2_VIDEO_FRAME_TOLERANCE_FACTOR
}

function canUseWorkerPredecodedFrame(
  rctx: ItemRenderContext,
  workerSource: string | null | undefined,
): boolean {
  if (!workerSource) return false
  return rctx.renderMode === 'preview' || rctx.allowPredecodedVideoFrames === true
}

function tryDrawActivePreviewFallback(options: {
  rctx: ItemRenderContext
  previewRootFrame: number
  workerSource: string
  sourceTime: number
  toleranceSeconds: number
  drawBitmap: (bitmap: ImageBitmap) => boolean
  timelineFrame: number
  itemId: string
  allowOutsideActivePreview?: boolean
}): boolean {
  const { rctx, previewRootFrame, workerSource, sourceTime, toleranceSeconds, drawBitmap } = options
  if (!options.allowOutsideActivePreview && !rctx.isActivePreviewFrameCurrent?.(previewRootFrame))
    return false
  const bitmap = rctx.getCachedActivePreviewFallbackBitmap?.(
    workerSource,
    sourceTime,
    toleranceSeconds,
  )
  if (!bitmap || !drawBitmap(bitmap)) return false
  rctx.markActivePreviewFallbackUsed?.()
  recordPreviewVideoSource({
    frame: options.timelineFrame,
    itemId: options.itemId,
    path: 'proxy-fallback',
    sourceTime,
  })
  return true
}

interface WorkerBitmapDrawOptions {
  rctx: ItemRenderContext
  workerSource: string
  sourceTime: number
  toleranceSeconds: number
  drawBitmap: (bitmap: ImageBitmap) => boolean
  timelineFrame: number
  itemId: string
}

function tryDrawCachedWorkerBitmap(options: WorkerBitmapDrawOptions): boolean {
  const bitmap = options.rctx.getCachedPredecodedBitmap?.(
    options.workerSource,
    options.sourceTime,
    options.toleranceSeconds,
  )
  if (!bitmap || !options.drawBitmap(bitmap)) return false
  recordPreviewVideoSource({
    frame: options.timelineFrame,
    itemId: options.itemId,
    path: 'worker-bitmap',
    sourceTime: options.sourceTime,
  })
  return true
}

async function tryDrawInflightWorkerBitmap(
  options: WorkerBitmapDrawOptions & { previewRootFrame: number },
): Promise<boolean> {
  const waitForBitmap = options.rctx.waitForInflightPredecodedBitmap
  if (!waitForBitmap) return false
  const maxWaitMs = options.rctx.isActivePreviewFrameCurrent?.(options.previewRootFrame)
    ? WORKER_PRESEEK_WAIT_MS
    : (options.rctx.workerPredecodeWaitMs ?? WORKER_PRESEEK_WAIT_MS)
  const bitmap = await waitForBitmap(
    options.workerSource,
    options.sourceTime,
    options.toleranceSeconds,
    maxWaitMs,
  )
  if (!bitmap || !options.drawBitmap(bitmap)) return false
  recordPreviewVideoSource({
    frame: options.timelineFrame,
    itemId: options.itemId,
    path: 'worker-bitmap',
    sourceTime: options.sourceTime,
  })
  return true
}

function drawTier2VideoFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ImageBitmap | VideoFrame,
  sourceWidth: number,
  sourceHeight: number,
  transform: ItemTransform,
  canvas: CanvasSettings,
  crop?: VideoItem['crop'],
  canvasPool?: CanvasPool,
): boolean {
  try {
    const maybeVideoFrame = frame as VideoFrame & {
      visibleRect?: { x: number; y: number; width: number; height: number }
    }
    const visibleRect = maybeVideoFrame.visibleRect
    return drawContainedMediaSource(
      ctx,
      frame,
      sourceWidth,
      sourceHeight,
      transform,
      canvas,
      crop,
      visibleRect,
      canvasPool,
    )
  } catch {
    return false
  }
}

async function tryDrawWorkerPredecodedBitmap(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  canvasSettings: CanvasSettings,
  rctx: ItemRenderContext,
  timelineFrame: number,
  sourceTime: number,
  toleranceSeconds: number,
  allowInactiveProxyFallback = false,
): Promise<boolean> {
  const previewRootFrame = rctx.previewRootTimelineFrame ?? timelineFrame
  const workerSource = rctx.getResolvedVideoSource?.(item, sourceTime, toleranceSeconds) ?? item.src
  if (!canUseWorkerPredecodedFrame(rctx, workerSource)) {
    return false
  }

  const drawBitmap = (bitmap: ImageBitmap): boolean => {
    return drawContainedMediaSource(
      ctx,
      bitmap,
      bitmap.width,
      bitmap.height,
      transform,
      canvasSettings,
      item.crop,
      undefined,
      rctx.canvasPool,
    )
  }

  const workerBitmapOptions = {
    rctx,
    workerSource,
    sourceTime,
    toleranceSeconds,
    drawBitmap,
    timelineFrame,
    itemId: item.id,
  }
  if (tryDrawCachedWorkerBitmap(workerBitmapOptions)) return true

  if (
    tryDrawActivePreviewFallback({
      rctx,
      previewRootFrame,
      workerSource,
      sourceTime,
      toleranceSeconds,
      drawBitmap,
      timelineFrame,
      itemId: item.id,
      allowOutsideActivePreview: allowInactiveProxyFallback,
    })
  )
    return true

  return tryDrawInflightWorkerBitmap({ ...workerBitmapOptions, previewRootFrame })
}

type VideoStageResult = boolean | undefined

interface VideoRenderStage {
  ctx: OffscreenCanvasRenderingContext2D
  item: VideoItem
  transform: ItemTransform
  frame: number
  rctx: ItemRenderContext
  sourceFrameOffset: number
  fps: number
  canvasSettings: CanvasSettings
  scrubbingCache: ItemRenderContext['scrubbingCache']
  videoExtractors: ItemRenderContext['videoExtractors']
  videoElements: ItemRenderContext['videoElements']
  useMediabunny: ItemRenderContext['useMediabunny']
  mediabunnyDisabledItems: ItemRenderContext['mediabunnyDisabledItems']
  mediabunnyFailureCountByItem: ItemRenderContext['mediabunnyFailureCountByItem']
  isPreviewMode: boolean
  allowVideoElementFallback: boolean
  hasFallbackVideoElement: boolean
  extractor: ReturnType<ItemRenderContext['videoExtractors']['get']>
  effectiveRenderSpan: RenderTimelineSpan
  sourceFps: number
  speed: number
  sourceTime: number
  tier2ToleranceSeconds: number
  nonBlockingToleranceSeconds: ItemRenderContext['nonBlockingVideoFrameToleranceSeconds']
  previewRootFrame: number
  domVideoCandidate: HTMLVideoElement | null
  domVideo: HTMLVideoElement | null
  canUseDomVideoElement: boolean
  domVideoDecision: ReturnType<typeof resolvePreviewDomVideoDrawDecision>
  hasDomVideo: boolean
  hasActiveRamp: boolean
  mediabunnyInitAction: ReturnType<typeof resolvePreviewMediabunnyInitAction>
  mediabunnyReadyPromise: Promise<boolean> | null
  mediabunnyFailedThisFrame: boolean
  holdPreviewFrontBuffer: () => void
}

function createVideoRenderStage(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number,
  renderSpan: RenderTimelineSpan | undefined,
): VideoRenderStage {
  const {
    fps,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    canvasSettings,
    scrubbingCache,
  } = rctx
  const isPreviewMode = rctx.renderMode === 'preview'
  const allowVideoElementFallback = !isPreviewMode
  const hasFallbackVideoElement = videoElements.has(item.id)
  const extractor = videoExtractors.get(item.id)
  const effectiveRenderSpan = renderSpan ?? getItemRenderTimelineSpan(item)

  const sourceFps = item.sourceFps ?? fps
  const speed = item.speed ?? 1
  const sourceTime = resolveVideoRenderSourceTimeSeconds(
    item,
    effectiveRenderSpan,
    frame,
    fps,
    sourceFrameOffset,
  )
  const tier2ToleranceSeconds = getTier2VideoFrameToleranceSeconds(sourceFps)
  const nonBlockingToleranceSeconds = rctx.nonBlockingVideoFrameToleranceSeconds
  const previewRootFrame = rctx.previewRootTimelineFrame ?? frame
  const holdPreviewFrontBuffer = () => {
    if (isPreviewMode) rctx.markActivePreviewFramePending?.()
  }
  return {
    ctx,
    item,
    transform,
    frame,
    rctx,
    sourceFrameOffset,
    fps,
    canvasSettings,
    scrubbingCache,
    videoExtractors,
    videoElements,
    useMediabunny,
    mediabunnyDisabledItems,
    mediabunnyFailureCountByItem,
    isPreviewMode,
    allowVideoElementFallback,
    hasFallbackVideoElement,
    extractor,
    effectiveRenderSpan,
    sourceFps,
    speed,
    sourceTime,
    tier2ToleranceSeconds,
    nonBlockingToleranceSeconds,
    previewRootFrame,
    domVideoCandidate: null,
    domVideo: null,
    canUseDomVideoElement: false,
    domVideoDecision: resolvePreviewDomVideoDrawDecision({
      domVideo: null,
      sourceTime,
      speed,
      isRenderingTransition: false,
    }),
    hasDomVideo: false,
    hasActiveRamp: false,
    mediabunnyInitAction: 'none',
    mediabunnyReadyPromise: null,
    mediabunnyFailedThisFrame: false,
    holdPreviewFrontBuffer,
  }
}

async function tryWorkerBitmapFastPath(state: VideoRenderStage): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, frame, sourceTime, tier2ToleranceSeconds, canvasSettings } =
    state
  if (!rctx.allowPredecodedVideoFrames) return undefined
  const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
    ctx,
    item,
    transform,
    canvasSettings,
    rctx,
    frame,
    sourceTime,
    tier2ToleranceSeconds,
  )
  if (drewWorkerBitmap) return true
  if (!state.extractor && rctx.ensureVideoItemReady) {
    await rctx.ensureVideoItemReady(item.id, item)
    state.extractor = state.videoExtractors.get(item.id)
  }
  return undefined
}

function abortIfSupersededRoot(state: VideoRenderStage): VideoStageResult {
  if (!state.rctx.isActivePreviewFrameSuperseded?.(state.previewRootFrame)) return undefined
  // A repeated ruler exit can supersede a committed-frame render and then
  // request that same frame again before this render unwinds. Frame-number
  // checks alone can no longer identify this cleared canvas as stale, so
  // explicitly abort its parent render.
  state.holdPreviewFrontBuffer()
  return false
}

async function tryHeldScrubBitmap(state: VideoRenderStage): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, frame, sourceTime, tier2ToleranceSeconds, canvasSettings } =
    state
  if (!state.isPreviewMode || !rctx.isActivePreviewFrameCurrent?.(state.previewRootFrame)) {
    return undefined
  }
  // Held scrubs already have a dedicated exact/fallback bitmap scheduler.
  // Consult it before waiting for a DOM video seek; otherwise the native
  // element can occupy the render pump long enough that the sub-100ms proxy
  // frame is ready but never becomes visible.
  const drewActiveBitmap = await tryDrawWorkerPredecodedBitmap(
    ctx,
    item,
    transform,
    canvasSettings,
    rctx,
    frame,
    sourceTime,
    tier2ToleranceSeconds,
  )
  if (drewActiveBitmap) return true
  return undefined
}

async function tryNonBlockingReversePath(state: VideoRenderStage): Promise<VideoStageResult> {
  const {
    ctx,
    item,
    transform,
    rctx,
    frame,
    sourceTime,
    canvasSettings,
    scrubbingCache,
    nonBlockingToleranceSeconds,
  } = state
  if (!state.isPreviewMode || nonBlockingToleranceSeconds === undefined) return undefined
  // Reverse playback has a decoded-frame runway prepared off-thread. Prefer
  // its nearest display-cadence frame before consulting an asynchronously
  // seeking DOM video. Mixing the two sources makes nested compounds visibly
  // jump when a late browser seek lands between monotonic worker frames.
  const drewNearbyWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
    ctx,
    item,
    transform,
    canvasSettings,
    rctx,
    frame,
    sourceTime,
    nonBlockingToleranceSeconds,
    true,
  )
  if (drewNearbyWorkerBitmap) {
    rctx.markActivePreviewFallbackUsed?.()
    return true
  }

  const extractor = state.extractor
  if (scrubbingCache && extractor) {
    const dims = extractor.getDimensions()
    const cachedEntry = scrubbingCache.getVideoFrameEntry(
      item.id,
      sourceTime,
      nonBlockingToleranceSeconds,
    )
    if (
      cachedEntry &&
      drawTier2VideoFrame(
        ctx,
        cachedEntry.frame,
        dims.width,
        dims.height,
        transform,
        canvasSettings,
        item.crop,
        rctx.canvasPool,
      )
    ) {
      rctx.markActivePreviewFallbackUsed?.()
      return true
    }
  }
  return undefined
}

async function resolveDomVideoDecision(state: VideoRenderStage): Promise<void> {
  const { rctx, item, frame, sourceTime, speed, sourceFps, effectiveRenderSpan } = state
  // During transitions, frame can lie outside item's natural span (the
  // participant's renderSpan is extended to cover the transition zone), and
  // the policy function below is already transition-aware: it returns a wider
  // drift threshold and inspects `data-transition-hold`. Check against
  // effectiveRenderSpan (not the natural item span) and let the policy
  // function decide whether the DOM video is fresh enough, mirroring the GPU
  // transition path in gpu.ts which also passes isRenderingTransition through.
  // A-A transition ramps can use a zero-copy DOM frame only while the preview
  // transition session explicitly owns and synchronizes that element to the
  // same ramped source time as this renderer.
  const hasActiveRamp =
    !!effectiveRenderSpan.sourceTimeRamp &&
    isFrameInsideSourceTimeRamp(effectiveRenderSpan.sourceTimeRamp, frame)
  const domVideoCandidate =
    state.isPreviewMode &&
    rctx.domVideoElementProvider &&
    state.sourceFrameOffset === 0 &&
    isFrameInsideItemTimelineSpan(effectiveRenderSpan, frame)
      ? rctx.domVideoElementProvider(item.id)
      : null
  const domVideo =
    !hasActiveRamp || domVideoCandidate?.dataset.transitionSourceRamp === '1'
      ? domVideoCandidate
      : null
  const domVideoDecisionOptions = {
    domVideo,
    sourceTime,
    speed,
    isRenderingTransition: !!rctx.isRenderingTransition,
    maxDriftSeconds: rctx.isActivePreviewFrameCurrent?.(state.previewRootFrame)
      ? 0.5 / sourceFps
      : undefined,
  }
  let domVideoDecision = resolvePreviewDomVideoDrawDecision(domVideoDecisionOptions)
  if (domVideoDecision.hasReadyDomVideo && !domVideoDecision.shouldDraw) {
    if (state.nonBlockingToleranceSeconds === undefined) {
      domVideoDecision = await waitForPreviewDomVideoDrawDecision(domVideoDecisionOptions)
    } else {
      // Reverse shuttle must not serialize the render pump behind a browser
      // seek. Mark a stale DOM frame unavailable so worker/proxy delivery can
      // continue immediately while the coalesced seek settles.
      domVideoDecision = {
        ...domVideoDecision,
        hasReadyDomVideo: false,
      }
    }
  }
  state.hasActiveRamp = hasActiveRamp
  state.domVideoCandidate = domVideoCandidate
  state.domVideo = domVideo
  state.canUseDomVideoElement = Boolean(domVideoCandidate)
  state.domVideoDecision = domVideoDecision
  state.hasDomVideo = domVideoDecision.hasReadyDomVideo
}

function holdIfRampSettling(state: VideoRenderStage): VideoStageResult {
  if (
    state.isPreviewMode &&
    state.hasActiveRamp &&
    state.domVideoCandidate?.dataset.transitionSourceRamp === '1' &&
    !state.domVideoDecision.shouldDraw
  ) {
    // Let the browser finish the session-owned seek. Falling through to an
    // exact main-thread decode here prevents that seek from settling and turns
    // a one-frame hold into a 250-600ms playback freeze.
    state.holdPreviewFrontBuffer()
    return false
  }
  return undefined
}

function tryDomVideoDraw(state: VideoRenderStage): VideoStageResult {
  const { ctx, item, transform, canvasSettings, rctx, frame, sourceTime } = state
  const { domVideo, domVideoDecision } = state
  if (!domVideo || !domVideoDecision.shouldDraw) return undefined
  recordPreviewVideoSource({ frame, itemId: item.id, path: 'dom-video', sourceTime })
  // Variable-speed clips naturally drift from their DOM video element
  // because the browser plays at 1x while sourceTime advances at speed.
  // Use a wider threshold proportional to speed to avoid falling back
  // to mediabunny decode (which causes 50-500ms freezes on first decode).
  // For variable-speed clips, use a very wide threshold to avoid EVER
  // falling through to mediabunny (400ms+ keyframe seek). DOM video drift
  // is visually acceptable; mediabunny stalls are not.
  //
  // During transitions (entry ramp-up and exit handoff), the DOM video
  // element may be settling — play() was just called, Chrome's decoder
  // is ramping up.  Accept very high drift (1s) to prefer a stale
  // zero-copy frame (~1ms) over a mediabunny decode (~170ms stall).
  // A 1-2 frame-old frame is invisible; a 170ms freeze is not.
  drawContainedMediaSource(
    ctx,
    domVideo,
    domVideo.videoWidth,
    domVideo.videoHeight,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
  // For variable-speed clips using DOM fallback during playback,
  // DON'T kick off mediabunny init — keep using DOM video for the
  // entire playback session. Mediabunny init + keyframe seek takes
  // 400-500ms on the main thread, causing visible frame drops.
  // DOM video has slight timing drift at speed != 1, but no freezes.
  return true
}

async function startMediabunnyInit(state: VideoRenderStage): Promise<VideoStageResult> {
  const { rctx, item, speed } = state
  const mediabunnyInitAction = resolvePreviewMediabunnyInitAction({
    renderMode: rctx.renderMode,
    hasMediabunny: state.useMediabunny.has(item.id),
    isMediabunnyDisabled: state.mediabunnyDisabledItems.has(item.id),
    hasEnsureVideoItemReady: !!rctx.ensureVideoItemReady,
    speed,
  })
  state.mediabunnyInitAction = mediabunnyInitAction
  if (mediabunnyInitAction === 'none' || !rctx.ensureVideoItemReady) return undefined
  // For variable-speed clips during playback, don't block on mediabunny init.
  // The init triggers a keyframe seek that blocks the main thread for 400ms+.
  // Instead, skip this frame (DOM video already drew it or it's invisible).
  const mediabunnyReadyPromise = rctx.ensureVideoItemReady(item.id)
  state.mediabunnyReadyPromise = mediabunnyReadyPromise
  if (mediabunnyInitAction === 'warm-background-and-skip') {
    void mediabunnyReadyPromise
    state.holdPreviewFrontBuffer()
    return false
  }
  // A cold main-thread MediaBunny init can take hundreds of milliseconds.
  // Continue through worker bitmap and cached-frame fallbacks while it warms.
  return undefined
}

/**
 * Render video item using mediabunny (fast) or HTML5 video element (fallback).
 */
export async function renderVideoItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: VideoItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number = 0,
  renderSpan?: RenderTimelineSpan,
): Promise<boolean> {
  const state = createVideoRenderStage(
    ctx,
    item,
    transform,
    frame,
    rctx,
    sourceFrameOffset,
    renderSpan,
  )
  const fastPath = await tryWorkerBitmapFastPath(state)
  if (fastPath !== undefined) return fastPath
  const superseded = abortIfSupersededRoot(state)
  if (superseded !== undefined) return superseded
  const heldScrub = await tryHeldScrubBitmap(state)
  if (heldScrub !== undefined) return heldScrub
  const reversePath = await tryNonBlockingReversePath(state)
  if (reversePath !== undefined) return reversePath
  await resolveDomVideoDecision(state)
  const rampHold = holdIfRampSettling(state)
  if (rampHold !== undefined) return rampHold
  // DEV diagnostics: record which transition participants the renderer actually
  // composites per frame. Tree-shaken from prod; no-op unless a trace is running.
  if (import.meta.env.DEV && rctx.isRenderingTransition && isPreviewTraceEnabled()) {
    recordRenderTrace({
      f: frame,
      id: item.id.slice(0, 8),
      rev: item.isReversed === true,
      src: Math.round(state.sourceTime * 100) / 100,
      hasDom: !!state.domVideo,
      useMb: state.useMediabunny.has(item.id),
    })
  }
  const domDraw = tryDomVideoDraw(state)
  if (domDraw !== undefined) return domDraw
  const initGate = await startMediabunnyInit(state)
  if (initGate !== undefined) return initGate

  // Preview fast-scrub runs in strict decode mode (no HTML video fallbacks).
  // During startup/resolution races, mediabunny may not be ready for this frame yet.
  // In that window, skip drawing this item for the frame instead of logging a
  // misleading "Video element not found" warning.
  const strictGate = await tryStrictWaitingFallback(state)
  if (strictGate !== undefined) return strictGate

  // Prefer a worker-decoded exact frame before a cold main-thread extractor draw.
  // This keeps large-jump and transition-entry stalls off the main thread while
  // preserving the same exact-frame preview path once the extractor is warm.
  const predecodedGate = await tryWorkerBitmapBeforeExtractor(state)
  if (predecodedGate !== undefined) return predecodedGate
  const workerHold = holdIfPreviewWorkerActive(state)
  if (workerHold !== undefined) return workerHold

  // With the overlap model, source times are always valid during transitions
  // (both clips have real content in the overlap region), so no past-duration
  // workaround is needed.
  const mediabunnyGate = await tryMediabunnyDraw(state)
  if (mediabunnyGate !== undefined) return mediabunnyGate
  if (state.rctx.isActivePreviewFrameSuperseded?.(state.previewRootFrame) === true) {
    // The pointer moved while the exact decode was in flight (or missed): the
    // frame is dead, so skip the fallback DOM seek for it. Mirrors the
    // supersede holds above; stale-frame presentation guards stay authoritative.
    state.holdPreviewFrontBuffer()
    return false
  }

  // HTML5 video element fallback (slower, seeks required).
  return drawHtmlVideoFallback(state)
}

async function seekHtmlVideoElement(
  video: HTMLVideoElement,
  clampedTime: number,
  isPreviewMode: boolean,
  seekTimeoutMs: number,
): Promise<void> {
  const seekTolerance = isPreviewMode ? 0.05 : 0.034
  if (Math.abs(video.currentTime - clampedTime) <= seekTolerance) return
  video.currentTime = clampedTime
  if (isPreviewMode) return
  await new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }, seekTimeoutMs)
  })
}

async function waitForHtmlVideoReady(
  video: HTMLVideoElement,
  readyTimeoutMs: number,
): Promise<void> {
  if (video.readyState >= 2) return
  await new Promise<void>((resolve) => {
    const checkReady = () => {
      if (video.readyState >= 2) {
        video.removeEventListener('canplay', checkReady)
        video.removeEventListener('loadeddata', checkReady)
        resolve()
      }
    }
    video.addEventListener('canplay', checkReady)
    video.addEventListener('loadeddata', checkReady)
    checkReady()
    setTimeout(() => {
      video.removeEventListener('canplay', checkReady)
      video.removeEventListener('loadeddata', checkReady)
      resolve()
    }, readyTimeoutMs)
  })
}

async function drawHtmlVideoFallback(state: VideoRenderStage): Promise<boolean> {
  const { ctx, item, transform, frame, rctx, canvasSettings, sourceTime } = state
  const allowPreviewFallback = shouldAllowPreviewVideoElementFallback({
    renderMode: rctx.renderMode,
    hasFallbackVideoElement: state.hasFallbackVideoElement,
    hasMediabunny: state.useMediabunny.has(item.id),
    isMediabunnyDisabled: state.mediabunnyDisabledItems.has(item.id),
    mediabunnyFailedThisFrame: state.mediabunnyFailedThisFrame,
  })
  if (!state.allowVideoElementFallback && !allowPreviewFallback) {
    state.holdPreviewFrontBuffer()
    return false
  }

  const video = state.videoElements.get(item.id)
  if (!video) {
    log.warn('Video element not found', { itemId: item.id, frame })
    state.holdPreviewFrontBuffer()
    return false
  }

  const clampedTime = Math.max(0, Math.min(sourceTime, video.duration - 0.01))
  const seekTimeout = state.isPreviewMode ? 24 : 150
  const readyTimeout = state.isPreviewMode ? 40 : 300
  await seekHtmlVideoElement(video, clampedTime, state.isPreviewMode, seekTimeout)

  // Wait for video to have enough data to draw
  if (video.readyState < 2 && state.isPreviewMode) {
    state.holdPreviewFrontBuffer()
    return false
  }
  await waitForHtmlVideoReady(video, readyTimeout)

  if (video.readyState < 2) {
    if (import.meta.env.DEV && frame < 5)
      log.warn(`Video not ready after waiting: frame=${frame} readyState=${video.readyState}`)
    return false
  }

  if (import.meta.env.DEV && (frame < 5 || frame % 30 === 0)) {
    log.debug(
      `VIDEO DRAW (fallback) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s readyState=${video.readyState}`,
    )
  }

  drawContainedMediaSource(
    ctx,
    video,
    video.videoWidth,
    video.videoHeight,
    transform,
    canvasSettings,
    item.crop,
    undefined,
    rctx.canvasPool,
  )
  return true
}

async function tryStrictScrubCache(state: VideoRenderStage): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, canvasSettings, scrubbingCache } = state
  const extractor = state.extractor
  if (!scrubbingCache || !extractor) return undefined
  const dims = extractor.getDimensions()
  const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
  if (
    cachedEntry &&
    drawTier2VideoFrame(
      ctx,
      cachedEntry.frame,
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
      rctx.canvasPool,
    )
  ) {
    return true
  }
  return undefined
}

async function tryStrictWorkerBitmap(state: VideoRenderStage): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, frame, sourceTime, canvasSettings, tier2ToleranceSeconds } =
    state
  if (
    !shouldTryPreviewWorkerBitmap({
      renderMode: rctx.renderMode,
      hasReadyDomVideo: state.hasDomVideo,
      allowPredecodedVideoFrames: rctx.allowPredecodedVideoFrames,
    })
  ) {
    return undefined
  }
  const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
    ctx,
    item,
    transform,
    canvasSettings,
    rctx,
    frame,
    sourceTime,
    tier2ToleranceSeconds,
  )
  if (!drewWorkerBitmap) return undefined
  if (rctx.ensureVideoItemReady && !state.mediabunnyReadyPromise) {
    void rctx.ensureVideoItemReady(item.id)
  }
  return true
}

async function tryWarmBackgroundRetry(state: VideoRenderStage): Promise<VideoStageResult> {
  const { ctx, item, transform, frame, rctx, sourceFrameOffset } = state
  if (
    state.mediabunnyInitAction !== 'warm-background-and-continue' ||
    !state.mediabunnyReadyPromise ||
    !state.extractor
  ) {
    return undefined
  }
  let ready = false
  try {
    ready = await state.mediabunnyReadyPromise
  } catch {
    // Best effort in preview; a failed initializer leaves this frame undrawn.
  }
  if (!ready || !state.useMediabunny.has(item.id) || state.mediabunnyDisabledItems.has(item.id)) {
    return undefined
  }
  // Cached and worker-backed paths stay non-blocking. Only retry after every
  // fallback missed, where returning now would otherwise expose a blank frame.
  return renderVideoItem(
    ctx,
    item,
    transform,
    frame,
    rctx,
    sourceFrameOffset,
    state.effectiveRenderSpan,
  )
}

function holdIfStrictFramePending(state: VideoRenderStage): VideoStageResult {
  const { rctx, item, sourceTime, tier2ToleranceSeconds, domVideo } = state
  const pendingWorkerSource =
    rctx.getResolvedVideoSource?.(item, sourceTime, tier2ToleranceSeconds) ?? item.src
  if (domVideo) {
    // A nested/compound DOM video can briefly fall below drawable readiness
    // while rapid Play/Pause seeks it. This happens on both pause and resume;
    // the element is still the authoritative source, so committing the
    // freshly-cleared composition canvas would replace the front buffer with black.
    state.holdPreviewFrontBuffer()
    return false
  }
  const isPendingOrSupersededSource =
    pendingWorkerSource &&
    (rctx.isActivePreviewSourceTarget?.(pendingWorkerSource, sourceTime, tier2ToleranceSeconds) ||
      rctx.isActivePreviewTargetSuperseded?.(
        pendingWorkerSource,
        sourceTime,
        tier2ToleranceSeconds,
      ))
  if (rctx.isActivePreviewFrameCurrent?.(state.previewRootFrame) || isPendingOrSupersededSource) {
    // Direction changes can cancel the old source request before the new
    // one is registered. The root frame is still active, so returning it as
    // complete would commit a partially rendered (usually black) canvas.
    state.holdPreviewFrontBuffer()
  }
  return false
}

async function tryStrictWaitingFallback(state: VideoRenderStage): Promise<VideoStageResult> {
  if (
    !shouldUsePreviewStrictWaitingFallback({
      renderMode: state.rctx.renderMode,
      hasMediabunny: state.useMediabunny.has(state.item.id),
      hasFallbackVideoElement: state.hasFallbackVideoElement,
    })
  ) {
    return undefined
  }
  const scrubCache = await tryStrictScrubCache(state)
  if (scrubCache !== undefined) return scrubCache
  const workerBitmap = await tryStrictWorkerBitmap(state)
  if (workerBitmap !== undefined) return workerBitmap
  const retry = await tryWarmBackgroundRetry(state)
  if (retry !== undefined) return retry
  return holdIfStrictFramePending(state)
}

async function tryWorkerBitmapBeforeExtractor(state: VideoRenderStage): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, frame, sourceTime, canvasSettings, tier2ToleranceSeconds } =
    state
  if (
    !shouldTryPreviewWorkerBitmap({
      renderMode: rctx.renderMode,
      hasReadyDomVideo: state.hasDomVideo,
      allowPredecodedVideoFrames: rctx.allowPredecodedVideoFrames,
    })
  ) {
    return undefined
  }
  const drewWorkerBitmap = await tryDrawWorkerPredecodedBitmap(
    ctx,
    item,
    transform,
    canvasSettings,
    rctx,
    frame,
    sourceTime,
    tier2ToleranceSeconds,
  )
  if (!drewWorkerBitmap) return undefined
  if (!state.useMediabunny.has(item.id) && rctx.ensureVideoItemReady) {
    void rctx.ensureVideoItemReady(item.id)
  }
  return true
}

function holdIfPreviewWorkerActive(state: VideoRenderStage): VideoStageResult {
  const { rctx, item, sourceTime, tier2ToleranceSeconds } = state
  if (state.isPreviewMode && state.nonBlockingToleranceSeconds !== undefined) {
    // The display keeps its last valid pixels while the cancellable worker
    // lane decodes the newest reverse target. Never fall through to a
    // main-thread MediaBunny seek for this transient transport mode.
    state.holdPreviewFrontBuffer()
    return false
  }

  const resolvedWorkerSource =
    rctx.getResolvedVideoSource?.(item, sourceTime, tier2ToleranceSeconds) ?? item.src
  const rootFrameSuperseded = rctx.isActivePreviewFrameSuperseded?.(state.previewRootFrame) === true
  const sourceTargetSuperseded = Boolean(
    resolvedWorkerSource &&
    rctx.isActivePreviewTargetSuperseded?.(resolvedWorkerSource, sourceTime, tier2ToleranceSeconds),
  )
  if (rootFrameSuperseded || sourceTargetSuperseded) {
    // The pointer has already moved and the active worker cancelled this exact
    // frame. Do not replace that cancellation with a blocking main-thread
    // MediaBunny seek; the render pump will immediately pick up the latest
    // target and stale-frame presentation guards keep this canvas hidden.
    state.holdPreviewFrontBuffer()
    return false
  }

  if (rctx.isActivePreviewFrameCurrent?.(state.previewRootFrame)) {
    // Keep the last valid preview visible while the isolated worker finishes
    // this exact target. The worker-ready subscription wakes the render pump;
    // avoiding MediaBunny here keeps pointer input and cancellation responsive.
    rctx.markActivePreviewFramePending?.()
    return false
  }
  return undefined
}

async function tryMediabunnyScrubCache(
  state: VideoRenderStage,
  dims: { width: number; height: number },
  clampedTime: number,
): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, canvasSettings, scrubbingCache, tier2ToleranceSeconds } =
    state
  if (!state.isPreviewMode || !scrubbingCache) return undefined
  const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id, clampedTime, tier2ToleranceSeconds)
  if (
    cachedEntry &&
    drawTier2VideoFrame(
      ctx,
      cachedEntry.frame,
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
      rctx.canvasPool,
    )
  ) {
    return true
  }
  return undefined
}

async function tryReverseFrameCache(
  state: VideoRenderStage,
  extractor: NonNullable<VideoRenderStage['extractor']>,
  dims: { width: number; height: number },
): Promise<VideoStageResult> {
  const { ctx, item, transform, frame, rctx, canvasSettings } = state
  if (
    rctx.renderMode !== 'export' ||
    !item.isReversed ||
    state.sourceFrameOffset !== 0 ||
    !rctx.reverseVideoFrameCache
  ) {
    return undefined
  }
  const cachedReverseFrame = await rctx.reverseVideoFrameCache.getFrame({
    item,
    extractor,
    frame,
    renderSpan: state.effectiveRenderSpan,
    fps: state.fps,
    sourceFps: state.sourceFps,
    speed: state.speed,
  })
  if (
    cachedReverseFrame &&
    drawTier2VideoFrame(
      ctx,
      cachedReverseFrame,
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
      rctx.canvasPool,
    )
  ) {
    state.mediabunnyFailureCountByItem.set(item.id, 0)
    return true
  }
  return undefined
}

interface DrawnExtractorFrame {
  success: boolean
  capturedFrame: ImageBitmap | VideoFrame | null
  capturedSourceTime: number | null
}

type ContainedMediaDrawLayout = ReturnType<typeof calculateContainedMediaDrawLayout>

async function drawMediabunnyExtractorFrame(
  state: VideoRenderStage,
  extractor: NonNullable<VideoRenderStage['extractor']>,
  clampedTime: number,
  drawLayout: ContainedMediaDrawLayout,
  shouldContinue?: VideoDrawContinuationCheck,
): Promise<DrawnExtractorFrame> {
  const { ctx, rctx, scrubbingCache } = state
  const { mediaRect, viewportRect, featherPixels } = drawLayout
  const drawExtractorFrame = async (
    targetCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  ) =>
    state.isPreviewMode && scrubbingCache && rctx.captureDecodedVideoFrames !== false
      ? await extractor.drawFrameWithCapture(
          targetCtx,
          clampedTime,
          mediaRect.x,
          mediaRect.y,
          mediaRect.width,
          mediaRect.height,
          shouldContinue,
        )
      : {
          success: await extractor.drawFrame(
            targetCtx,
            clampedTime,
            mediaRect.x,
            mediaRect.y,
            mediaRect.width,
            mediaRect.height,
            shouldContinue,
          ),
          capturedFrame: null,
          capturedSourceTime: null,
        }

  if (hasCropFeather(featherPixels)) {
    const { canvas: scratchCanvas, ctx: scratchCtx } = rctx.canvasPool.acquire()
    try {
      scratchCtx.save()
      clipToViewport(scratchCtx, viewportRect)
      let result: DrawnExtractorFrame
      try {
        result = await drawExtractorFrame(scratchCtx)
      } finally {
        scratchCtx.restore()
      }

      if (result.success) {
        applyCropFeatherMask(scratchCtx, viewportRect, featherPixels)
        ctx.drawImage(scratchCanvas, 0, 0)
      }
      return result
    } finally {
      rctx.canvasPool.release(scratchCanvas)
    }
  }
  ctx.save()
  clipToViewport(ctx, viewportRect)
  try {
    return await drawExtractorFrame(ctx)
  } finally {
    ctx.restore()
  }
}

function recordMediabunnySuccess(
  state: VideoRenderStage,
  clampedTime: number,
  capturedFrame: ImageBitmap | VideoFrame | null,
  capturedSourceTime: number | null,
): void {
  const { frame, item, scrubbingCache } = state
  recordPreviewVideoSource({
    frame,
    itemId: item.id,
    path: 'mediabunny',
    sourceTime: clampedTime,
    canUseDom: state.canUseDomVideoElement,
    domAvailable: Boolean(state.domVideo),
    domReady: state.domVideoDecision.hasReadyDomVideo,
    domDrift: state.domVideoDecision.drift,
  })
  state.mediabunnyFailureCountByItem.set(item.id, 0)
  if (scrubbingCache && capturedFrame) {
    scrubbingCache.putVideoFrame(item.id, capturedFrame, capturedSourceTime ?? clampedTime)
  }
}

function handleMediabunnyFailure(
  state: VideoRenderStage,
  extractor: NonNullable<VideoRenderStage['extractor']>,
  clampedTime: number,
): void {
  const { frame, item } = state
  // Distinguish transient misses from decode failures.
  const failureKind = extractor.getLastFailureKind()
  if (failureKind === 'no-sample') {
    log.debug('Mediabunny had no sample for timestamp, using per-frame fallback', {
      itemId: item.id,
      frame,
      sourceTime: clampedTime,
    })
    return
  }
  const failureCount = (state.mediabunnyFailureCountByItem.get(item.id) ?? 0) + 1
  state.mediabunnyFailureCountByItem.set(item.id, failureCount)

  if (failureCount >= 3) {
    state.mediabunnyDisabledItems.add(item.id)
    const logDisable = state.isPreviewMode ? log.debug : log.warn
    logDisable(
      'Disabling mediabunny for item after repeated failures; using fallback for remainder of render',
      {
        itemId: item.id,
        frame,
        sourceTime: clampedTime,
        failureCount,
      },
    )
  } else {
    const logDrawFailure = state.isPreviewMode ? log.debug : log.warn
    logDrawFailure('Mediabunny frame draw failed, using fallback', {
      itemId: item.id,
      frame,
      sourceTime: clampedTime,
      failureCount,
    })
  }
}

async function tryMediabunnyNoSampleCache(
  state: VideoRenderStage,
  extractor: NonNullable<VideoRenderStage['extractor']>,
  dims: { width: number; height: number },
): Promise<VideoStageResult> {
  const { ctx, item, transform, rctx, canvasSettings, scrubbingCache } = state
  if (!state.isPreviewMode || !scrubbingCache || extractor.getLastFailureKind() !== 'no-sample') {
    return undefined
  }
  const cachedEntry = scrubbingCache.getVideoFrameEntry(item.id)
  if (
    cachedEntry &&
    drawTier2VideoFrame(
      ctx,
      cachedEntry.frame,
      dims.width,
      dims.height,
      transform,
      canvasSettings,
      item.crop,
      rctx.canvasPool,
    )
  ) {
    return true
  }
  return undefined
}

async function tryMediabunnyDraw(state: VideoRenderStage): Promise<VideoStageResult> {
  const { item, transform, frame, canvasSettings, sourceTime } = state
  const extractor = state.extractor
  if (
    !state.useMediabunny.has(item.id) ||
    state.mediabunnyDisabledItems.has(item.id) ||
    !extractor
  ) {
    return undefined
  }
  const clampedTime = Math.max(0, Math.min(sourceTime, extractor.getDuration() - 0.01))
  const dims = extractor.getDimensions()
  const drawLayout = calculateContainedMediaDrawLayout(
    dims.width,
    dims.height,
    transform,
    canvasSettings,
    item.crop,
  )

  const scrubCache = await tryMediabunnyScrubCache(state, dims, clampedTime)
  if (scrubCache !== undefined) return scrubCache

  if (import.meta.env.DEV && (frame < 5 || frame % 60 === 0)) {
    log.debug(`VIDEO DRAW (mediabunny) frame=${frame} sourceTime=${clampedTime.toFixed(2)}s`)
  }

  const reverseCache = await tryReverseFrameCache(state, extractor, dims)
  if (reverseCache !== undefined) return reverseCache

  // Abort the blocking main-thread seek when the pointer has already moved
  // on: the frame is dead and the render pump has a newer target. The
  // extractor resolves the abort as a plain miss with no failure bookkeeping.
  const shouldContinueDecoding = () =>
    state.rctx.isActivePreviewFrameSuperseded?.(state.previewRootFrame) !== true
  const drawn = await drawMediabunnyExtractorFrame(
    state,
    extractor,
    clampedTime,
    drawLayout,
    shouldContinueDecoding,
  )

  if (drawn.success) {
    recordMediabunnySuccess(state, clampedTime, drawn.capturedFrame, drawn.capturedSourceTime)
    return true
  }
  state.mediabunnyFailedThisFrame = true

  const noSampleCache = await tryMediabunnyNoSampleCache(state, extractor, dims)
  if (noSampleCache !== undefined) return noSampleCache
  handleMediabunnyFailure(state, extractor, clampedTime)
  return undefined
}

export function resolveVideoParticipantSourceTime(
  item: VideoItem,
  renderSpan: RenderTimelineSpan,
  frame: number,
  rctx: ItemRenderContext,
): number {
  return resolveVideoRenderSourceTimeSeconds(item, renderSpan, frame, rctx.fps)
}
