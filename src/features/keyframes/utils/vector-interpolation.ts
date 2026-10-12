import type {
  EasingConfig,
  EasingType,
  ItemKeyframes,
  TemporalEaseHandle,
  Vector2,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import { applyEasing, applyEasingConfig } from './easing'
import { cubicBezier } from '@/shared/utils/easing'

const DEFAULT_FPS = 30
const DEFAULT_INFLUENCE = 100 / 3

function clampInfluence(influence: number): number {
  return Math.max(0, Math.min(100, influence)) / 100
}

function getFallbackTimingProgress(
  progress: number,
  easing: EasingType,
  easingConfig: EasingConfig | undefined,
): number {
  return easingConfig ? applyEasingConfig(progress, easingConfig) : applyEasing(progress, easing)
}

function vectorDistance(from: Vector2, to: Vector2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function normalizeTemporalHandle(
  handle: TemporalEaseHandle | undefined,
  averageSpeed: number,
): { influence: number; speed: number } {
  return {
    influence: clampInfluence(handle?.influence ?? DEFAULT_INFLUENCE),
    speed: Math.max(0, handle?.speed ?? averageSpeed),
  }
}

/**
 * Convert velocity/influence handles into a normalized cubic timing curve.
 * This keeps the persisted handles meaningful across frame rates and allows a
 * speed graph to edit the same data used by preview and export.
 */
function getTemporalTimingProgress(
  previous: VectorKeyframe,
  next: VectorKeyframe,
  progress: number,
  fps: number,
): number {
  const outgoing = previous.temporalEase?.out
  const incoming = next.temporalEase?.in
  if (!outgoing && !incoming) {
    return getFallbackTimingProgress(progress, previous.easing, previous.easingConfig)
  }

  const frameDuration = next.frame - previous.frame
  const durationSeconds = frameDuration / Math.max(1, fps)
  const distance = vectorDistance(previous.value, next.value)
  if (durationSeconds <= 0 || distance <= Number.EPSILON) {
    return getFallbackTimingProgress(progress, previous.easing, previous.easingConfig)
  }

  const averageSpeed = distance / durationSeconds
  const outHandle = normalizeTemporalHandle(outgoing, averageSpeed)
  const inHandle = normalizeTemporalHandle(incoming, averageSpeed)

  return cubicBezier(progress, {
    x1: outHandle.influence,
    y1: outHandle.influence * (outHandle.speed / averageSpeed),
    x2: 1 - inHandle.influence,
    y2: 1 - inHandle.influence * (inHandle.speed / averageSpeed),
  })
}

function interpolateLinear(from: Vector2, to: Vector2, progress: number): Vector2 {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  }
}

function evaluateCubicBezier(
  start: Vector2,
  control1: Vector2,
  control2: Vector2,
  end: Vector2,
  progress: number,
): Vector2 {
  const inverse = 1 - progress
  const startWeight = inverse * inverse * inverse
  const control1Weight = 3 * inverse * inverse * progress
  const control2Weight = 3 * inverse * progress * progress
  const endWeight = progress * progress * progress
  return {
    x:
      startWeight * start.x +
      control1Weight * control1.x +
      control2Weight * control2.x +
      endWeight * end.x,
    y:
      startWeight * start.y +
      control1Weight * control1.y +
      control2Weight * control2.y +
      endWeight * end.y,
  }
}

function hasSpatialPath(
  property: VectorAnimatableProperty,
  previous: VectorKeyframe,
  next: VectorKeyframe,
): boolean {
  return property === 'position' && Boolean(previous.spatial || next.spatial)
}

function interpolateSpatialSegment(
  previous: VectorKeyframe,
  next: VectorKeyframe,
  progress: number,
): Vector2 {
  const outgoing = previous.spatial?.outTangent ?? { x: 0, y: 0 }
  const incoming = next.spatial?.inTangent ?? { x: 0, y: 0 }
  return evaluateCubicBezier(
    previous.value,
    { x: previous.value.x + outgoing.x, y: previous.value.y + outgoing.y },
    { x: next.value.x + incoming.x, y: next.value.y + incoming.y },
    next.value,
    progress,
  )
}

function interpolateVectorSegment(
  property: VectorAnimatableProperty,
  previous: VectorKeyframe,
  next: VectorKeyframe,
  frame: number,
  fps: number,
): Vector2 {
  const frameRange = next.frame - previous.frame
  if (frameRange <= 0) return previous.value
  if (previous.easing === 'hold') return previous.value

  const progress = (frame - previous.frame) / frameRange
  const timedProgress = getTemporalTimingProgress(previous, next, progress, fps)
  return hasSpatialPath(property, previous, next)
    ? interpolateSpatialSegment(previous, next, timedProgress)
    : interpolateLinear(previous.value, next.value, timedProgress)
}

/** Evaluate a coupled Position, Scale, or Anchor lane at an item-relative frame. */
export function interpolateVectorPropertyValue(
  property: VectorAnimatableProperty,
  keyframes: VectorKeyframe[],
  frame: number,
  baseValue: Vector2,
  fps = DEFAULT_FPS,
): Vector2 {
  if (keyframes.length === 0) return baseValue

  const first = keyframes[0]!
  if (keyframes.length === 1 || frame <= first.frame) return first.value

  const last = keyframes[keyframes.length - 1]!
  if (frame >= last.frame) return last.value

  for (let index = 0; index < keyframes.length - 1; index++) {
    const previous = keyframes[index]!
    const next = keyframes[index + 1]!
    if (previous.frame <= frame && next.frame > frame) {
      return interpolateVectorSegment(property, previous, next, frame, fps)
    }
  }

  return baseValue
}

export interface VectorSpeedSample {
  frame: number
  /** Property units per second along the vector path. */
  speed: number
}

/**
 * Sample the actual rendered vector velocity for a speed graph. Temporal ease,
 * spatial Beziers, frame rate, and hold segments all flow through the same
 * interpolation path used by preview/export.
 */
export function sampleVectorSpeedGraph(
  property: VectorAnimatableProperty,
  keyframes: VectorKeyframe[],
  fps = DEFAULT_FPS,
  samplesPerSegment = 24,
): VectorSpeedSample[] {
  if (keyframes.length < 2) return []

  const samples: VectorSpeedSample[] = []
  const sampleCount = Math.max(2, Math.round(samplesPerSegment))
  const safeFps = Math.max(1, fps)

  for (let index = 0; index < keyframes.length - 1; index++) {
    const previous = keyframes[index]!
    const next = keyframes[index + 1]!
    const frameRange = next.frame - previous.frame
    if (frameRange <= 0) continue

    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
      if (index > 0 && sampleIndex === 0) continue
      const frame = previous.frame + (frameRange * sampleIndex) / sampleCount
      const delta = Math.min(0.01, frameRange / sampleCount / 2)
      const fromFrame = Math.max(previous.frame, frame - delta)
      const toFrame = Math.min(next.frame, frame + delta)
      const durationSeconds = (toFrame - fromFrame) / safeFps
      const from = interpolateVectorPropertyValue(
        property,
        keyframes,
        fromFrame,
        previous.value,
        safeFps,
      )
      const to = interpolateVectorPropertyValue(
        property,
        keyframes,
        toFrame,
        previous.value,
        safeFps,
      )
      samples.push({
        frame,
        speed:
          durationSeconds <= Number.EPSILON
            ? 0
            : Math.hypot(to.x - from.x, to.y - from.y) / durationSeconds,
      })
    }
  }

  return samples
}

export function getVectorPropertyKeyframes(
  itemKeyframes: ItemKeyframes | undefined,
  property: VectorAnimatableProperty,
): VectorKeyframe[] {
  return (
    itemKeyframes?.vectorProperties?.find((candidate) => candidate.property === property)
      ?.keyframes ?? []
  )
}
