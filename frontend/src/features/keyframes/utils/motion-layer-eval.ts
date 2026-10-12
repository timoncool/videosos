import type {
  AnimatableProperty,
  EasingConfig,
  EasingType,
  TransformAnimatableProperty,
} from '@/types/keyframe'
import { isTransformAnimatableProperty } from '@/types/keyframe'
import type {
  MotionAnimationLayer,
  MotionLayerBlendMode,
  MotionLayerKeyframe,
  MotionLayerTrack,
} from '@/types/motion'
import type { ResolvedTransform } from '@/types/transform'
import { interpolatePropertyValue } from './interpolation'
import type { MotionContribution } from './motion-modifier-eval'

const IDENTITY_CONTRIBUTION: MotionContribution = {
  dx: 0,
  dy: 0,
  dRotation: 0,
  dOpacity: 0,
  scaleWidth: 1,
  scaleHeight: 1,
}

export interface MotionLayerPayload {
  property: AnimatableProperty
  frame: number
  value: number
  easing: EasingType
  easingConfig?: EasingConfig
}

function blendForProperty(property: TransformAnimatableProperty): MotionLayerBlendMode {
  return property === 'width' || property === 'height' ? 'multiply' : 'add'
}

function identityForBlend(blend: MotionLayerBlendMode): number {
  return blend === 'multiply' ? 1 : 0
}

function contributionValue(
  property: TransformAnimatableProperty,
  value: number,
  anchor: ResolvedTransform,
): number {
  if (property === 'width' || property === 'height') {
    return anchor[property] === 0 ? 1 : value / anchor[property]
  }
  return value - anchor[property]
}

/** Convert absolute preset output into a named offset/multiplier animation layer. */
export function createMotionAnimationLayer(params: {
  id?: string
  name: string
  source: MotionAnimationLayer['source']
  sourcePresetId: string
  anchor: ResolvedTransform
  payloads: readonly MotionLayerPayload[]
}): MotionAnimationLayer {
  const tracksByProperty = new Map<TransformAnimatableProperty, MotionLayerTrack>()
  for (const payload of params.payloads) {
    if (!isTransformAnimatableProperty(payload.property)) continue
    const property = payload.property
    const blend = blendForProperty(property)
    const keyframe: MotionLayerKeyframe = {
      id: crypto.randomUUID(),
      frame: payload.frame,
      value: contributionValue(property, payload.value, params.anchor),
      easing: payload.easing,
      easingConfig: payload.easingConfig,
    }
    const existing = tracksByProperty.get(property)
    if (existing) {
      existing.keyframes.push(keyframe)
    } else {
      tracksByProperty.set(property, { property, blend, keyframes: [keyframe] })
    }
  }

  return {
    id: params.id ?? crypto.randomUUID(),
    name: params.name,
    enabled: true,
    source: params.source,
    sourcePresetId: params.sourcePresetId,
    tracks: [...tracksByProperty.values()].map((track) => ({
      ...track,
      keyframes: track.keyframes.toSorted((left, right) => left.frame - right.frame),
    })),
  }
}

export function cloneMotionAnimationLayer(
  layer: MotionAnimationLayer,
  options: { freshIds?: boolean } = {},
): MotionAnimationLayer {
  return {
    ...layer,
    id: options.freshIds ? crypto.randomUUID() : layer.id,
    tracks: layer.tracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.map((keyframe) => ({
        ...keyframe,
        id: options.freshIds ? crypto.randomUUID() : keyframe.id,
        ...(keyframe.easingConfig && {
          easingConfig: {
            ...keyframe.easingConfig,
            ...(keyframe.easingConfig.bezier && {
              bezier: { ...keyframe.easingConfig.bezier },
            }),
            ...(keyframe.easingConfig.spring && {
              spring: { ...keyframe.easingConfig.spring },
            }),
          },
        }),
      })),
    })),
  }
}

export function getActiveMotionLayerChannels(
  layers: readonly MotionAnimationLayer[] | undefined,
): TransformAnimatableProperty[] {
  const channels = new Set<TransformAnimatableProperty>()
  for (const layer of layers ?? []) {
    if (!layer.enabled) continue
    for (const track of layer.tracks) {
      if (track.keyframes.length > 0) channels.add(track.property)
    }
  }
  return [...channels]
}

function evaluateMotionAnimationLayers(
  layers: readonly MotionAnimationLayer[] | undefined,
  frame: number,
): MotionContribution {
  if (!layers || layers.length === 0) return IDENTITY_CONTRIBUTION
  const out: MotionContribution = { ...IDENTITY_CONTRIBUTION }
  for (const layer of layers) {
    if (!layer.enabled) continue
    for (const track of layer.tracks) {
      if (track.keyframes.length === 0) continue
      const value = interpolatePropertyValue(track.keyframes, frame, identityForBlend(track.blend))
      switch (track.property) {
        case 'x':
          out.dx += value
          break
        case 'y':
          out.dy += value
          break
        case 'rotation':
          out.dRotation += value
          break
        case 'opacity':
          out.dOpacity += value
          break
        case 'width':
          out.scaleWidth *= value
          break
        case 'height':
          out.scaleHeight *= value
          break
        // Built-in motion presets do not currently author these channels. Keep
        // the exhaustive cases explicit so extending the layer catalog is safe.
        case 'anchorX':
        case 'anchorY':
        case 'cornerRadius':
          break
      }
    }
  }
  return out
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function applyMotionAnimationLayers(
  resolved: ResolvedTransform,
  layers: readonly MotionAnimationLayer[] | undefined,
  frame: number,
): ResolvedTransform {
  if (!layers || layers.length === 0) return resolved
  const contribution = evaluateMotionAnimationLayers(layers, frame)
  return {
    ...resolved,
    x: resolved.x + contribution.dx,
    y: resolved.y + contribution.dy,
    rotation: resolved.rotation + contribution.dRotation,
    width: Math.max(1, resolved.width * contribution.scaleWidth),
    height: Math.max(1, resolved.height * contribution.scaleHeight),
    opacity: clamp(resolved.opacity + contribution.dOpacity, 0, 1),
  }
}

/** Invert a layer contribution before a final visual transform is committed. */
export function removeMotionAnimationLayers(
  resolved: ResolvedTransform,
  layers: readonly MotionAnimationLayer[] | undefined,
  frame: number,
): ResolvedTransform {
  if (!layers || layers.length === 0) return resolved
  const contribution = evaluateMotionAnimationLayers(layers, frame)
  return {
    ...resolved,
    x: resolved.x - contribution.dx,
    y: resolved.y - contribution.dy,
    rotation: resolved.rotation - contribution.dRotation,
    width:
      contribution.scaleWidth === 0 ? resolved.width : resolved.width / contribution.scaleWidth,
    height:
      contribution.scaleHeight === 0 ? resolved.height : resolved.height / contribution.scaleHeight,
    opacity: clamp(resolved.opacity - contribution.dOpacity, 0, 1),
  }
}
