/**
 * Fill the gap between two consecutive source frames with `factor - 1` synthesized frames.
 *
 * The model takes a timestep, so every intermediate is produced directly from the two source
 * frames. There is no dependency chain between them and nothing is fed back as an operand.
 * Reaching a given phase directly and by recursive halving measure within +/-0.2 dB of each
 * other on real footage, with no consistent winner, so the flat schedule wins on simplicity.
 */

import { framesDiffer } from './frame-tensor'
import type { InterpolationFactor } from './interpolation-factor'
import { isSupportedInterpolationFactor } from './interpolation-factor'

/** Synthesizes the frame at `timestep` of the way from `left` to `right`, exclusive of both. */
export type PhaseInterpolator = (
  left: Float32Array,
  right: Float32Array,
  timestep: number,
) => Promise<Float32Array>

/**
 * How far a channel must move for a gap to count as animated, in [0,1] units — just under one
 * step of an 8-bit channel, so codec noise on a locked-off shot does not defeat the skip.
 */
const STATIC_GAP_THRESHOLD = 3 / 255

/**
 * Returns the intermediates in output order: index 0 is the frame closest to `left`. Neither
 * source frame is included.
 *
 * When nothing in the gap moved, the interpolator is skipped entirely and every returned frame
 * aliases `left` — a screencast or a locked-off shot then costs no inference at all. Callers
 * must therefore treat the results as read-only. Pass a negative `staticThreshold` to force
 * every frame through the interpolator.
 */
export async function interpolateGap(
  left: Float32Array,
  right: Float32Array,
  factor: InterpolationFactor,
  interpolate: PhaseInterpolator,
  staticThreshold: number = STATIC_GAP_THRESHOLD,
): Promise<Float32Array[]> {
  if (!isSupportedInterpolationFactor(factor)) {
    throw new Error(`Unsupported interpolation factor: ${factor}`)
  }

  if (!framesDiffer(left, right, staticThreshold)) {
    return new Array<Float32Array>(factor - 1).fill(left)
  }

  const frames: Float32Array[] = []
  for (let k = 1; k < factor; k++) {
    frames.push(await interpolate(left, right, k / factor))
  }
  return frames
}
