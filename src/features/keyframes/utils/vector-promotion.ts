import type {
  AnimationKeyframeSource,
  EasingConfig,
  EasingType,
  ItemKeyframes,
  Keyframe,
  KeyframeRef,
  TransformAnimatableProperty,
  Vector2,
  VectorAnimatableProperty,
  VectorKeyframe,
  VectorPropertyKeyframes,
} from '@/types/keyframe'
import type { ResolvedTransform } from '@/types/transform'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import { toVectorScalePercent } from './vector-proxy'

const VECTOR_SOURCE_PROPERTIES: Record<
  VectorAnimatableProperty,
  readonly [TransformAnimatableProperty, TransformAnimatableProperty]
> = {
  position: ['x', 'y'],
  scale: ['width', 'height'],
  anchor: ['anchorX', 'anchorY'],
}

const VECTOR_EDITOR_PROPERTIES: Record<
  VectorAnimatableProperty,
  readonly [
    { property: TransformAnimatableProperty; axis: 'x' },
    { property: TransformAnimatableProperty; axis: 'y' },
  ]
> = {
  position: [
    { property: 'x', axis: 'x' },
    { property: 'y', axis: 'y' },
  ],
  scale: [
    { property: 'width', axis: 'x' },
    { property: 'height', axis: 'y' },
  ],
  anchor: [
    { property: 'anchorX', axis: 'x' },
    { property: 'anchorY', axis: 'y' },
  ],
}

export interface VectorPromotionPlan {
  vectorProperty: VectorPropertyKeyframes
  removeScalarProperties: TransformAnimatableProperty[]
}

export interface LegacyVectorPromotionIdentityRemap {
  /** Stored vector keyframe id keyed by the legacy editor-facing id. */
  storedIdByLegacyEditorId: Map<string, string>
  /** Active selection rewritten to the promoted editor-facing ids. */
  selectedKeyframes: KeyframeRef[]
}

/**
 * Preserve a live editor selection while legacy scalar transform lanes are
 * promoted to a vector lane. Promotion replaces every keyframe id in the lane,
 * so a multi-key drag must remap the whole selection before its first update.
 */
export function remapLegacyVectorPromotionIdentities(params: {
  itemId: string
  property: VectorAnimatableProperty
  vectorKeyframes: VectorKeyframe[]
  keyframesByProperty: Partial<Record<TransformAnimatableProperty, Keyframe[]>>
  selectedKeyframes: KeyframeRef[]
}): LegacyVectorPromotionIdentityRemap {
  const editorIdByLegacyEditorId = new Map<string, string>()
  const storedIdByLegacyEditorId = new Map<string, string>()

  for (const { property, axis } of VECTOR_EDITOR_PROPERTIES[params.property]) {
    for (const legacyKeyframe of params.keyframesByProperty[property] ?? []) {
      const promotedKeyframe = params.vectorKeyframes.find(
        (candidate) => candidate.frame === legacyKeyframe.frame,
      )
      if (!promotedKeyframe) continue

      storedIdByLegacyEditorId.set(legacyKeyframe.id, promotedKeyframe.id)
      editorIdByLegacyEditorId.set(
        legacyKeyframe.id,
        axis === 'y' ? `${promotedKeyframe.id}:y` : promotedKeyframe.id,
      )
    }
  }

  return {
    storedIdByLegacyEditorId,
    selectedKeyframes: params.selectedKeyframes.map((ref) => {
      if (ref.itemId !== params.itemId) return ref
      const matchingAxis = VECTOR_EDITOR_PROPERTIES[params.property].find(
        ({ property }) => property === ref.property,
      )
      if (!matchingAxis) return ref
      const promotedEditorId = editorIdByLegacyEditorId.get(ref.keyframeId)
      return promotedEditorId ? { ...ref, keyframeId: promotedEditorId } : ref
    }),
  }
}

function getKeyframeAtOrBefore(keyframes: Keyframe[], frame: number): Keyframe | undefined {
  return keyframes.findLast((keyframe) => keyframe.frame <= frame)
}

