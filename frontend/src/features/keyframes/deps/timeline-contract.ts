/**
 * Adapter exports for timeline dependencies.
 * Keyframes modules should import timeline stores/actions from here.
 */

export { addKeyframes, removeKeyframes } from '@/features/timeline/stores/timeline-actions'
export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
export { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
