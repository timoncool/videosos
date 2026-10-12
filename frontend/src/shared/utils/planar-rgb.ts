/**
 * Conversions between packed 8-bit RGBA (what canvases and `VideoFrame`s give us) and the planar
 * float RGB layout that ONNX vision graphs expect.
 *
 * Planar RGB is the currency of our ML frame pipelines, not just their input format: both the RIFE
 * interpolator and the Anime4K upscaler emit `[1, 3, H, W]` float, so a synthesized frame never
 * round-trips through 8 bits before it is encoded.
 *
 * Layout: `value(c, y, x) = data[c * H * W + y * W + x]`, channels R,G,B, range [0, 1].
 */

/** Number of floats in a planar RGB frame. */
export function planarRgbLength(width: number, height: number): number {
  return 3 * width * height
}

export function rgbaToPlanarRgb(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const pixels = width * height
  if (rgba.length < pixels * 4) {
    throw new Error(`rgbaToPlanarRgb: expected ${pixels * 4} bytes, got ${rgba.length}`)
  }
  const dst = out ?? new Float32Array(3 * pixels)

  // Plane views + a reciprocal multiply: this runs 921k times per 720p frame, so the
  // per-element offset arithmetic and the divide both show up in a profile.
  const r = dst.subarray(0, pixels)
  const g = dst.subarray(pixels, pixels * 2)
  const b = dst.subarray(pixels * 2, pixels * 3)
  const inv = 1 / 255
  for (let i = 0, s = 0; i < pixels; i++, s += 4) {
    r[i] = rgba[s]! * inv
    g[i] = rgba[s + 1]! * inv
    b[i] = rgba[s + 2]! * inv
  }
  return dst
}

export function planarRgbToRgba(
  planar: Float32Array,
  width: number,
  height: number,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const pixels = width * height
  if (planar.length < 3 * pixels) {
    throw new Error(`planarRgbToRgba: expected ${3 * pixels} floats, got ${planar.length}`)
  }
  const dst = out ?? new Uint8ClampedArray(pixels * 4)

  const r = planar.subarray(0, pixels)
  const g = planar.subarray(pixels, pixels * 2)
  const b = planar.subarray(pixels * 2, pixels * 3)
  for (let i = 0, d = 0; i < pixels; i++, d += 4) {
    // Uint8ClampedArray clamps to [0,255] and rounds on assignment, which is exactly the
    // saturation these unbounded model outputs need — both overshoot slightly past 0 and 1.
    dst[d] = r[i]! * 255
    dst[d + 1] = g[i]! * 255
    dst[d + 2] = b[i]! * 255
    dst[d + 3] = 255
  }
  return dst
}
