/**
 * Pure analytic evaluator for motion text (per-unit text animation).
 *
 * Like `motion-modifier-eval.ts`, motion is a deterministic function of the
 * clip-relative frame — no state, no baked keyframes — so preview, scrub and
 * export all agree by construction. All slot math works in ratios of
 * project-fps frame quantities (per-unit progress `= elapsed / duration`,
 * loop phase `= elapsed / cycle`), which is equivalent to converting
 * frames→seconds via fps on both sides: specs authored at different frame
 * rates produce identical states at equivalent wall-clock times.
 *
 * Slot layout on the clip:
 * - **in** occupies the first `duration + stagger·maxRank` frames; the whole
 *   window is uniformly compressed to fit `≤ durationInFrames / 2` so long
 *   staggered reveals on short clips squeeze rather than truncate.
 * - **out** mirrors against the clip end with the same compression.
 * - **loop** runs continuously between the two windows (cycle length =
 *   `durationFrames`, per-unit stagger phase-offsets the cycle start).
 *
 * Out wins wherever the windows would meet: any frame at or past the out
 * window start evaluates the out slot only, with the in slot treated as
 * settled (clamped) — never a blended or glitching intermediate.
 */

import type {
  TextMotionEffect,
  TextMotionOrder,
  TextMotionEasing,
  TextMotionSlot,
  TextMotionSpec,
} from '@/types/text-motion'
import { clamp } from '@/shared/utils/math'
import { easeIn, easeInOut, easeOut } from '@/shared/utils/easing'
import { getTextMotionPreset, type TextMotionChannelContext } from './text-motion-presets'

export interface GlyphMotionState {
  dx: number
  dy: number
  /** Uniform scale about the glyph center. 1 = identity. */
  scale: number
  /** Rotation about the glyph center, radians. */
  rotation: number
  /** Opacity multiplier, 0–1. */
  alpha: number
  /** SDF edge widening (px-ish, rides the shadowBlur band). 0 = crisp. */
  soften: number
}

export interface GlyphMotionContext {
  /** Frame relative to the item start, in project-fps frames. */
  relativeFrame: number
  fps: number
  durationInFrames: number
  unitIndex: number
  unitCount: number
  fontSize: number
  boxWidth: number
  boxHeight: number
}

const IDENTITY: GlyphMotionState = {
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
  alpha: 1,
  soften: 0,
}

function isIdentity(state: GlyphMotionState): boolean {
  return (
    state.dx === 0 &&
    state.dy === 0 &&
    state.scale === 1 &&
    state.rotation === 0 &&
    state.alpha === 1 &&
    state.soften === 0
  )
}

/** Back-out style single overshoot past 1, settling back to exactly 1. */
function overshoot(t: number): number {
  const s = 1.70158
  const u = t - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}

function applyTextMotionEasing(t: number, easing: TextMotionEasing): number {
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return easeIn(t)
    case 'ease-out':
      return easeOut(t)
    case 'ease-in-out':
      return easeInOut(t)
    case 'overshoot':
      return overshoot(t)
    default: {
      const _exhaustive: never = easing
      return _exhaustive
    }
  }
}

