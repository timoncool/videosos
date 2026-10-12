/**
 * Motion-text preset catalog — one entry per id in `text-motion-preset-ids`.
 *
 * A preset is a pure channel builder: eased per-unit progress in, partial
 * {@link GlyphMotionState} out. Travel distances are font-relative
 * (`fontSize` multiples) so presets read the same at any text size; the
 * slide-mask preset travels by `boxWidth` because its whole point is the
 * clip-at-box masked reveal (design D7).
 *
 * Progress conventions:
 * - in presets:  p = 0 → hidden start state, p = 1 → settled (identity).
 * - out presets: p = 0 → settled (identity),  p = 1 → fully exited.
 * - loop presets: p is the raw cycle phase in [0, 1), starting at 0 when the
 *   unit's cycle begins (sine-based presets therefore enter smoothly).
 */

import type { TextMotionEffectBase, TextMotionSlot, TextMotionUnit } from '@/types/text-motion'
import type {
  TextMotionInEffect,
  TextMotionLoopEffect,
  TextMotionOutEffect,
  TextMotionEffect,
} from '@/types/text-motion'
import type { GlyphMotionState } from './evaluate'
import {
  TEXT_MOTION_IN_PRESET_IDS,
  TEXT_MOTION_LOOP_PRESET_IDS,
  TEXT_MOTION_OUT_PRESET_IDS,
  type TextMotionInPresetId,
  type TextMotionLoopPresetId,
  type TextMotionOutPresetId,
  type TextMotionPresetId,
} from './text-motion-preset-ids'

export interface TextMotionChannelContext {
  unitIndex: number
  unitCount: number
  fontSize: number
  boxWidth: number
  boxHeight: number
  /** Effect intensity, clamped to 0–2 by the evaluator. */
  intensity: number
  /** Effect seed (deterministic randomness, e.g. shimmer twinkle phase). */
  seed: number
}

export interface TextMotionPreset {
  id: TextMotionPresetId
  slot: TextMotionSlot
  /** i18n key: `textMotion.presets.<id>`. */
  labelKey: string
  /** Default animation unit for the preset. */
  unit: TextMotionUnit
  /** Default effect parameters (everything but `presetId`). */
  defaults: TextMotionEffectBase
  channels: (easedP: number, ctx: TextMotionChannelContext) => Partial<GlyphMotionState>
}

const TWO_PI = Math.PI * 2

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Hash a seed to [0, 1). The seed is wrapped small before the sin() hash —
 * large/unbounded seeds collapse sin()-based hashes (see WGSL pitfalls memo;
 * the same failure mode applies in JS).
 */