function getSegmentStyle(
  firstAxis: Keyframe[],
  secondAxis: Keyframe[],
  frame: number,
): { easing: EasingType; easingConfig?: EasingConfig } {
  const source = getKeyframeAtOrBefore(firstAxis, frame) ?? getKeyframeAtOrBefore(secondAxis, frame)
  return {
    easing: source?.easing ?? 'linear',
    easingConfig: source?.easingConfig,
  }
}

function getPromotionSource(
  firstAxis: Keyframe[],
  secondAxis: Keyframe[],
  frame: number,
): AnimationKeyframeSource | undefined {
  const authoredAtFrame = [...firstAxis, ...secondAxis].filter(
    (keyframe) => keyframe.frame === frame,
  )
  const source = authoredAtFrame[0]?.source
  if (!source) return undefined
  return authoredAtFrame.every(
    (keyframe) => keyframe.source?.applicationId === source.applicationId,
  )
    ? source
    : undefined
}

function resolvePositionValue(
  xKeyframes: Keyframe[],
  yKeyframes: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  return {
    x: interpolatePropertyValue(xKeyframes, frame, base.x),
    y: interpolatePropertyValue(yKeyframes, frame, base.y),
  }
}

function resolveScaleValue(
  widthKeyframes: Keyframe[],
  heightKeyframes: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  const width = interpolatePropertyValue(widthKeyframes, frame, base.width)
  const height = interpolatePropertyValue(heightKeyframes, frame, base.height)
  return {
    x: toVectorScalePercent(width, base.width),
    y: toVectorScalePercent(height, base.height),
  }
}

function resolveAnchorValue(
  xKeyframes: Keyframe[],
  yKeyframes: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  return {
    x: interpolatePropertyValue(xKeyframes, frame, base.anchorX),
    y: interpolatePropertyValue(yKeyframes, frame, base.anchorY),
  }
}

function resolveVectorValue(
  property: VectorAnimatableProperty,
  firstAxis: Keyframe[],
  secondAxis: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  if (property === 'position') return resolvePositionValue(firstAxis, secondAxis, frame, base)
  if (property === 'scale') return resolveScaleValue(firstAxis, secondAxis, frame, base)
  return resolveAnchorValue(firstAxis, secondAxis, frame, base)
}

/**
 * Convert legacy scalar transform lanes into one coupled Animation Core v2
 * lane. The union of authored frames preserves both axes' timing landmarks;
 * a requested playhead frame is included so promotion also creates the key the
 * user asked for.
 */
export function buildVectorPromotionPlan(params: {
  property: VectorAnimatableProperty
  itemKeyframes: ItemKeyframes | undefined
  baseTransform: ResolvedTransform
  /** Optional authored frame to seed while promoting from the inspector. */
  includeFrame?: number
  createId?: (frame: number) => string
}): VectorPromotionPlan {
  const { property, itemKeyframes, baseTransform } = params
  const [firstProperty, secondProperty] = VECTOR_SOURCE_PROPERTIES[property]
  const firstAxis = getPropertyKeyframes(itemKeyframes, firstProperty)
  const secondAxis = getPropertyKeyframes(itemKeyframes, secondProperty)
  const frames = new Set([
    ...firstAxis.map((keyframe) => keyframe.frame),
    ...secondAxis.map((keyframe) => keyframe.frame),
  ])
  if (typeof params.includeFrame === 'number') {
    frames.add(Math.max(0, Math.round(params.includeFrame)))
  }
  const createId = params.createId ?? (() => crypto.randomUUID())
  const keyframes: VectorKeyframe[] = Array.from(frames)
    .sort((left, right) => left - right)
    .map((frame) => {
      const source = getPromotionSource(firstAxis, secondAxis, frame)
      return {
        id: createId(frame),
        frame,
        value: resolveVectorValue(property, firstAxis, secondAxis, frame, baseTransform),
        ...getSegmentStyle(firstAxis, secondAxis, frame),
        ...(source ? { source } : {}),
      }
    })

  return {
    vectorProperty: { property, keyframes },
    removeScalarProperties: [firstProperty, secondProperty],
  }
}