/** Mulberry32 PRNG — tiny, deterministic, good enough for order shuffles. */
function mulberry32(seed: number): () => number {
  let a = (seed | 0) + 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * ranks[unitIndex] = firing rank for `order: 'random'`. Deterministic per
 * (unitCount, seed). Memoized because the evaluator runs once per glyph per
 * frame and an O(n) shuffle per glyph would be O(n²) per frame.
 */
const randomRankCache = new Map<string, number[]>()

function randomRanks(unitCount: number, seed: number): number[] {
  const key = `${unitCount}:${seed}`
  const cached = randomRankCache.get(key)
  if (cached) return cached

  const firingOrder = Array.from({ length: unitCount }, (_, i) => i)
  const random = mulberry32(seed)
  for (let i = unitCount - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = firingOrder[i] ?? i
    firingOrder[i] = firingOrder[j] ?? j
    firingOrder[j] = a
  }
  const ranks = new Array<number>(unitCount).fill(0)
  firingOrder.forEach((unit, rank) => {
    ranks[unit] = rank
  })

  if (randomRankCache.size >= 32) {
    // Evict the oldest entry (Map preserves insertion order) rather than
    // flushing the whole cache, so only one entry is recomputed next frame
    // even when many `order: 'random'` clips render at once.
    const oldestKey = randomRankCache.keys().next().value
    if (oldestKey !== undefined) randomRankCache.delete(oldestKey)
  }
  randomRankCache.set(key, ranks)
  return ranks
}

function orderRank(
  order: TextMotionOrder,
  unitIndex: number,
  unitCount: number,
  seed: number,
): number {
  switch (order) {
    case 'forward':
      return unitIndex
    case 'backward':
      return unitCount - 1 - unitIndex
    case 'center':
      // Center-out: symmetric pairs share a rank (0 at the middle).
      return Math.floor(Math.abs(unitIndex - (unitCount - 1) / 2))
    case 'random':
      return randomRanks(unitCount, seed)[unitIndex] ?? unitIndex
    default: {
      const _exhaustive: never = order
      return _exhaustive
    }
  }
}

/** Largest rank the order can produce — bounds the slot window exactly. */
function maxOrderRank(order: TextMotionOrder, unitCount: number): number {
  if (order === 'center') return Math.floor((unitCount - 1) / 2)
  return Math.max(0, unitCount - 1)
}

interface ResolvedSlotWindow {
  /** Per-unit animation length after compression, frames. */
  duration: number
  /** Per-rank stagger after compression, frames. */
  stagger: number
  /** Whole-slot window length (duration + stagger·maxRank), frames. */
  totalWindow: number
}

/**
 * Resolve the slot window, uniformly compressing duration + stagger so the
 * whole window fits within half the clip (squeeze, never truncate).
 */
function resolveSlotWindow(
  effect: TextMotionEffect,
  unitCount: number,
  durationInFrames: number,
): ResolvedSlotWindow {
  const duration = Math.max(0, effect.durationFrames)
  const stagger = Math.max(0, effect.staggerFrames)
  const totalWindow = duration + stagger * maxOrderRank(effect.order, unitCount)
  const maxWindow = durationInFrames / 2
  if (totalWindow > maxWindow && totalWindow > 0) {
    const k = maxWindow / totalWindow
    return { duration: duration * k, stagger: stagger * k, totalWindow: maxWindow }
  }
  return { duration, stagger, totalWindow }
}

function buildChannelContext(
  effect: TextMotionEffect,
  ctx: GlyphMotionContext,
  unitCount: number,
): TextMotionChannelContext {
  return {
    unitIndex: ctx.unitIndex,
    unitCount,
    fontSize: ctx.fontSize,
    boxWidth: ctx.boxWidth,
    boxHeight: ctx.boxHeight,
    intensity: clamp(effect.intensity, 0, 2),
    seed: effect.seed,
  }
}

function finalize(partial: Partial<GlyphMotionState>): GlyphMotionState | null {
  const state: GlyphMotionState = { ...IDENTITY, ...partial }
  return isIdentity(state) ? null : state
}

/**
 * One-shot (in/out) evaluation. `localFrame` is relative to the slot window
 * start. Progress runs 0→1; for in presets 0 = hidden start state, for out
 * presets 0 = settled and 1 = fully exited.
 */
function evaluateOneShot(
  effect: TextMotionEffect,
  localFrame: number,
  window: ResolvedSlotWindow,
  ctx: GlyphMotionContext,
  unitCount: number,
): GlyphMotionState | null {
  const delay = orderRank(effect.order, ctx.unitIndex, unitCount, effect.seed) * window.stagger
  const progress =
    window.duration <= 0
      ? localFrame >= delay
        ? 1
        : 0
      : clamp((localFrame - delay) / window.duration, 0, 1)
  const eased = applyTextMotionEasing(progress, effect.easing)
  const preset = getTextMotionPreset(effect.presetId)
  return finalize(preset.channels(eased, buildChannelContext(effect, ctx, unitCount)))
}

/**
 * Loop evaluation. `durationFrames` is the cycle length; per-unit stagger
 * phase-offsets the cycle start so wave-style presets travel across units.
 * Each unit holds identity until its own cycle begins (phase starts at 0, so
 * sine-based presets enter smoothly). Easing is not applied to loop phase.
 */
function evaluateLoop(
  effect: TextMotionEffect,
  loopStartFrame: number,
  ctx: GlyphMotionContext,
  unitCount: number,
): GlyphMotionState | null {
  const cycle = Math.max(1e-6, effect.durationFrames)
  const delay =
    orderRank(effect.order, ctx.unitIndex, unitCount, effect.seed) *
    Math.max(0, effect.staggerFrames)
  const local = ctx.relativeFrame - loopStartFrame - delay
  if (local <= 0) return null
  const phase = (local / cycle) % 1
  const preset = getTextMotionPreset(effect.presetId)
  return finalize(preset.channels(phase, buildChannelContext(effect, ctx, unitCount)))
}

interface ActiveSlotResolution {
  slot: TextMotionSlot
  effect: TextMotionEffect
  /** Resolved slot window (one-shot slots only, `null` for loop). */
  window: ResolvedSlotWindow | null
  /** Frame the slot takes over: out/in window start, or the loop start. */
  startFrame: number
}

/**
 * Shared slot dispatch — the single source of truth for which slot owns a
 * frame. Out wins wherever windows would meet: at or past the out window
 * start, the in slot is treated as settled and only the out slot evaluates
 * (clamp, never glitch); the in slot owns its window; loop fills the rest.
 * Both {@link evaluateGlyphMotion} and {@link getActiveTextMotionSlot} route
 * through this, so they can never disagree about the dispatch rules.
 */
function resolveActiveSlot(
  spec: TextMotionSpec,
  relativeFrame: number,
  durationInFrames: number,
  unitCount: number,
): ActiveSlotResolution | null {
  if (durationInFrames <= 0) return null

  const outWindow = spec.out ? resolveSlotWindow(spec.out, unitCount, durationInFrames) : null
  if (spec.out && outWindow) {
    const outOffset = Math.min(
      Math.max(0, spec.out.offsetFrames ?? 0),
      Math.max(0, durationInFrames - outWindow.totalWindow),
    )
    const outStart = durationInFrames - outOffset - outWindow.totalWindow
    if (relativeFrame >= outStart) {
      return { slot: 'out', effect: spec.out, window: outWindow, startFrame: outStart }
    }
  }

  const inWindow = spec.in ? resolveSlotWindow(spec.in, unitCount, durationInFrames) : null
  const inOffset =
    spec.in && inWindow
      ? Math.min(
          Math.max(0, spec.in.offsetFrames ?? 0),
          Math.max(0, durationInFrames - inWindow.totalWindow),
        )
      : 0
  if (spec.in && inWindow && relativeFrame < inOffset + inWindow.totalWindow) {
    return { slot: 'in', effect: spec.in, window: inWindow, startFrame: inOffset }
  }

  if (spec.loop) {
    return {
      slot: 'loop',
      effect: spec.loop,
      window: null,
      startFrame: inOffset + (inWindow?.totalWindow ?? 0),
    }
  }

  return null
}

/**
 * Evaluate the motion state for one glyph at one frame. Returns `null` for
 * the identity fast path (glyph is settled — render it exactly as without
 * motion).
 */
export function evaluateGlyphMotion(
  spec: TextMotionSpec,
  ctx: GlyphMotionContext,
): GlyphMotionState | null {
  const unitCount = Math.max(1, ctx.unitCount)
  const active = resolveActiveSlot(spec, ctx.relativeFrame, ctx.durationInFrames, unitCount)
  if (!active) return null
  if (active.window) {
    return evaluateOneShot(
      active.effect,
      ctx.relativeFrame - active.startFrame,
      active.window,
      ctx,
      unitCount,
    )
  }
  return evaluateLoop(active.effect, active.startFrame, ctx, unitCount)
}

/**
 * Which slot contributes at this frame — the same dispatch
 * {@link evaluateGlyphMotion} runs per glyph (shared `resolveActiveSlot`),
 * resolved with the window-maximizing unit count because callers don't know
 * the unit count yet: the glyph pipeline needs the active slot first to pick
 * the segmentation unit that produces the count.
 *
 * Exact whenever a slot's stagger is 0 (the unit count cancels out of the
 * window math). With a stagger the slot's window widens to the half-clip cap,
 * so near window boundaries a frame may be attributed to a slot whose units
 * are already/still settled — but every one-shot window fully covers its real
 * per-unit-count window, so no frame with a non-identity glyph ever maps to
 * `null` (an animation tail is never dropped).
 */
export function getActiveTextMotionSlot(
  spec: TextMotionSpec,
  relativeFrame: number,
  durationInFrames: number,
): TextMotionSlot | null {
  return (
    resolveActiveSlot(spec, relativeFrame, durationInFrames, Number.MAX_SAFE_INTEGER)?.slot ?? null
  )
}

/**
 * Cheap window test for cache bypass (D6). Exact for `stagger === 0`;
 * conservative (may report active slightly past the true window) when a
 * stagger is present, because the exact window depends on the unit count
 * which callers don't know at cache-key time. A false positive only costs a
 * direct render of an already-settled frame — never a stale frame.
 */
export function isTextMotionActive(
  spec: TextMotionSpec,
  relativeFrame: number,
  _fps: number,
  durationInFrames: number,
): boolean {
  if (durationInFrames <= 0 || relativeFrame < 0) return false
  const maxWindow = durationInFrames / 2
  if (spec.loop) return true
  if (spec.in) {
    const offset = Math.max(0, spec.in.offsetFrames ?? 0)
    const upper =
      spec.in.staggerFrames > 0
        ? maxWindow
        : Math.min(Math.max(0, spec.in.durationFrames), maxWindow)
    if (relativeFrame < Math.min(durationInFrames, offset + upper)) return true
  }
  if (spec.out) {
    const offset = Math.max(0, spec.out.offsetFrames ?? 0)
    const upper =
      spec.out.staggerFrames > 0
        ? maxWindow
        : Math.min(Math.max(0, spec.out.durationFrames), maxWindow)
    if (relativeFrame >= Math.max(0, durationInFrames - offset - upper)) return true
  }
  return false
}
