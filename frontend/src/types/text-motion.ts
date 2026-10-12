import type {
  TextMotionInPresetId,
  TextMotionLoopPresetId,
  TextMotionOutPresetId,
} from '@/shared/typography/text-motion/text-motion-preset-ids'

/**
 * Motion text: per-character / per-word / per-line text animation.
 *
 * Like `MotionModifier` (src/types/motion.ts), this is a small parametric
 * record evaluated analytically at render time inside the GPU glyph-atlas
 * text pipeline — never baked into keyframes. The evaluator lives in
 * `@/shared/typography/text-motion`.
 *
 * Design doc: docs/plans/2026-07-03-001-feat-motion-text-plan.md
 */

export type TextMotionUnit = 'character' | 'word' | 'line' | 'whole-clip'

export type TextMotionOrder = 'forward' | 'backward' | 'center' | 'random'

/**
 * Deliberately a small closed set (not the full keyframe easing model):
 * per-unit reveals read best with simple curves, and `overshoot` covers the
 * springy pop look without spring parameter plumbing.
 */
export type TextMotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'overshoot'

export type TextMotionSlot = 'in' | 'out' | 'loop'

export interface TextMotionEffectBase {
  /**
   * Per-unit animation length in project-fps frames. For the `loop` slot this
   * is the cycle length (frequency semantics) rather than a one-shot window.
   */
  durationFrames: number
  /**
   * Gap between the clip edge and a one-shot animation, in project-fps
   * frames. IN uses the leading edge; OUT uses the trailing edge. Omitted is
   * equivalent to zero. LOOP ignores this field.
   */
  offsetFrames?: number
  /** Delay between consecutive units starting, in project-fps frames. */
  staggerFrames: number
  /** Intensity multiplier (0–2). Scales the preset's travel/scale/rotation. */
  intensity: number
  order: TextMotionOrder
  easing: TextMotionEasing
  /** Deterministic seed for `order: 'random'` shuffles and shimmer twinkle. */
  seed: number
  /**
   * Animation unit override. When omitted the preset's default unit is used
   * (`getTextMotionPreset(presetId).unit`). `whole-clip` animates the entire
   * text block as one unit — the parametric replacement for the retired
   * whole-clip keyframe Intro/Outro presets.
   */
  unit?: TextMotionUnit
}

export interface TextMotionInEffect extends TextMotionEffectBase {
  presetId: TextMotionInPresetId
}

export interface TextMotionOutEffect extends TextMotionEffectBase {
  presetId: TextMotionOutPresetId
}

export interface TextMotionLoopEffect extends TextMotionEffectBase {
  presetId: TextMotionLoopPresetId
}

export type TextMotionEffect = TextMotionInEffect | TextMotionOutEffect | TextMotionLoopEffect

/** Independent In / Out / Loop slots, all optional. */
export interface TextMotionSpec {
  in?: TextMotionInEffect
  out?: TextMotionOutEffect
  loop?: TextMotionLoopEffect
}
