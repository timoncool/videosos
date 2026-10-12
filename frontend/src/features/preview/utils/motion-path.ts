import {
  ANIMATION_CORE_VERSION,
  getDirectPropertyLinks,
  type ItemKeyframes,
  type Keyframe,
  type PropertyKeyframes,
  type VectorKeyframe,
  type SpatialBezierTangents,
} from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'
import type { CoordinateParams } from '../types/gizmo'
import { resolveItemTransformAtFrame } from '../deps/composition-runtime'
import { getEffectiveScale } from './coordinate-transform'

export interface MotionPathPoint {
  frame: number
  x: number
  y: number
  isKeyframe: boolean
  /** Present for editable Animation Core v2 Position keyframes. */
  keyframeId?: string
  spatial?: SpatialBezierTangents
}

export interface MotionPathScreenPoint extends MotionPathPoint {
  screenX: number
  screenY: number
  inHandle?: { screenX: number; screenY: number }
  outHandle?: { screenX: number; screenY: number }
}

function hasPositionAnimation(itemKeyframes: ItemKeyframes | undefined): boolean {
  return (
    itemKeyframes?.vectorProperties?.some(
      (property) => property.property === 'position' && property.keyframes.length > 0,
    ) ||
    itemKeyframes?.properties.some(
      (property) =>
        (property.property === 'x' || property.property === 'y') && property.keyframes.length > 0,
    ) ||
    getDirectPropertyLinks(itemKeyframes).some(
      (link) =>
        link.enabled &&
        (link.targetProperty === 'x' ||
          link.targetProperty === 'y' ||
          link.targetProperty === 'position'),
    ) ||
    false
  )
}

/** Procedural modifiers that move the item's position (drive a motion path). */
function hasPositionModifiers(item: TimelineItem): boolean {
  return (
    item.motionModifiers?.some(
      (modifier) =>
        modifier.enabled &&
        modifier.amplitude > 0 &&
        (modifier.type === 'float-drift' || modifier.type === 'micro-shake'),
    ) ?? false
  )
}

function getPositionKeyframeFrames(
  item: TimelineItem,
  itemKeyframes: ItemKeyframes | undefined,
): Set<number> {
  const scalarFrames = (itemKeyframes?.properties ?? []).flatMap((property) =>
    property.property === 'x' || property.property === 'y'
      ? property.keyframes.map((keyframe) => keyframe.frame)
      : [],
  )
  const vectorFrames = (itemKeyframes?.vectorProperties ?? []).flatMap((property) =>
    property.property === 'position' ? property.keyframes.map((keyframe) => keyframe.frame) : [],
  )
  const endFrame = item.from + item.durationInFrames
  return new Set(
    [...scalarFrames, ...vectorFrames]
      .map((frame) => item.from + frame)
      .filter((frame) => frame >= item.from && frame < endFrame),
  )
}

function getEvenSampleFrames(startFrame: number, endFrame: number, maxSamples: number): number[] {
  const span = endFrame - startFrame
  if (span <= 0) return [startFrame]

  const sampleCount = Math.max(2, Math.min(maxSamples, span + 1))
  return Array.from({ length: sampleCount }, (_, index) =>
    Math.round(startFrame + (span * index) / (sampleCount - 1)),
  )
}

function hasVisibleMovement(points: MotionPathPoint[]): boolean {
  const first = points[0]
  if (!first) return false
  return points.some(
    (point) => Math.abs(point.x - first.x) > 0.5 || Math.abs(point.y - first.y) > 0.5,
  )
}

