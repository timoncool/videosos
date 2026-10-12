import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import { hasMediaCrop } from '@/shared/utils/media-crop'
import { getAnimatedCrop, getAnimatedTransform } from './canvas-keyframes'
import { resolveAnimatedColorEffects } from '@/runtime/renderer/deps/keyframes-contract'
import { getAdjustmentLayerEffects, type AdjustmentLayerWithTrackOrder } from './canvas-effects'
import type { CanvasSettings } from './canvas-item-renderer'

export interface FrameOcclusionContext {
  frame: number
  canvasWidth: number
  canvasHeight: number
  canvasSettings: CanvasSettings
  renderMode: 'export' | 'preview'
  /** Clip ids participating in a transition this frame (blended, never fully occluding). */
  transitionClipIds: ReadonlySet<string>
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getCurrentKeyframes: (itemId: string) => ItemKeyframes | undefined
  /**
   * True when a video item's decoded source may carry an alpha channel, so it is
   * NOT opaque and must never occlude the layers beneath it. Optional: when
   * absent (e.g. before media init), items are treated as opaque as before.
   */
  hasTransparentVideoSource?: (item: TimelineItem) => boolean
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getLiveItemSnapshot?: (itemId: string) => TimelineItem | undefined
}

/**
 * Whether `baseItem` fully and opaquely covers the canvas this frame, so every
 * track below it (higher order) can be skipped during occlusion culling.
 *
 * An item fully occludes only when it is opaque video/image content that covers
 * the whole canvas after transform/keyframes with: opacity 1, rotation 0/180,
 * no corner radius, no crop, no corner pin, normal blend mode, not in a
 * transition, and no transparency-adding effects (item or adjustment-layer).
 *
 * Pure predicate extracted verbatim from `createCompositionRenderer`'s
 * per-frame render path — no side effects.
 */
// Deliberate early-return decision chain; behavior locked by frame-occlusion.test.ts
// fallow-ignore-next-line complexity
export function isItemFullyOccluding(
  baseItem: TimelineItem,
  trackOrder: number,
  ctx: FrameOcclusionContext,
): boolean {
  const {
    frame,
    canvasWidth,
    canvasHeight,
    canvasSettings,
    renderMode,
    transitionClipIds,
    adjustmentLayers,
    getCurrentItem,
    getCurrentKeyframes,
    getPreviewEffectsOverride,
    getLiveItemSnapshot,
    hasTransparentVideoSource,
  } = ctx

  const item = getCurrentItem(baseItem)
  // Only videos and images can be fully opaque
  if (item.type !== 'video' && item.type !== 'image') return false

  // A video whose source carries an alpha channel is not opaque even at full
  // cover — culling the layers below would wrongly reveal the black base fill.
  // (Images decode to alpha-carrying bitmaps drawn as-is; only video needs this
  // codec-level check since its opacity depends on the decoded frame's format.)
  if (item.type === 'video' && hasTransparentVideoSource?.(item)) return false

  // Items in transitions are blended, not fully occluding
  if (transitionClipIds.has(item.id)) return false

  // Non-normal blend modes interact with layers below
  if (item.blendMode && item.blendMode !== 'normal') return false

  // Corner pin warps the shape, exposing content below
  if (item.cornerPin) return false

  // Get animated transform at current frame
  const itemKeyframes = getCurrentKeyframes(item.id)
  const animatedCrop = getAnimatedCrop(item, itemKeyframes, frame, canvasSettings)
  if (hasMediaCrop(animatedCrop)) return false
  const transform = getAnimatedTransform(item, itemKeyframes, frame, canvasSettings)

  // Check opacity (must be 1.0)
  if (transform.opacity < 1) return false

  // Check rotation (only 0 or 180 can fully cover without exposing corners)
  const rotation = transform.rotation % 360
  if (rotation !== 0 && rotation !== 180 && rotation !== -180) return false

  // Check corner radius (rounded corners expose content)
  if (transform.cornerRadius > 0) return false

  // Check if item covers entire canvas
  const itemLeft = canvasWidth / 2 + transform.x - transform.width / 2
  const itemTop = canvasHeight / 2 + transform.y - transform.height / 2
  const itemRight = itemLeft + transform.width
  const itemBottom = itemTop + transform.height

  // Must cover entire canvas (with small tolerance for floating point)
  const tolerance = 1
  if (itemLeft > tolerance || itemTop > tolerance) return false
  if (itemRight < canvasWidth - tolerance || itemBottom < canvasHeight - tolerance) return false

  // Check for effects that might add transparency
  const itemEffects =
    resolveAnimatedColorEffects(
      item.effects ?? [],
      getCurrentKeyframes(item.id),
      frame - item.from,
    ) ?? []
  const adjEffects = getAdjustmentLayerEffects(
    trackOrder,
    adjustmentLayers,
    frame,
    renderMode === 'preview' ? getPreviewEffectsOverride : undefined,
    renderMode === 'preview' ? getLiveItemSnapshot : undefined,
    getCurrentKeyframes,
  )
  const allEffects = [...itemEffects, ...adjEffects]

  for (const effectWrapper of allEffects) {
    if (!effectWrapper.enabled) continue
    const effect = effectWrapper.effect
    // Effects that could add transparency
    if ('opacity' in effect && typeof effect.opacity === 'number' && effect.opacity < 1) {
      return false
    }
  }

  return true
}
