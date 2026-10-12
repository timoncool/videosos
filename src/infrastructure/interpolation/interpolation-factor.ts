/**
 * Frame-rate multipliers the UI offers.
 *
 * Any integer would work — the model takes a timestep, so a frame at any phase costs one
 * inference (see `rife-interpolator.ts`). The ceiling is a quality judgement, not a capability
 * limit: each step up invents another frame from the same pair of source frames, and on fast
 * motion reconstruction accuracy falls off sharply past 8x.
 */
export const SUPPORTED_INTERPOLATION_FACTORS = [2, 3, 4, 5, 6, 7, 8] as const

export type InterpolationFactor = (typeof SUPPORTED_INTERPOLATION_FACTORS)[number]

export function isSupportedInterpolationFactor(value: number): value is InterpolationFactor {
  return (SUPPORTED_INTERPOLATION_FACTORS as readonly number[]).includes(value)
}
