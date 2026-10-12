import { UPSCALE_FACTOR } from './upscale-variant'

/**
 * Ceilings on the *output* of an upscale, not the input.
 *
 * A 2x upscale of 4K source is 7680x4320, which no WebCodecs H.264 or HEVC encoder configuration
 * we can rely on will accept — the level limits top out well below it. Rather than render for
 * minutes and fail at `configure()`, refuse up front and say so.
 *
 * 4096 is the per-dimension ceiling most hardware encoders share; the pixel budget separately keeps
 * an extreme aspect ratio (a 7000x400 banner, say) from sliding under it.
 */
export const UPSCALE_MAX_OUTPUT_DIMENSION = 4096
export const UPSCALE_MAX_OUTPUT_PIXELS = 3840 * 2160

export interface UpscaleSize {
  width: number
  height: number
}

export function upscaledSize(width: number, height: number): UpscaleSize {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`upscaledSize: invalid source size ${width}x${height}`)
  }
  return { width: width * UPSCALE_FACTOR, height: height * UPSCALE_FACTOR }
}

/**
 * Whether a source of this size produces an encodable output. Both dimensions double, and the
 * result is always even, so encoders that reject odd dimensions are satisfied by construction.
 */
export function canUpscale(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return false
  }
  const out = upscaledSize(width, height)
  return (
    out.width <= UPSCALE_MAX_OUTPUT_DIMENSION &&
    out.height <= UPSCALE_MAX_OUTPUT_DIMENSION &&
    out.width * out.height <= UPSCALE_MAX_OUTPUT_PIXELS
  )
}
