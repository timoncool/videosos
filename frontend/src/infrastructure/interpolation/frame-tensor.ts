/**
 * Frame helpers specific to the RIFE interpolator. The packed-RGBA <-> planar-float conversions
 * are shared with the upscaler and live in `@/shared/utils/planar-rgb`.
 */

import { planarRgbLength } from '@/shared/utils/planar-rgb'

/**
 * Whether any channel of any pixel moved by more than `threshold`.
 *
 * Returns on the first pixel that moved, so footage in motion pays only for the leading
 * static region. A negative threshold reports a difference unconditionally.
 */
export function framesDiffer(a: Float32Array, b: Float32Array, threshold: number): boolean {
  if (a.length !== b.length) {
    throw new Error(`framesDiffer: length mismatch, ${a.length} vs ${b.length}`)
  }
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > threshold) return true
  }
  return false
}

/**
 * Stack two planar RGB frames into the `[1, 6, H, W]` input tensor: `left` occupies
 * channels 0-2, `right` channels 3-5.
 */
export function concatPlanarPair(
  left: Float32Array,
  right: Float32Array,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const planeCount = planarRgbLength(width, height)
  if (left.length < planeCount || right.length < planeCount) {
    throw new Error('concatPlanarPair: operand shorter than one planar RGB frame')
  }
  const dst = out ?? new Float32Array(planeCount * 2)
  dst.set(left.subarray(0, planeCount), 0)
  dst.set(right.subarray(0, planeCount), planeCount)
  return dst
}
