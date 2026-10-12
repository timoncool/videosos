import type {
  ItemKeyframes,
  SpatialBezierTangents,
  Vector2,
  VectorKeyframe,
} from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { worldToLocalTransform } from '@/shared/utils/transform-parenting'
import { resolveItemTransformAtFrame } from '../deps/composition-runtime'

function scaleVector(vector: Vector2, scale: number): Vector2 {
  const x = vector.x * scale
  const y = vector.y * scale
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y }
}

function subtract(from: Vector2, to: Vector2): Vector2 {
  return { x: from.x - to.x, y: from.y - to.y }
}

/** Create smooth one-third spatial handles aligned with adjacent keyframes. */
export function buildDefaultSpatialTangents(
  keyframes: VectorKeyframe[],
  keyframeId: string,
): SpatialBezierTangents | null {
  const index = keyframes.findIndex((keyframe) => keyframe.id === keyframeId)
  const current = keyframes[index]
  if (!current) return null

  const previous = keyframes[index - 1]
  const next = keyframes[index + 1]
  if (previous && next) {
    const chord = subtract(next.value, previous.value)
    return {
      inTangent: scaleVector(chord, -1 / 6),
      outTangent: scaleVector(chord, 1 / 6),
      continuous: true,
    }
  }
  if (next) {
    const outgoing = scaleVector(subtract(next.value, current.value), 1 / 3)
    return {
      inTangent: scaleVector(outgoing, -1),
      outTangent: outgoing,
      continuous: true,
    }
  }
  if (previous) {
    const incoming = scaleVector(subtract(previous.value, current.value), 1 / 3)
    return {
      inTangent: incoming,
      outTangent: scaleVector(incoming, -1),
      continuous: true,
    }
  }
  return {
    inTangent: { x: 0, y: 0 },
    outTangent: { x: 0, y: 0 },
    continuous: true,
  }
}

/** Move one tangent and mirror the opposite tangent when continuity is enabled. */
export function updateSpatialTangent(
  spatial: SpatialBezierTangents,
  handle: 'in' | 'out',
  tangent: Vector2,
): SpatialBezierTangents {
  if (handle === 'in') {
    return {
      ...spatial,
      inTangent: tangent,
      ...(spatial.continuous && { outTangent: scaleVector(tangent, -1) }),
    }
  }
  return {
    ...spatial,
    outTangent: tangent,
    ...(spatial.continuous && { inTangent: scaleVector(tangent, -1) }),
  }
}

/**
 * Convert a canvas/world pointer into the value stored by a Position keyframe.
 * The delta form deliberately preserves procedural offsets that are evaluated
 * after the keyframe while still undoing the complete parent hierarchy.
 */
export function worldPointToPositionKeyframeValue(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes
  frame: number
  worldPoint: Vector2
  currentValue: Vector2
  canvas: CanvasSettings
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
}): Vector2 {
  const { item, itemKeyframes, frame, canvas, getItem, getKeyframes } = params
  const local = resolveItemTransformAtFrame(item, {
    canvas,
    frame,
    keyframes: itemKeyframes,
  })
  const world = resolveItemTransformAtFrame(item, {
    canvas,
    frame,
    keyframes: itemKeyframes,
    getItem,
    getKeyframes,
  })
  const parent = item.transformParent?.parentItemId
    ? getItem(item.transformParent.parentItemId)
    : undefined
  const parentWorld = parent
    ? resolveItemTransformAtFrame(parent, {
        canvas,
        frame,
        keyframes: getKeyframes(parent.id),
        getItem,
        getKeyframes,
      })
    : undefined
  const targetLocal = worldToLocalTransform(
    { ...world, x: params.worldPoint.x, y: params.worldPoint.y },
    item.transformParent,
    parentWorld,
  )

  return {
    x: params.currentValue.x + targetLocal.x - local.x,
    y: params.currentValue.y + targetLocal.y - local.y,
  }
}
