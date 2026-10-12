import { useMemo } from 'react'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import {
  useItemsStore,
  useKeyframesStore,
  useTimelineSettingsStore,
} from '@/features/preview/deps/timeline-store'
import { resolveAnimatedTextItem } from '@/features/preview/deps/keyframes'
import { useResolvedPlaybackFrame } from '@/shared/state/playback/use-resolved-playback-frame'
import { useGizmoStore } from '@/features/preview/stores/gizmo-store'
import {
  hasCornerPin,
  resolveItemTransformAtFrame,
} from '@/features/preview/deps/composition-runtime'
import { resolveGizmoWorldPreviewAsLocal } from '../utils/gizmo-world-preview'
import { expandTextTransformForPreview } from '../utils/text-layout'

interface ProjectSize {
  width: number
  height: number
}

function applyTextExpansion(
  item: TimelineItem,
  transform: ResolvedTransform,
  previewProperties?: Parameters<typeof expandTextTransformForPreview>[2],
  skipExpansion = false,
): ResolvedTransform {
  if (item.type !== 'text') return transform
  if (skipExpansion) return transform
  return expandTextTransformForPreview(item, transform, previewProperties)
}

/**
 * Resolve visual transforms for multiple items (base -> keyframes -> preview).
 */
export function useVisualTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize,
  allItemsOverride?: TimelineItem[],
  frameOverride?: number,
): Map<string, ResolvedTransform> {
  const fps = useTimelineSettingsStore((s) => s.fps)
  const allItems = useItemsStore((state) => allItemsOverride ?? state.items)
  const keyframesByItemId = useKeyframesStore((state) => state.keyframesByItemId)
  // Translate previews are presented imperatively by the item wrapper and
  // transform gizmo. Keeping them out of this scene-wide resolver prevents
  // every pointer sample from recomputing every visible item's transform.
  const activeGizmoItemId = useGizmoStore((s) =>
    s.activeGizmo?.mode === 'translate' ? undefined : s.activeGizmo?.itemId,
  )
  const gizmoPreviewTransform = useGizmoStore((s) =>
    s.activeGizmo?.mode === 'translate' ? null : s.previewTransform,
  )
  const preview = useGizmoStore((s) => s.preview)
  // Frozen editor chrome (notably GizmoOverlay during playback) can provide
  // its presentation frame explicitly. Keeping the external-store snapshot
  // disabled in that mode prevents live playback ticks from re-rendering a
  // scene-wide overlay whose controls are not being presented.
  const resolvedPlaybackFrame = useResolvedPlaybackFrame(
    frameOverride === undefined && items.length > 0,
  )
  const animationFrame = frameOverride ?? resolvedPlaybackFrame

  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>()
    const canvas = { width: projectSize.width, height: projectSize.height, fps }
    const itemsById = new Map(allItems.map((item) => [item.id, item]))
    const getLocalPreviewTransform = (itemId: string) => preview?.[itemId]?.transform
    const activeGizmoLocalPreview =
      activeGizmoItemId && gizmoPreviewTransform
        ? resolveGizmoWorldPreviewAsLocal({
            itemId: activeGizmoItemId,
            worldPreviewTransform: gizmoPreviewTransform,
            canvas,
            frame: animationFrame,
            getItem: (itemId) => itemsById.get(itemId),
            getKeyframes: (itemId) => keyframesByItemId[itemId],
            getLocalPreviewTransform,
          })
        : undefined
    const getPreviewTransform = (itemId: string) =>
      activeGizmoItemId === itemId && activeGizmoLocalPreview
        ? activeGizmoLocalPreview
        : getLocalPreviewTransform(itemId)

    for (const item of items) {
      const itemKeyframe = keyframesByItemId[item.id]
      const previewProperties = preview?.[item.id]?.properties
      const animatedTextItem =
        item.type === 'text'
          ? resolveAnimatedTextItem(
              item,
              itemKeyframe ?? undefined,
              animationFrame - item.from,
              canvas,
            )
          : item
      const animatedTransform = resolveItemTransformAtFrame(item, {
        canvas,
        frame: animationFrame,
        keyframes: itemKeyframe,
        getItem: (itemId) => itemsById.get(itemId),
        getKeyframes: (itemId) => keyframesByItemId[itemId],
        getPreviewTransform,
      })

      transforms.set(
        item.id,
        applyTextExpansion(
          animatedTextItem,
          animatedTransform,
          previewProperties,
          hasCornerPin(item.cornerPin),
        ),
      )
    }

    return transforms
  }, [
    items,
    projectSize.height,
    projectSize.width,
    allItems,
    keyframesByItemId,
    animationFrame,
    activeGizmoItemId,
    gizmoPreviewTransform,
    preview,
    fps,
  ])
}
