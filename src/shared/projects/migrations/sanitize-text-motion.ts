/**
 * Motion-text spec sanitizer.
 *
 * Pure validation/clamping for `TextItem.textMotion` (see
 * src/types/text-motion.ts). Used by the v12 versioned migration and by the
 * per-load normalization pass so a malformed or hand-edited spec can never
 * reach the evaluator/renderer.
 *
 * Rules:
 * - Non-object spec → `undefined`
 * - Unknown/malformed slot value → drop that slot
 * - `presetId` not in the slot's preset id list → drop that slot
 * - Numerics clamped: durationFrames int ≥ 1, optional offsetFrames int ≥ 0,
 *   staggerFrames int ≥ 0,
 *   intensity 0–2, seed finite int — defaults applied when missing/invalid
 * - `order` / `easing` outside their enums → 'forward' / 'ease-out'
 * - `unit` outside its enum (or absent) → dropped (preset default applies)
 * - Spec with no surviving slots → `undefined`
 */

import type {
  TextMotionEasing,
  TextMotionEffectBase,
  TextMotionOrder,
  TextMotionSpec,
  TextMotionUnit,
} from '@/types/text-motion'
import {
  TEXT_MOTION_IN_PRESET_IDS,
  TEXT_MOTION_LOOP_PRESET_IDS,
  TEXT_MOTION_OUT_PRESET_IDS,
} from '@/shared/typography/text-motion/text-motion-preset-ids'

const TEXT_MOTION_ORDERS: readonly TextMotionOrder[] = ['forward', 'backward', 'center', 'random']
const TEXT_MOTION_EASINGS: readonly TextMotionEasing[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'overshoot',
]
const TEXT_MOTION_UNITS: readonly TextMotionUnit[] = ['character', 'word', 'line', 'whole-clip']

const DEFAULT_DURATION_FRAMES = 12
const DEFAULT_STAGGER_FRAMES = 0
const DEFAULT_INTENSITY = 1
const DEFAULT_SEED = 0

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampFrameCount(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.round(value))
}

function clampIntensity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_INTENSITY
  return Math.max(0, Math.min(2, value))
}

function sanitizeSeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SEED
  return Math.round(value)
}

function sanitizeOrder(value: unknown): TextMotionOrder {
  return TEXT_MOTION_ORDERS.includes(value as TextMotionOrder)
    ? (value as TextMotionOrder)
    : 'forward'
}

function sanitizeEasing(value: unknown): TextMotionEasing {
  return TEXT_MOTION_EASINGS.includes(value as TextMotionEasing)
    ? (value as TextMotionEasing)
    : 'ease-out'
}

/** Optional unit override: keep only valid values; anything else → undefined
 * (so the preset's default unit applies). */
function sanitizeUnit(value: unknown): TextMotionUnit | undefined {
  return TEXT_MOTION_UNITS.includes(value as TextMotionUnit) ? (value as TextMotionUnit) : undefined
}

function sanitizeSlot<Id extends string>(
  value: unknown,
  validPresetIds: readonly Id[],
): (TextMotionEffectBase & { presetId: Id }) | undefined {
  if (!isPlainObject(value)) return undefined
  const presetId = value.presetId
  if (typeof presetId !== 'string' || !(validPresetIds as readonly string[]).includes(presetId)) {
    return undefined
  }
  const unit = sanitizeUnit(value.unit)
  const offsetFrames = clampFrameCount(value.offsetFrames, 0, 0)
  return {
    presetId: presetId as Id,
    durationFrames: clampFrameCount(value.durationFrames, 1, DEFAULT_DURATION_FRAMES),
    ...(offsetFrames > 0 ? { offsetFrames } : {}),
    staggerFrames: clampFrameCount(value.staggerFrames, 0, DEFAULT_STAGGER_FRAMES),
    intensity: clampIntensity(value.intensity),
    order: sanitizeOrder(value.order),
    easing: sanitizeEasing(value.easing),
    seed: sanitizeSeed(value.seed),
    ...(unit ? { unit } : {}),
  }
}

/**
 * Sanitize an unknown value into a valid `TextMotionSpec`, or `undefined`
 * when nothing valid survives. Pure — never throws, never mutates input.
 */
export function sanitizeTextMotion(value: unknown): TextMotionSpec | undefined {
  if (!isPlainObject(value)) return undefined

  const spec: TextMotionSpec = {}
  const inEffect = sanitizeSlot(value.in, TEXT_MOTION_IN_PRESET_IDS)
  if (inEffect) spec.in = inEffect
  const outEffect = sanitizeSlot(value.out, TEXT_MOTION_OUT_PRESET_IDS)
  if (outEffect) spec.out = outEffect
  const loopEffect = sanitizeSlot(value.loop, TEXT_MOTION_LOOP_PRESET_IDS)
  if (loopEffect) spec.loop = loopEffect

  if (!spec.in && !spec.out && !spec.loop) return undefined
  return spec
}
