/**
 * Adapter exports for keyframes dependencies.
 * Renderer modules should import keyframe utilities from here.
 */

export {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@/features/keyframes/utils/interpolation'
export { resolveAnimatedCrop } from '@/features/keyframes/utils/animated-crop-resolver'
export { resolveAnimatedColorEffects } from '@/features/keyframes/utils/effect-animatable-properties'
export { resolveAnimatedTextItem } from '@/features/keyframes/utils/animated-text-item'
export { resolveAnimatedShapeItem } from '@/features/keyframes/utils/animated-shape-item'
