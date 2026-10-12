/**
 * Adapter exports for keyframes dependencies.
 * Timeline modules should import keyframe components/utilities from here.
 */

export type { AutoKeyframeOperation } from '@/features/keyframes/utils/auto-keyframe'
export { interpolatePropertyValue } from '@/features/keyframes/utils/interpolation'
export { sampleVectorSpeedGraph } from '@/features/keyframes/utils/vector-interpolation'
export {
  cleanupTrimmedKeyframes,
  countTrimmedKeyframes,
} from '@/features/keyframes/utils/trimmed-keyframes'
export {
  buildVectorPromotionPlan,
  remapLegacyVectorPromotionIdentities,
} from '@/features/keyframes/utils/vector-promotion'
export {
  resolveAnimatedTransform,
  resolveExpressionReferenceValue,
  wouldCreateDirectPropertyLinkCycle,
} from '@/features/keyframes/utils/animated-transform-resolver'
export {
  getShapeAnimatableBaseValue,
  resolveAnimatedShapeItem,
} from '@/features/keyframes/utils/animated-shape-item'
export { buildEasingConfig } from '@/features/keyframes/utils/easing-presets'
export {
  getTransitionBlockedRanges,
  isFrameInTransitionRegion,
} from '@/features/keyframes/utils/transition-region'
export { DopesheetEditor } from '@/features/keyframes/components/dopesheet-editor'
export { PickWhipIcon } from '@/features/keyframes/components/dopesheet-editor/pick-whip-icon'
export { PropertyLinkPickWhipOverlay } from '@/features/keyframes/components/property-link-pick-whip-overlay'
export {
  GROUP_HEADER_HEIGHT,
  ROW_HEIGHT,
} from '@/features/keyframes/components/dopesheet-editor/dopesheet-constants'
export {
  getPropertyAccordionGroups,
  getPropertyDisplayGroups,
} from '@/features/keyframes/components/dopesheet-editor/property-groups'
export { CompactNavigator } from '@/features/keyframes/components/dopesheet-editor/compact-navigator'
export { getKeyframeNavigatorThumbMetrics } from '@/features/keyframes/components/dopesheet-editor/compact-navigator-utils'
export {
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  KEYFRAME_EDGE_INSET,
} from '@/features/keyframes/components/dopesheet-editor/layout'
export { getNiceTickStep } from '@/features/keyframes/components/dopesheet-editor/dopesheet-helpers'
export { useRafCoalescedValue } from '@/features/keyframes/components/use-raf-coalesced-value'
export { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
export {
  findStoredVectorKeyframe,
  getEditorVectorKeyframeId,
  getStoredVectorKeyframeId,
  getVectorPropertyProxy,
  toVectorScalePercent,
  type VectorPropertyProxy,
} from '@/features/keyframes/utils/vector-proxy'
export { getAnimatablePropertyBaseValue } from '@/features/keyframes/utils/animatable-property-base-value'
export {
  getProceduralBands,
  type ProceduralPreviewInput,
} from '@/features/keyframes/utils/procedural-preview'
export { buildBakeMotionPlan } from '@/features/keyframes/utils/bake-motion'
export { cloneMotionAnimationLayer } from '@/features/keyframes/utils/motion-layer-eval'
export { getEffectPropertyBaseValue } from '@/features/keyframes/utils/effect-animatable-properties'
export {
  captureAnimationFromItem,
  getPresetCompatibility,
} from '@/features/keyframes/utils/animation-preset-compat'
export type { PresetIncompatibilityReason } from '@/features/keyframes/utils/animation-preset-compat'