function resolveWorldSpatialTangents(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes
  canvas: CanvasSettings
  frame: number
  worldX: number
  worldY: number
  localX: number
  localY: number
  spatial: SpatialBezierTangents
  getItem?: (itemId: string) => TimelineItem | undefined
  getKeyframes?: (itemId: string) => ItemKeyframes | undefined
}): SpatialBezierTangents {
  const resolveEndpoint = (tangent: { x: number; y: number }) => {
    const endpoint = resolveItemTransformAtFrame(params.item, {
      canvas: params.canvas,
      frame: params.frame,
      keyframes: params.itemKeyframes,
      previewTransform: {
        x: params.localX + tangent.x,
        y: params.localY + tangent.y,
      },
      getItem: params.getItem,
      getKeyframes: params.getKeyframes,
    })
    return { x: endpoint.x - params.worldX, y: endpoint.y - params.worldY }
  }

  return {
    ...params.spatial,
    inTangent: resolveEndpoint(params.spatial.inTangent),
    outTangent: resolveEndpoint(params.spatial.outTangent),
  }
}

/** Temporary id for the injected drag-preview keyframe (never persisted). */
const PREVIEW_KEYFRAME_ID = '__motion-path-preview__'

/**
 * Fold a live gizmo-drag position into the item's x/y keyframes as a keyframe at
 * the dragged frame — an upsert — so the motion path previews the pending edit
 * (matching the auto-keyframe the drag will commit) without waiting for release.
 */
function applyPreviewKeyframe(
  itemKeyframes: ItemKeyframes,
  preview: {
    frame: number
    x: number
    y: number
    keyframeId?: string
    spatial?: SpatialBezierTangents
  },
): ItemKeyframes {
  const vectorPosition = itemKeyframes.vectorProperties?.find(
    (property) => property.property === 'position',
  )
  if (vectorPosition) {
    const previewId = `${PREVIEW_KEYFRAME_ID}-position`
    let keyframes: VectorKeyframe[]
    const matchesPreview = (keyframe: VectorKeyframe) =>
      preview.keyframeId ? keyframe.id === preview.keyframeId : keyframe.frame === preview.frame
    if (vectorPosition.keyframes.some(matchesPreview)) {
      keyframes = vectorPosition.keyframes.map((keyframe) =>
        matchesPreview(keyframe)
          ? {
              ...keyframe,
              value: { x: preview.x, y: preview.y },
              ...(preview.spatial && { spatial: preview.spatial }),
            }
          : keyframe,
      )
    } else {
      const easing =
        vectorPosition.keyframes.filter((keyframe) => keyframe.frame < preview.frame).at(-1)
          ?.easing ?? 'linear'
      keyframes = [
        ...vectorPosition.keyframes,
        {
          id: previewId,
          frame: preview.frame,
          value: { x: preview.x, y: preview.y },
          easing,
          ...(preview.spatial && { spatial: preview.spatial }),
        },
      ].sort((left, right) => left.frame - right.frame)
    }

    return {
      ...itemKeyframes,
      animationVersion: ANIMATION_CORE_VERSION,
      vectorProperties: itemKeyframes.vectorProperties?.map((property) =>
        property.property === 'position' ? { ...property, keyframes } : property,
      ),
    }
  }

  const upsert = (properties: PropertyKeyframes[], property: 'x' | 'y', value: number) => {
    // Distinct per-axis id so consumers that dedupe keyframes by id never collide.
    const previewId = `${PREVIEW_KEYFRAME_ID}-${property}`
    const index = properties.findIndex((group) => group.property === property)
    if (index === -1) {
      // No group for this axis yet — seed one with the preview keyframe so the
      // dragged axis still moves instead of silently staying put.
      const seededGroup: PropertyKeyframes = {
        property,
        keyframes: [{ id: previewId, frame: preview.frame, value, easing: 'linear' }],
      }
      return [...properties, seededGroup]
    }
    const group = properties[index]!
    let keyframes: Keyframe[]
    if (group.keyframes.some((keyframe) => keyframe.frame === preview.frame)) {
      keyframes = group.keyframes.map((keyframe) =>
        keyframe.frame === preview.frame ? { ...keyframe, value } : keyframe,
      )
    } else {
      // Inherit the incoming segment's easing so the previewed curve matches.
      const easing =
        group.keyframes.filter((keyframe) => keyframe.frame < preview.frame).at(-1)?.easing ??
        'linear'
      keyframes = [...group.keyframes, { id: previewId, frame: preview.frame, value, easing }].sort(
        (left, right) => left.frame - right.frame,
      )
    }
    const next = [...properties]
    next[index] = { ...group, keyframes }
    return next
  }

  return {
    ...itemKeyframes,
    properties: upsert(upsert(itemKeyframes.properties, 'x', preview.x), 'y', preview.y),
  }
}

