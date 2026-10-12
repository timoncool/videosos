/**
 * Motion-text preset ids, split by slot. Kept in a leaf module (like
 * `text-style-preset-ids.ts`) so `src/types/*` can reference the unions
 * without pulling in the preset catalog implementation.
 */

export const TEXT_MOTION_IN_PRESET_IDS = [
  'typewriter',
  'fade-up',
  'rise',
  'cascade',
  'pop',
  'blur-in',
  'slide-mask',
  'wave-in',
] as const

export const TEXT_MOTION_OUT_PRESET_IDS = [
  'fade-down',
  'sink',
  'pop-out',
  'blur-out',
  'typewriter-erase',
] as const

export const TEXT_MOTION_LOOP_PRESET_IDS = ['pulse', 'wave', 'shimmer', 'swing'] as const

export type TextMotionInPresetId = (typeof TEXT_MOTION_IN_PRESET_IDS)[number]
export type TextMotionOutPresetId = (typeof TEXT_MOTION_OUT_PRESET_IDS)[number]
export type TextMotionLoopPresetId = (typeof TEXT_MOTION_LOOP_PRESET_IDS)[number]

export type TextMotionPresetId =
  | TextMotionInPresetId
  | TextMotionOutPresetId
  | TextMotionLoopPresetId
