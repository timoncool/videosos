import { useMemo } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import {
  useItemsStore,
  useKeyframesStore,
} from '@/features/keyframes/deps/timeline'
import { useResolvedPlaybackFrame } from '@/shared/state/playback/use-resolved-playback-frame'
import {
  resolveTransform,
  getSourceDimensions,
  expandTextTransformToFitContent,
  hasCornerPin,
} from '@/features/keyframes/deps/composition-runtime-contract'
import { resolveAnimatedTransform } from '../utils/animated-transform-resolver'
import { resolveAnimatedTextItem } from '../utils/animated-text-item'
import { applyMotionModifiers } from '../utils/motion-modifier-eval'
import { applyMotionAnimationLayers } from '../utils/motion-layer-eval'
import { resolveTransformHierarchy } from '@/shared/utils/transform-parenting'
import type { CanvasSettings } from '@/types/transform'
import type { ItemKeyframes } from '@/types/keyframe'

interface AnimatedTransformResult {
  /** The fully resolved transform with keyframe animation applied */
  transform: ResolvedTransform
  /** Whether this item has any keyframes */
  hasKeyframes: boolean
  /** The current frame relative to the item's start */
  relativeFrame: number
}

interface ProjectSize {
  width: number
  height: number
}

function resolveLocalAnimatedTransform(params: {
  item: TimelineItem
  canvas: CanvasSettings
  animationFrame: number
  itemKeyframes?: ItemKeyframes
  itemsById: ReadonlyMap<string, TimelineItem>
  keyframesByItemId: ReadonlyMap<string, ItemKeyframes>
}): ResolvedTransform {
  const { item, canvas, animationFrame, itemKeyframes, itemsById, keyframesByItemId } = params
  const relativeFrame = animationFrame - item.from
  const baseResolved = resolveTransform(item, canvas, getSourceDimensions(item))
  const resolved = itemKeyframes
    ? resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame, {
        globalFrame: animationFrame,
        canvas,
        getItem: (itemId) => itemsById.get(itemId),
        getKeyframes: (itemId) => keyframesByItemId.get(itemId),
      })
    : baseResolved
  const layered = applyMotionAnimationLayers(resolved, item.motionLayers, relativeFrame)
  const modulated = applyMotionModifiers(layered, item.motionModifiers, {
    frame: relativeFrame,
    fps: canvas.fps,
    frameWidth: canvas.width,
    frameHeight: canvas.height,
  })
  if (item.type !== 'text' || hasCornerPin(item.cornerPin)) return modulated
  return expandTextTransformToFitContent(
    resolveAnimatedTextItem(item, itemKeyframes, relativeFrame, canvas),
    modulated,
  )
}

/**
 * Hook to get the animated transform for a single item.
 * Handles keyframe interpolation automatically.
 *
 * Use this in gizmo/preview components. For Composition components,
 * use the inline logic with useCurrentFrame() since it's already
 * relative to the item's Sequence.
 */
export function useAnimatedTransform(
  item: TimelineItem,
  projectSize: ProjectSize,
): AnimatedTransformResult {
  // Important: avoid selectors that close over item.id here. Reading the whole
  // arrays keeps this hook keyed to store contents rather than to the current
  // item, so a different item id cannot surface a stale per-item slice.
  const allKeyframes = useKeyframesStore((s) => s.keyframes)
  const allItems = useItemsStore((s) => s.items)
  const itemKeyframes = useMemo(
    () => allKeyframes.find((k) => k.itemId === item.id),
    [allKeyframes, item.id],
  )

  const animationFrame = useResolvedPlaybackFrame()

  // Calculate relative frame
  const relativeFrame = animationFrame - item.from

  // Resolve the animated transform
  const transform = useMemo(() => {
    const canvas = { width: projectSize.width, height: projectSize.height, fps: 30 }
    const itemsById = new Map(allItems.map((candidate) => [candidate.id, candidate]))
    const keyframesByItemId = new Map(
      allKeyframes.map((candidate) => [candidate.itemId, candidate]),
    )
    return resolveTransformHierarchy(item, {
      getItem: (itemId) => itemsById.get(itemId),
      resolveLocal: (candidate) =>
        resolveLocalAnimatedTransform({
          item: candidate,
          canvas,
          animationFrame,
          itemKeyframes: keyframesByItemId.get(candidate.id),
          itemsById,
          keyframesByItemId,
        }),
    })
  }, [allItems, allKeyframes, animationFrame, item, projectSize])

  return {
    transform,
    hasKeyframes: !!itemKeyframes,
    relativeFrame,
  }
}

/**
 * Hook to get animated transforms for multiple items.
 * More efficient than calling useAnimatedTransform multiple times
 * as it shares the store subscriptions.
 */
export function useAnimatedTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize,
): Map<string, ResolvedTransform> {
  // Get all keyframes
  const allKeyframes = useKeyframesStore((s) => s.keyframes)
  const allItems = useItemsStore((s) => s.items)

  const animationFrame = useResolvedPlaybackFrame()

  // Resolve transforms for all items
  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>()
    const canvas = { width: projectSize.width, height: projectSize.height, fps: 30 }
    const itemsById = new Map(allItems.map((candidate) => [candidate.id, candidate]))
    const keyframesByItemId = new Map(
      allKeyframes.map((candidate) => [candidate.itemId, candidate]),
    )

    for (const item of items) {
      transforms.set(
        item.id,
        resolveTransformHierarchy(item, {
          getItem: (itemId) => itemsById.get(itemId),
          resolveLocal: (candidate) =>
            resolveLocalAnimatedTransform({
              item: candidate,
              canvas,
              animationFrame,
              itemKeyframes: keyframesByItemId.get(candidate.id),
              itemsById,
              keyframesByItemId,
            }),
        }),
      )
    }

    return transforms
  }, [items, projectSize, allItems, allKeyframes, animationFrame])
}
