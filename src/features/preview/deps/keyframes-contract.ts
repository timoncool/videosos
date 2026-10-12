/**
 * Adapter exports for keyframes dependencies.
 * Preview modules should import keyframe hooks/utilities from here.
 */

export { useAnimatedTransform } from '@/features/keyframes/hooks/use-animated-transform'
export { resolveAnimatedCrop } from '@/features/keyframes/utils/animated-crop-resolver'
export {
  getAutoKeyframeOperation,
  getVectorAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@/features/keyframes/utils/auto-keyframe'
export { removeMotionAnimationLayers } from '@/features/keyframes/utils/motion-layer-eval'
export { removeMotionModifiers } from '@/features/keyframes/utils/motion-modifier-eval'
export { isFrameInTransitionRegion } from '@/features/keyframes/utils/transition-region'
export { resolveAnimatedTextItem } from '@/features/keyframes/utils/animated-text-item'
export { resolveAnimatedShapeItem } from '@/features/keyframes/utils/animated-shape-item'
export { resetAutoKeyframeStore } from '@/features/keyframes/stores/auto-keyframe-store'
export {
  clonePathVertices,
  getChangedPathVertexValues,
  hasPathVertexKeyframes,
} from '@/features/keyframes/utils/path-animatable-properties'
