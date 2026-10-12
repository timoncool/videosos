/**
 * Canonical scalar <-> coupled-vector transform mapping.
 *
 * Position/scale/anchor are authored as coupled vector properties, but every UI
 * surface that edits them (the timeline edit panel and the editor motion
 * workspace) needs to translate a scalar lane (`x`, `width`, `anchorY`, ...)
 * into its vector property + axis, and to translate keyframe ids across the
 * `:y` suffix convention that lets one stored vector row address two axes.
 *
 * That mapping and the id convention are the subtle part of vector-promotion
 * identity, so they live here once. Copies of this logic drifted between
 * surfaces before; keep new vector surfaces on these helpers.
 */

import type {
  AnimatableProperty,
  ItemKeyframes,
  TransformAnimatableProperty,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'

export type VectorAxis = 'x' | 'y'

export interface VectorPropertyProxy {
  property: VectorAnimatableProperty
  axis: VectorAxis
}

export interface VectorPropertyPair {
  property: VectorAnimatableProperty
  primary: TransformAnimatableProperty
  secondary: TransformAnimatableProperty
}

/** The three coupled transform rows, in display order. */
export const VECTOR_PROPERTY_PAIRS: readonly VectorPropertyPair[] = [
  { property: 'position', primary: 'x', secondary: 'y' },
  { property: 'scale', primary: 'width', secondary: 'height' },
  { property: 'anchor', primary: 'anchorX', secondary: 'anchorY' },
]

/** Resolve a scalar transform lane to its coupled vector property and axis. */
export function getVectorPropertyProxy(property: AnimatableProperty): VectorPropertyProxy | null {
  for (const pair of VECTOR_PROPERTY_PAIRS) {
    if (property === pair.primary) return { property: pair.property, axis: 'x' }
    if (property === pair.secondary) return { property: pair.property, axis: 'y' }
  }
  return null
}

/**
 * Scale lanes are stored in percent of the base transform. A zero base cannot be
 * divided by, so it reads as an unscaled 100%.
 */
export function toVectorScalePercent(value: number, baseValue: number): number {
  return Math.abs(baseValue) <= Number.EPSILON ? 100 : (value / baseValue) * 100
}

/** Stored vector keyframes: the x axis owns the bare id, the y axis appends `:y`. */
export function getStoredVectorKeyframeId(keyframeId: string, axis: VectorAxis): string {
  return axis === 'y' && keyframeId.endsWith(':y') ? keyframeId.slice(0, -2) : keyframeId
}

export function getEditorVectorKeyframeId(keyframeId: string, axis: VectorAxis): string {
  return axis === 'y' ? `${keyframeId}:y` : keyframeId
}

export function findStoredVectorKeyframe(
  itemKeyframes: ItemKeyframes | undefined,
  property: VectorAnimatableProperty,
  keyframeId: string,
): VectorKeyframe | undefined {
  return itemKeyframes?.vectorProperties
    ?.find((candidate) => candidate.property === property)
    ?.keyframes.find((keyframe) => keyframe.id === keyframeId)
}