import type { ShapeAnimatableProperty } from '@/types/keyframe'
import { isShapeAnimatableProperty } from '@/types/keyframe'
import type { ShapeItem } from '@/types/timeline'

export const SHAPE_ANIMATABLE_PROPERTIES: readonly ShapeAnimatableProperty[] = [
  'trimPathStart',
  'trimPathEnd',
  'trimPathOffset',
  'taperStartWidth',
  'taperEndWidth',
  'taperStartLength',
  'taperEndLength',
]

const SHAPE_PROPERTY_DEFAULTS: Record<ShapeAnimatableProperty, number> = {
  trimPathStart: 0,
  trimPathEnd: 100,
  trimPathOffset: 0,
  taperStartWidth: 100,
  taperEndWidth: 100,
  taperStartLength: 0,
  taperEndLength: 0,
}

export { isShapeAnimatableProperty }

export function getShapeAnimatableBaseValue(
  item: ShapeItem,
  property: ShapeAnimatableProperty,
): number {
  return item[property] ?? SHAPE_PROPERTY_DEFAULTS[property]
}
