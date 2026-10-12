/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
export { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
export { useMarkersStore } from '@/features/timeline/stores/markers-store'
export { selectAudioGraphItems } from '@/features/timeline/stores/items-store-indexes'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
export {
  getActiveTabId,
  useCompositionNavigationStore,
} from '@/features/timeline/stores/composition-navigation-store'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
export { execute as executeTimelineCommand } from '@/features/timeline/stores/actions/shared'
export { captureSnapshot } from '@/features/timeline/stores/commands/snapshot'
export {
  rateStretchItemWithoutHistory,
  resetSpeedWithRipple,
} from '@/features/timeline/stores/actions/item-edit-actions'
export {
  addCompositionControl,
  removeCompositionControl,
  renameCompositionControl,
  repairCompositeCompositionEditorialLeak,
  setCompositionCanvasSettings,
  setCompositionDuration,
  trimCompositionToActiveRegion,
} from '@/features/timeline/stores/actions/composition-editor-actions'
export { setInOutPointsWithoutHistory } from '@/features/timeline/stores/actions/marker-actions'
export { applyAnimationPreset } from '@/features/timeline/stores/actions/preset-actions'
export {
  applyMotionPresetKeyframes,
  removePresetKeyframeApplication,
  removeManualKeyframes,
  trimAnimationToItemBounds,
} from '@/features/timeline/stores/actions/keyframe-actions'
export type {
  MotionPresetClear,
  MotionPresetVectorApply,
} from '@/features/timeline/stores/actions/keyframe-actions'
export {
  applyMotionLayersToItems,
  removeMotionLayerFromItems,
  applyMotionModifierToItems,
  updateMotionModifiersLive,
  beginMotionModifierEdit,
  commitMotionModifierEdit,
  removeMotionModifierFromItems,
  removeAudioPulseFromItems,
  bakeMotionToKeyframes,
} from '@/features/timeline/stores/actions/motion-modifier-actions'
export {
  applyTextMotionEffect,
  updateTextMotionLive,
  beginTextMotionEdit,
  commitTextMotionEdit,
  removeTextMotionEffect,
} from '@/features/timeline/stores/actions/text-motion-actions'
export {
  captureAnimationFromItem,
  getPresetCompatibility,
} from '@/features/timeline/deps/keyframe-editors'
export {
  createMotionClip,
  openComposition,
} from '@/features/timeline/stores/actions/composition-actions'
export {
  addEffect,
  addItem,
  addItemOnNewTrack,
  addTransition,
  applyAutoKeyframeOperations,
  clearAllMarkers,
  markDirty,
  removeKeyframesForItem,
  removeKeyframesForProperty,
  removeMarker,
  removeTransition,
  setInPoint,
  setOutPoint,
  toggleSnap,
  updateItem,
  updateItemsTransform,
  updateItemsTransformMap,
  updateMarker,
  updateTransition,
} from '@/features/timeline/stores/timeline-actions'
export { loadTimeline, saveTimeline } from '@/features/timeline/stores/timeline-persistence'
