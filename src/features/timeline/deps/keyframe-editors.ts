/**
 * Adapter exports for keyframe editor UI used by lazy timeline panels.
 */

export {
  DopesheetEditor,
  PickWhipIcon,
  PropertyLinkPickWhipOverlay,
  CompactNavigator,
  getKeyframeNavigatorThumbMetrics,
  getNiceTickStep,
  useRafCoalescedValue,
  GROUP_HEADER_HEIGHT,
  KEYFRAME_EDGE_INSET,
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  ROW_HEIGHT,
  getAnimatablePropertiesForItem,
  getEffectPropertyBaseValue,
  getProceduralBands,
  getPropertyAccordionGroups,
  getPropertyDisplayGroups,
  buildVectorPromotionPlan,
  resolveAnimatedTransform,
  getShapeAnimatableBaseValue,
  resolveAnimatedShapeItem,
  resolveExpressionReferenceValue,
  captureAnimationFromItem,
  getPresetCompatibility,
  buildBakeMotionPlan,
  cloneMotionAnimationLayer,
} from './keyframes-contract'
export type { PresetIncompatibilityReason, ProceduralPreviewInput } from './keyframes-contract'