function hash01(seed: number): number {
  const wrapped = ((seed % 4096) + 4096) % 4096
  const x = Math.sin(wrapped * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

const BASE_DEFAULTS: TextMotionEffectBase = {
  durationFrames: 12,
  staggerFrames: 3,
  intensity: 1,
  order: 'forward',
  easing: 'ease-out',
  seed: 0,
}

interface PresetInput {
  id: TextMotionPresetId
  slot: TextMotionSlot
  unit: TextMotionUnit
  defaults?: Partial<TextMotionEffectBase>
  channels: TextMotionPreset['channels']
}

function definePreset(input: PresetInput): TextMotionPreset {
  return {
    id: input.id,
    slot: input.slot,
    labelKey: `textMotion.presets.${input.id}`,
    unit: input.unit,
    defaults: { ...BASE_DEFAULTS, ...input.defaults },
    channels: input.channels,
  }
}

const PRESETS: Record<TextMotionPresetId, TextMotionPreset> = {
  // ── In ────────────────────────────────────────────────────────────────
  typewriter: definePreset({
    id: 'typewriter',
    slot: 'in',
    unit: 'character',
    // Step/hold reveal lives in the channel fn (alpha 0 until p ≥ 1), so
    // typewriter needs no special-casing anywhere else.
    defaults: { durationFrames: 1, staggerFrames: 2, easing: 'linear' },
    channels: (p) => ({ alpha: p >= 1 ? 1 : 0 }),
  }),
  'fade-up': definePreset({
    id: 'fade-up',
    slot: 'in',
    unit: 'word',
    channels: (p, ctx) => ({
      alpha: clamp01(p),
      dy: (1 - p) * 0.25 * ctx.fontSize * ctx.intensity,
    }),
  }),
  rise: definePreset({
    id: 'rise',
    slot: 'in',
    unit: 'word',
    defaults: { durationFrames: 14, staggerFrames: 4 },
    channels: (p, ctx) => ({
      alpha: clamp01(p * 1.5),
      dy: (1 - p) * 0.6 * ctx.fontSize * ctx.intensity,
    }),
  }),
  cascade: definePreset({
    id: 'cascade',
    slot: 'in',
    unit: 'character',
    defaults: { durationFrames: 10, staggerFrames: 1 },
    channels: (p, ctx) => ({
      alpha: clamp01(p),
      dy: -(1 - p) * 0.8 * ctx.fontSize * ctx.intensity,
    }),
  }),
  pop: definePreset({
    id: 'pop',
    slot: 'in',
    unit: 'word',
    defaults: { durationFrames: 10, easing: 'overshoot' },
    channels: (p, ctx) => ({
      alpha: clamp01(p * 2),
      scale: Math.max(0, 1 + (p - 1) * ctx.intensity),
    }),
  }),
  'blur-in': definePreset({
    id: 'blur-in',
    slot: 'in',
    unit: 'word',
    defaults: { durationFrames: 14 },
    channels: (p, ctx) => ({
      alpha: clamp01(p),
      soften: Math.max(0, (1 - p) * 0.4 * ctx.fontSize * ctx.intensity),
    }),
  }),
  'slide-mask': definePreset({
    id: 'slide-mask',
    slot: 'in',
    unit: 'line',
    defaults: { staggerFrames: 5 },
    // Travels by boxWidth so the line enters from the box edge; the text
    // texture clips at the box, giving the masked-reveal look for free.
    channels: (p, ctx) => ({ dx: -(1 - p) * ctx.boxWidth * ctx.intensity }),
  }),
  'wave-in': definePreset({
    id: 'wave-in',
    slot: 'in',
    unit: 'character',
    defaults: { staggerFrames: 1 },
    channels: (p, ctx) => ({
      alpha: clamp01(p),
      dy: (1 - p) * Math.sin(ctx.unitIndex * 0.9) * 0.5 * ctx.fontSize * ctx.intensity,
    }),
  }),

  // ── Out ───────────────────────────────────────────────────────────────
  'fade-down': definePreset({
    id: 'fade-down',
    slot: 'out',
    unit: 'word',
    defaults: { easing: 'ease-in' },
    channels: (p, ctx) => ({
      alpha: clamp01(1 - p),
      dy: p * 0.25 * ctx.fontSize * ctx.intensity,
    }),
  }),
  sink: definePreset({
    id: 'sink',
    slot: 'out',
    unit: 'word',
    defaults: { durationFrames: 14, staggerFrames: 4, easing: 'ease-in' },
    channels: (p, ctx) => ({
      alpha: clamp01(1 - p),
      dy: p * 0.6 * ctx.fontSize * ctx.intensity,
    }),
  }),
  'pop-out': definePreset({
    id: 'pop-out',
    slot: 'out',
    unit: 'word',
    defaults: { durationFrames: 10, easing: 'ease-in' },
    channels: (p, ctx) => ({
      alpha: clamp01(1 - p),
      scale: Math.max(0, 1 - p * ctx.intensity),
    }),
  }),
  'blur-out': definePreset({
    id: 'blur-out',
    slot: 'out',
    unit: 'word',
    defaults: { durationFrames: 14, easing: 'ease-in' },
    channels: (p, ctx) => ({
      alpha: clamp01(1 - p),
      soften: Math.max(0, p * 0.4 * ctx.fontSize * ctx.intensity),
    }),
  }),
  'typewriter-erase': definePreset({
    id: 'typewriter-erase',
    slot: 'out',
    unit: 'character',
    // Reverse reveal: each character stays visible until its step completes.
    // Default backward order erases from the end, like backspacing.
    defaults: { durationFrames: 1, staggerFrames: 2, easing: 'linear', order: 'backward' },
    channels: (p) => ({ alpha: p >= 1 ? 0 : 1 }),
  }),

  // ── Loop ──────────────────────────────────────────────────────────────
  pulse: definePreset({
    id: 'pulse',
    slot: 'loop',
    unit: 'word',
    defaults: { durationFrames: 36, staggerFrames: 0, easing: 'linear' },
    channels: (p, ctx) => ({ scale: 1 + 0.06 * ctx.intensity * Math.sin(TWO_PI * p) }),
  }),
  wave: definePreset({
    id: 'wave',
    slot: 'loop',
    unit: 'character',
    defaults: { durationFrames: 30, staggerFrames: 3, easing: 'linear' },
    channels: (p, ctx) => ({
      dy: 0.18 * ctx.fontSize * ctx.intensity * Math.sin(TWO_PI * p),
    }),
  }),
  shimmer: definePreset({
    id: 'shimmer',
    slot: 'loop',
    unit: 'word',
    defaults: { durationFrames: 24, staggerFrames: 0, easing: 'linear' },
    channels: (p, ctx) => ({
      alpha: clamp01(
        1 -
          0.35 *
            ctx.intensity *
            (0.5 + 0.5 * Math.sin(TWO_PI * (p + hash01(ctx.seed * 31 + ctx.unitIndex)))),
      ),
    }),
  }),
  swing: definePreset({
    id: 'swing',
    slot: 'loop',
    unit: 'character',
    defaults: { durationFrames: 32, staggerFrames: 2, easing: 'linear' },
    channels: (p, ctx) => ({ rotation: 0.09 * ctx.intensity * Math.sin(TWO_PI * p) }),
  }),
}

export function getTextMotionPreset(presetId: TextMotionPresetId): TextMotionPreset {
  return PRESETS[presetId]
}

/**
 * Build a full effect record for a preset (defaults + seed). Pass a
 * random-ish seed for `order: 'random'` / shimmer variety; defaults to 0.
 */
export function createTextMotionEffect(
  presetId: TextMotionInPresetId,
  seed?: number,
): TextMotionInEffect
export function createTextMotionEffect(
  presetId: TextMotionOutPresetId,
  seed?: number,
): TextMotionOutEffect
export function createTextMotionEffect(
  presetId: TextMotionLoopPresetId,
  seed?: number,
): TextMotionLoopEffect
export function createTextMotionEffect(
  presetId: TextMotionPresetId,
  seed?: number,
): TextMotionEffect
export function createTextMotionEffect(presetId: TextMotionPresetId, seed = 0): TextMotionEffect {
  const preset = getTextMotionPreset(presetId)
  // The id unions guarantee the presetId matches its slot's effect type; the
  // cast just recombines what the overloads keep separate.
  return { ...preset.defaults, presetId, seed } as TextMotionEffect
}

/** Per-slot preset lists for the UI, in catalog order. */
export const TEXT_MOTION_IN_PRESETS: readonly TextMotionPreset[] = TEXT_MOTION_IN_PRESET_IDS.map(
  (id) => PRESETS[id],
)
export const TEXT_MOTION_OUT_PRESETS: readonly TextMotionPreset[] = TEXT_MOTION_OUT_PRESET_IDS.map(
  (id) => PRESETS[id],
)
export const TEXT_MOTION_LOOP_PRESETS: readonly TextMotionPreset[] =
  TEXT_MOTION_LOOP_PRESET_IDS.map((id) => PRESETS[id])
