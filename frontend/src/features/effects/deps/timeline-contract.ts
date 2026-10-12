/**
 * Adapter exports for timeline dependencies.
 * Effects modules should import timeline stores/actions from here.
 */

export {
  addEffect,
  addEffects,
  applyAutoKeyframeOperations,
  removeEffect,
  setItemEffects,
  toggleEffect,
  updateEffect,
} from '@/features/timeline/stores/timeline-actions'
export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
