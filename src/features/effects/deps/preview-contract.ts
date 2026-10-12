/**
 * Adapter exports for preview dependencies.
 * Effects modules should import preview stores/hooks from here.
 */

export { useGizmoStore } from '@/features/preview/stores/gizmo-store'
export { usePowerWindowEditorStore } from '@/features/preview/stores/power-window-editor-store'
export { useSpatialEffectEditorStore } from '@/features/preview/stores/spatial-effect-editor-store'
export { useThrottledFrame } from '@/features/preview/hooks/use-throttled-frame'