export function buildMotionPathPoints(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  canvas: CanvasSettings
  maxSamples?: number
  getItem?: (itemId: string) => TimelineItem | undefined
  getKeyframes?: (itemId: string) => ItemKeyframes | undefined
  /**
   * Local-only edit preview. Gizmo drags provide frame/x/y; direct v2 path
   * editing additionally identifies the keyframe and may preview tangents.
   */
  preview?: {
    frame: number
    x: number
    y: number
    keyframeId?: string
    spatial?: SpatialBezierTangents
  }
}): MotionPathPoint[] {
  const { item, canvas, preview } = params
  const baseKeyframes = params.itemKeyframes
  const itemKeyframes =
    preview && baseKeyframes && hasPositionAnimation(baseKeyframes)
      ? applyPreviewKeyframe(baseKeyframes, preview)
      : baseKeyframes
  if (!hasPositionAnimation(itemKeyframes) && !hasPositionModifiers(item)) return []

  const startFrame = item.from
  const endFrame = item.from + Math.max(0, item.durationInFrames - 1)
  if (endFrame <= startFrame) return []

  const keyframeFrames = getPositionKeyframeFrames(item, itemKeyframes)
  const vectorKeyframeByAbsoluteFrame = new Map(
    (
      itemKeyframes?.vectorProperties?.find((property) => property.property === 'position')
        ?.keyframes ?? []
    )
      .filter(
        (keyframe) =>
          item.from + keyframe.frame >= startFrame && item.from + keyframe.frame <= endFrame,
      )
      .map((keyframe) => [item.from + keyframe.frame, keyframe]),
  )
  const frames = new Set([
    ...getEvenSampleFrames(startFrame, endFrame, Math.max(2, params.maxSamples ?? 36)),
    ...keyframeFrames,
  ])

  const points = Array.from(frames)
    .sort((left, right) => left - right)
    .map((frame) => {
      const transform = resolveItemTransformAtFrame(item, {
        canvas,
        frame,
        keyframes: itemKeyframes,
        getItem: params.getItem,
        getKeyframes: params.getKeyframes,
      })
      const vectorKeyframe = vectorKeyframeByAbsoluteFrame.get(frame)
      const localTransform = vectorKeyframe?.spatial
        ? resolveItemTransformAtFrame(item, {
            canvas,
            frame,
            keyframes: itemKeyframes,
          })
        : undefined
      return {
        frame,
        x: canvas.width / 2 + transform.x,
        y: canvas.height / 2 + transform.y,
        isKeyframe: keyframeFrames.has(frame),
        keyframeId: vectorKeyframe?.id,
        spatial:
          vectorKeyframe?.spatial && localTransform
            ? resolveWorldSpatialTangents({
                item,
                itemKeyframes: itemKeyframes!,
                canvas,
                frame,
                worldX: transform.x,
                worldY: transform.y,
                localX: localTransform.x,
                localY: localTransform.y,
                spatial: vectorKeyframe.spatial,
                getItem: params.getItem,
                getKeyframes: params.getKeyframes,
              })
            : undefined,
      }
    })

  return hasVisibleMovement(points) ? points : []
}

export function canvasPointToMotionPathScreenPoint(
  point: MotionPathPoint,
  coordParams: CoordinateParams,
): MotionPathScreenPoint {
  const scale = getEffectiveScale(coordParams)
  return {
    ...point,
    screenX: point.x * scale,
    screenY: point.y * scale,
    ...(point.spatial && {
      inHandle: {
        screenX: (point.x + point.spatial.inTangent.x) * scale,
        screenY: (point.y + point.spatial.inTangent.y) * scale,
      },
      outHandle: {
        screenX: (point.x + point.spatial.outTangent.x) * scale,
        screenY: (point.y + point.spatial.outTangent.y) * scale,
      },
    }),
  }
}
