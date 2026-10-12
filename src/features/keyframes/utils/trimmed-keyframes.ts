import type {
  AnimationKeyframeSource,
  ItemKeyframes,
  Keyframe,
  VectorKeyframe,
  VectorPropertyKeyframes,
} from '@/types/keyframe'
import { interpolatePropertyValue } from './interpolation'
import { interpolateVectorPropertyValue } from './vector-interpolation'

export interface TrimmedKeyframeCleanupResult {
  itemKeyframes: ItemKeyframes
  removedCount: number
  insertedBoundaryCount: number
}

export function countTrimmedKeyframes(
  itemKeyframes: ItemKeyframes | null | undefined,
  durationInFrames: number,
): number {
  if (!itemKeyframes) return 0
  const firstTrimmedFrame = Math.max(0, durationInFrames)
  return (
    itemKeyframes.properties.reduce(
      (count, property) =>
        count + property.keyframes.filter((keyframe) => keyframe.frame >= firstTrimmedFrame).length,
      0,
    ) +
    (itemKeyframes.vectorProperties?.reduce(
      (count, property) =>
        count + property.keyframes.filter((keyframe) => keyframe.frame >= firstTrimmedFrame).length,
      0,
    ) ?? 0)
  )
}

function getBoundarySource<T extends { frame: number; source?: AnimationKeyframeSource }>(
  keyframes: T[],
  boundaryFrame: number,
): AnimationKeyframeSource | undefined {
  const previous = keyframes.findLast((keyframe) => keyframe.frame < boundaryFrame)
  const next = keyframes.find((keyframe) => keyframe.frame > boundaryFrame)
  if (!previous) return next?.source
  if (!next) return previous.source
  return previous.source?.applicationId === next.source?.applicationId ? next.source : undefined
}

function cleanupScalarLane(
  keyframes: Keyframe[],
  boundaryFrame: number,
  createId: () => string,
): { keyframes: Keyframe[]; removedCount: number; insertedBoundary: boolean } {
  const sorted = keyframes.toSorted((left, right) => left.frame - right.frame)
  const removed = sorted.filter((keyframe) => keyframe.frame > boundaryFrame)
  if (removed.length === 0) {
    return { keyframes, removedCount: 0, insertedBoundary: false }
  }

  const kept = sorted.filter((keyframe) => keyframe.frame <= boundaryFrame)
  if (kept.some((keyframe) => keyframe.frame === boundaryFrame)) {
    return { keyframes: kept, removedCount: removed.length, insertedBoundary: false }
  }

  const template = kept.at(-1) ?? removed[0]!
  const boundaryKeyframe: Keyframe = {
    id: createId(),
    frame: boundaryFrame,
    value: interpolatePropertyValue(sorted, boundaryFrame, template.value),
    easing: template.easing,
    easingConfig: template.easingConfig,
    source: getBoundarySource(sorted, boundaryFrame),
  }
  return {
    keyframes: [...kept, boundaryKeyframe],
    removedCount: removed.length,
    insertedBoundary: true,
  }
}

function cleanupVectorLane(
  property: VectorPropertyKeyframes,
  boundaryFrame: number,
  fps: number,
  createId: () => string,
): { property: VectorPropertyKeyframes; removedCount: number; insertedBoundary: boolean } {
  const sorted = property.keyframes.toSorted((left, right) => left.frame - right.frame)
  const removed = sorted.filter((keyframe) => keyframe.frame > boundaryFrame)
  if (removed.length === 0) {
    return { property, removedCount: 0, insertedBoundary: false }
  }

  const kept = sorted.filter((keyframe) => keyframe.frame <= boundaryFrame)
  if (kept.some((keyframe) => keyframe.frame === boundaryFrame)) {
    return {
      property: { ...property, keyframes: kept },
      removedCount: removed.length,
      insertedBoundary: false,
    }
  }

  const template: VectorKeyframe = kept.at(-1) ?? removed[0]!
  const boundaryKeyframe: VectorKeyframe = {
    id: createId(),
    frame: boundaryFrame,
    value: interpolateVectorPropertyValue(
      property.property,
      sorted,
      boundaryFrame,
      template.value,
      fps,
    ),
    easing: template.easing,
    easingConfig: template.easingConfig,
    source: getBoundarySource(sorted, boundaryFrame),
  }
  return {
    property: { ...property, keyframes: [...kept, boundaryKeyframe] },
    removedCount: removed.length,
    insertedBoundary: true,
  }
}

/**
 * Destructively consolidate animation to the current clip duration.
 * Ordinary trims do not call this: out-of-range keys remain stored so extending
 * the clip restores them. This explicit cleanup writes the evaluated value at
 * the final visible frame before removing those parked keys.
 */
export function cleanupTrimmedKeyframes(
  itemKeyframes: ItemKeyframes,
  durationInFrames: number,
  fps: number,
  createId: () => string = () => crypto.randomUUID(),
): TrimmedKeyframeCleanupResult {
  const boundaryFrame = Math.max(0, durationInFrames - 1)
  let removedCount = 0
  let insertedBoundaryCount = 0

  const properties = itemKeyframes.properties.map((property) => {
    const result = cleanupScalarLane(property.keyframes, boundaryFrame, createId)
    removedCount += result.removedCount
    insertedBoundaryCount += result.insertedBoundary ? 1 : 0
    return result.removedCount > 0 ? { ...property, keyframes: result.keyframes } : property
  })
  const vectorProperties = itemKeyframes.vectorProperties?.map((property) => {
    const result = cleanupVectorLane(property, boundaryFrame, fps, createId)
    removedCount += result.removedCount
    insertedBoundaryCount += result.insertedBoundary ? 1 : 0
    return result.property
  })

  if (removedCount === 0) {
    return { itemKeyframes, removedCount: 0, insertedBoundaryCount: 0 }
  }
  return {
    itemKeyframes: { ...itemKeyframes, properties, vectorProperties },
    removedCount,
    insertedBoundaryCount,
  }
}
