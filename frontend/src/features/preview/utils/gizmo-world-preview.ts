import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import { worldToLocalTransform } from '@/shared/utils/transform-parenting'
import { resolveItemTransformAtFrame } from '@/features/preview/deps/composition-runtime'
import type { Transform } from '../types/gizmo'

function toResolvedTransform(transform: Transform): ResolvedTransform {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    anchorX: transform.anchorX ?? transform.width / 2,
    anchorY: transform.anchorY ?? transform.height / 2,
    rotation: transform.rotation,
    opacity: transform.opacity,
    cornerRadius: transform.cornerRadius ?? 0,
  }
}

/**
 * Gizmo transforms are authored in fully resolved canvas/world coordinates.
 * Render resolvers accept local preview overrides before applying parenting,
 * so convert the live world preview back into that local visual space first.
 */
export function resolveGizmoWorldPreviewAsLocal({
  itemId,
  worldPreviewTransform,
  canvas,
  frame,
  getItem,
  getKeyframes,
  getLocalPreviewTransform,
}: {
  itemId: string
  worldPreviewTransform: Transform
  canvas: CanvasSettings
  frame: number
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
  getLocalPreviewTransform?: (itemId: string) => Partial<ResolvedTransform> | undefined
}): ResolvedTransform {
  const worldPreview = toResolvedTransform(worldPreviewTransform)
  const item = getItem(itemId)
  if (!item?.transformParent) return worldPreview

  const parentId = item.transformParent.parentItemId
  const parent = parentId ? getItem(parentId) : undefined
  const parentWorld = parent
    ? resolveItemTransformAtFrame(parent, {
        canvas,
        frame,
        keyframes: getKeyframes(parent.id),
        getItem,
        getKeyframes,
        getPreviewTransform: getLocalPreviewTransform,
      })
    : undefined

  return worldToLocalTransform(worldPreview, item.transformParent, parentWorld)
}
