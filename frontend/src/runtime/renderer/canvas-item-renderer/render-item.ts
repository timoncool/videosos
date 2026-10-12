/**
 * Top-level item dispatcher: resolves animated state, applies corner pin /
 * corner radius / opacity transforms, then delegates to the type-specific
 * renderer (video, image, text, subtitle, shape, composition).
 */

import type {
  CompositionItem,
  ImageItem,
  LottieItem,
  ShapeItem,
  SubtitleSegmentItem,
  TextItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import {
  applyPreviewPathVerticesToItem,
  computeProjectiveCornerPinWarp,
  drawCornerPinImage,
  expandTextTransformToFitContent,
  hasCornerPin,
  resolveCornerPinForSize,
  resolveCornerPinTargetRect,
} from '@/runtime/renderer/deps/composition-runtime-contract'
import { resolveAnimatedShapeItem, resolveAnimatedTextItem } from '@/runtime/renderer/deps/keyframes-contract'
import type { EffectSourceMask } from '../canvas-effects'
import { applyMasks } from '../canvas-masks'
import { renderShape } from '../canvas-shapes'
import type { RenderTimelineSpan } from '../render-span'
import type { ItemRenderContext, ItemTransform } from './types'
import {
  applyAnimatedCropToItem,
  applyItemTransformToContext,
  resolveItemTransform,
} from './shared'
import { renderVideoItem } from './video'
import { renderImageItem } from './image'
import { renderLottieItem } from './lottie'
import { getTextRasterCacheKey, renderSubtitleSegmentItem, renderTextItem } from './text'
import { isTextMotionActive } from '@/shared/typography/text-motion'
import { renderCompositionItem } from './composition'
import type { CornerPinWarpCacheEntry } from './types'
import {
  getLogicalCanvasSize,
  scaleShapeItemForCanvas,
  scaleSubtitleItemForCanvas,
  scaleTextItemForCanvas,
} from '../canvas-render-scale'

/** Total RAM budget for the preview corner-pin warp cache. */
const CORNER_PIN_WARP_CACHE_MAX_BYTES = 256_000_000 // ~256MB

function pruneCornerPinWarpCache(cache: Map<string, CornerPinWarpCacheEntry>): void {
  let total = 0
  for (const entry of cache.values()) total += entry.bytes
  for (const [key, entry] of cache) {
    if (total <= CORNER_PIN_WARP_CACHE_MAX_BYTES || cache.size <= 1) break
    cache.delete(key)
    total -= entry.bytes
  }
}

/**
 * Render a single timeline item to the given canvas context.
 *
 * @param sourceFrameOffset – optional frame-level offset added to the video
 *   source timestamp (used by transitions that need to render a clip at an
 *   offset position).
 */
export async function renderItem(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number = 0,
  renderSpan?: RenderTimelineSpan,
  preCornerPinMasks: EffectSourceMask[] = [],
): Promise<void> {
  const itemKeyframes = rctx.getCurrentKeyframes?.(item.id) ?? rctx.keyframesMap.get(item.id)
  const logicalCanvasSettings = getLogicalCanvasSize(rctx.canvasSettings)
  const shapeExpressionContext =
    rctx.canvasSettings.getExpressionItem && rctx.canvasSettings.getExpressionKeyframes
      ? {
          globalFrame: frame,
          canvas: logicalCanvasSettings,
          getItem: rctx.canvasSettings.getExpressionItem,
          getKeyframes: rctx.canvasSettings.getExpressionKeyframes,
        }
      : undefined
  const animatedTextItem =
    item.type === 'text'
      ? scaleTextItemForCanvas(
          {
            ...resolveAnimatedTextItem(
              item,
              itemKeyframes,
              frame - item.from,
              logicalCanvasSettings,
            ),
            cornerPin: item.cornerPin,
          },
          rctx.canvasSettings,
        )
      : item.type === 'shape'
        ? scaleShapeItemForCanvas(
            resolveAnimatedShapeItem(
              item,
              itemKeyframes,
              frame - item.from,
              shapeExpressionContext,
            ),
            rctx.canvasSettings,
          )
        : item.type === 'subtitle'
          ? scaleSubtitleItemForCanvas(item, rctx.canvasSettings)
          : item
  const frameResolvedItem = applyAnimatedCropToItem(animatedTextItem, frame, rctx, renderSpan)
  const resolvedTransform = resolveItemTransform(transform)
  const frameResolvedTransform =
    frameResolvedItem.type === 'text' && !hasCornerPin(frameResolvedItem.cornerPin)
      ? expandTextTransformToFitContent(frameResolvedItem, resolvedTransform)
      : resolvedTransform

  // Corner pin: render to temp canvas, then warp onto main canvas
  if (hasCornerPin(frameResolvedItem.cornerPin)) {
    await renderItemWithCornerPin(
      ctx,
      frameResolvedItem,
      frameResolvedTransform,
      frame,
      rctx,
      sourceFrameOffset,
      renderSpan,
      preCornerPinMasks,
    )
    return
  }

  ctx.save()

  // Apply opacity only if it's not the default value (1.0)
  if (frameResolvedTransform.opacity !== 1) {
    ctx.globalAlpha = frameResolvedTransform.opacity
  }

  applyItemTransformToContext(ctx, frameResolvedItem, frameResolvedTransform, rctx.canvasSettings)

  // Apply corner radius clipping
  if (frameResolvedTransform.cornerRadius > 0) {
    const left =
      rctx.canvasSettings.width / 2 + frameResolvedTransform.x - frameResolvedTransform.width / 2
    const top =
      rctx.canvasSettings.height / 2 + frameResolvedTransform.y - frameResolvedTransform.height / 2
    ctx.beginPath()
    ctx.roundRect(
      left,
      top,
      frameResolvedTransform.width,
      frameResolvedTransform.height,
      frameResolvedTransform.cornerRadius,
    )
    ctx.clip()
  }

  await renderItemContent(
    ctx,
    frameResolvedItem,
    frameResolvedTransform,
    frame,
    rctx,
    sourceFrameOffset,
    renderSpan,
  )

  ctx.restore()
}

/**
 * Render item content (dispatches to type-specific renderers).
 */
async function renderItemContent(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number,
  renderSpan?: RenderTimelineSpan,
): Promise<void> {
  const effectiveItem =
    rctx.renderMode === 'preview'
      ? applyPreviewPathVerticesToItem(item, rctx.getPreviewPathVerticesOverride)
      : item

  switch (effectiveItem.type) {
    case 'video': {
      const videoFrameDrawn = await renderVideoItem(
        ctx,
        effectiveItem as VideoItem,
        transform,
        frame,
        rctx,
        sourceFrameOffset,
        renderSpan,
      )
      if (!videoFrameDrawn) {
        // Preview canvases are cleared before item rendering. A video item is
        // complete only after one of its real frame sources was drawn; every
        // other outcome must preserve the previous front buffer.
        if (rctx.renderMode === 'preview') rctx.markActivePreviewFramePending?.()
      }
      break
    }
    case 'image':
      await rctx.ensureImageItemReady?.(effectiveItem as ImageItem)
      renderImageItem(ctx, effectiveItem as ImageItem, transform, rctx, frame)
      break
    case 'lottie':
      await rctx.ensureLottieItemReady?.(effectiveItem as LottieItem)
      renderLottieItem(ctx, effectiveItem as LottieItem, transform, rctx, frame)
      break
    case 'text': {
      const textItem = effectiveItem as TextItem
      // Motion text: while a per-unit window is active, paint glyph-by-glyph
      // (bypasses the raster cache). Settled frames pass no motion → cached path.
      const relativeFrame = frame - textItem.from
      const motion =
        textItem.textMotion &&
        isTextMotionActive(
          textItem.textMotion,
          relativeFrame,
          rctx.canvasSettings.fps,
          textItem.durationInFrames,
        )
          ? {
              relativeFrame,
              fps: rctx.canvasSettings.fps,
              durationInFrames: textItem.durationInFrames,
            }
          : undefined
      renderTextItem(ctx, textItem, transform, rctx, motion)
      break
    }
    case 'subtitle':
      renderSubtitleSegmentItem(ctx, effectiveItem as SubtitleSegmentItem, transform, frame, rctx)
      break
    case 'shape':
      renderShape(
        ctx,
        effectiveItem as ShapeItem,
        {
          ...resolveItemTransform(transform),
          // The item renderer already rotated the canvas context above. Keep the
          // standalone renderShape rotation contract without applying it twice here.
          rotation: 0,
        },
        {
          width: rctx.canvasSettings.width,
          height: rctx.canvasSettings.height,
        },
      )
      break
    case 'composition':
      await renderCompositionItem(
        ctx,
        effectiveItem as CompositionItem,
        transform,
        frame,
        rctx,
        renderSpan,
      )
      break
  }
}

/**
 * Render an item with corner pin perspective warp.
 * Renders to a temporary canvas at item dimensions, then warps onto the main canvas.
 */
async function renderItemWithCornerPin(
  ctx: OffscreenCanvasRenderingContext2D,
  item: TimelineItem,
  transform: ItemTransform,
  frame: number,
  rctx: ItemRenderContext,
  sourceFrameOffset: number,
  renderSpan?: RenderTimelineSpan,
  preCornerPinMasks: EffectSourceMask[] = [],
): Promise<void> {
  const itemW = Math.ceil(transform.width)
  const itemH = Math.ceil(transform.height)
  if (itemW <= 0 || itemH <= 0) return

  // Render item content to a temp canvas at item dimensions
  const tempCanvas = new OffscreenCanvas(itemW, itemH)
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) return

  // Create a centered transform for the temp canvas
  const tempTransform: ItemTransform = {
    ...transform,
    x: 0,
    y: 0,
  }
  const tempRctx: ItemRenderContext = {
    ...rctx,
    canvasSettings: { width: itemW, height: itemH, fps: rctx.canvasSettings.fps },
  }

  if (preCornerPinMasks.length > 0) {
    const maskedSourceCanvas = new OffscreenCanvas(
      rctx.canvasSettings.width,
      rctx.canvasSettings.height,
    )
    const maskedSourceCtx = maskedSourceCanvas.getContext('2d')
    if (!maskedSourceCtx) return

    await renderItemContent(
      maskedSourceCtx,
      item,
      transform,
      frame,
      rctx,
      sourceFrameOffset,
      renderSpan,
    )

    const maskedCanvas = new OffscreenCanvas(rctx.canvasSettings.width, rctx.canvasSettings.height)
    const maskedCtx = maskedCanvas.getContext('2d')
    if (!maskedCtx) return

    applyMasks(maskedCtx, maskedSourceCanvas, preCornerPinMasks, rctx.canvasSettings)

    const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2
    const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2
    tempCtx.drawImage(maskedCanvas, left, top, itemW, itemH, 0, 0, itemW, itemH)
  } else {
    // Render content to temp canvas
    await renderItemContent(
      tempCtx,
      item,
      tempTransform,
      frame,
      tempRctx,
      sourceFrameOffset,
      renderSpan,
    )
  }

  // Apply corner radius clipping on temp canvas if needed
  if (transform.cornerRadius > 0) {
    tempCtx.save()
    tempCtx.globalCompositeOperation = 'destination-in'
    tempCtx.beginPath()
    tempCtx.roundRect(0, 0, itemW, itemH, transform.cornerRadius)
    tempCtx.fill()
    tempCtx.restore()
  }

  // Draw warped image onto main canvas
  const left = rctx.canvasSettings.width / 2 + transform.x - transform.width / 2
  const top = rctx.canvasSettings.height / 2 + transform.y - transform.height / 2
  const needsFlattenedOpacity = transform.opacity !== 1
  const cornerPinTargetRect = resolveCornerPinTargetRect(
    itemW,
    itemH,
    item.type === 'video' || item.type === 'image' || item.type === 'composition'
      ? {
          sourceWidth: item.type === 'composition' ? item.compositionWidth : item.sourceWidth,
          sourceHeight: item.type === 'composition' ? item.compositionHeight : item.sourceHeight,
          crop: item.crop,
          fitMode: item.type === 'composition' ? ('fill' as const) : ('contain' as const),
        }
      : undefined,
  )
  const pinSourceWidth = Math.max(1, Math.round(cornerPinTargetRect.width))
  const pinSourceHeight = Math.max(1, Math.round(cornerPinTargetRect.height))
  const resolvedCornerPin = resolveCornerPinForSize(item.cornerPin, pinSourceWidth, pinSourceHeight)
  if (!resolvedCornerPin) return
  const pinCanvas =
    pinSourceWidth === itemW &&
    pinSourceHeight === itemH &&
    Math.abs(cornerPinTargetRect.x) < 0.01 &&
    Math.abs(cornerPinTargetRect.y) < 0.01
      ? tempCanvas
      : new OffscreenCanvas(pinSourceWidth, pinSourceHeight)

  if (pinCanvas !== tempCanvas) {
    const pinCtx = pinCanvas.getContext('2d')
    if (!pinCtx) return
    pinCtx.clearRect(0, 0, pinSourceWidth, pinSourceHeight)
    pinCtx.drawImage(
      tempCanvas,
      cornerPinTargetRect.x,
      cornerPinTargetRect.y,
      cornerPinTargetRect.width,
      cornerPinTargetRect.height,
      0,
      0,
      pinSourceWidth,
      pinSourceHeight,
    )
  }

  const cornerPinRenderer = item.type === 'text' ? 'projective' : 'mesh'
  const pinDstX = left + cornerPinTargetRect.x
  const pinDstY = top + cornerPinTargetRect.y
  const drawPinnedImage = (targetCtx: OffscreenCanvasRenderingContext2D): void => {
    // Preview fast path: the projective warp is a CPU per-pixel pass and the
    // dominant cost for corner-pinned text. Its output is frame-invariant for
    // static text/pin/size, so cache & re-blit it across scrub frames.
    const warpCache = rctx.cornerPinWarpCache
    if (cornerPinRenderer === 'projective' && rctx.renderMode === 'preview' && warpCache) {
      // Key must cover every input baked into the warped bitmap. Beyond the text
      // raster + pin + source size, the pre-warp content also reflects the
      // post-raster modifiers applied to the temp canvas (masks, corner-radius
      // clip) — omitting them re-blits a stale warp when only those change.
      const key = `${getTextRasterCacheKey(item as TextItem, transform.width, transform.height)}|cp:${JSON.stringify(
        resolvedCornerPin,
      )}|${pinSourceWidth}x${pinSourceHeight}|cr:${transform.cornerRadius}|m:${JSON.stringify(
        preCornerPinMasks,
      )}`
      let entry: CornerPinWarpCacheEntry | null | undefined = warpCache.get(key)
      if (entry) {
        warpCache.delete(key)
        warpCache.set(key, entry)
      } else {
        const warp = computeProjectiveCornerPinWarp(
          pinCanvas,
          pinSourceWidth,
          pinSourceHeight,
          resolvedCornerPin,
        )
        if (warp) {
          entry = {
            canvas: warp.canvas,
            offsetX: warp.offsetX,
            offsetY: warp.offsetY,
            bytes: warp.canvas.width * warp.canvas.height * 4,
          }
          warpCache.set(key, entry)
          pruneCornerPinWarpCache(warpCache)
        }
      }
      if (entry) {
        targetCtx.drawImage(entry.canvas, pinDstX + entry.offsetX, pinDstY + entry.offsetY)
        return
      }
    }

    const args = [
      targetCtx,
      pinCanvas,
      pinSourceWidth,
      pinSourceHeight,
      pinDstX,
      pinDstY,
      resolvedCornerPin,
    ] as const

    if (cornerPinRenderer === 'projective') {
      drawCornerPinImage(...args, undefined, cornerPinRenderer)
      return
    }

    drawCornerPinImage(...args)
  }

  ctx.save()
  if (needsFlattenedOpacity) {
    ctx.globalAlpha = transform.opacity
  }

  applyItemTransformToContext(ctx, item, transform, rctx.canvasSettings)

  try {
    if (needsFlattenedOpacity) {
      const { canvas: flatCanvas, ctx: flatCtx } = rctx.canvasPool.acquire()
      try {
        if (
          flatCanvas.width !== rctx.canvasSettings.width ||
          flatCanvas.height !== rctx.canvasSettings.height
        ) {
          flatCanvas.width = rctx.canvasSettings.width
          flatCanvas.height = rctx.canvasSettings.height
        }
        flatCtx.clearRect(0, 0, flatCanvas.width, flatCanvas.height)
        drawPinnedImage(flatCtx)
        ctx.drawImage(flatCanvas, 0, 0)
      } finally {
        rctx.canvasPool.release(flatCanvas)
      }
    } else {
      drawPinnedImage(ctx)
    }
  } finally {
    ctx.restore()
  }
}
