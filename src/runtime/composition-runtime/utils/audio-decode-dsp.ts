/**
 * Pure audio decode DSP — no AudioBuffer, no storage, no DOM.
 *
 * These helpers operate purely on TypedArrays so they can run in a Web Worker
 * (where `AudioBuffer`/`OfflineAudioContext` are not available) as well as on
 * the main thread. The main-thread decode path and the worker decode path both
 * import from here so their bin output stays byte-identical.
 */

export interface DecodedAudioBinData {
  binIndex: number
  frames: number
  sampleRate: number
  left: Int16Array
  right: Int16Array
}

export interface StereoChannels {
  left: Float32Array
  right: Float32Array
  frames: number
  sampleRate: number
}

const INT16_NEG_SCALE = 1 / 0x8000
const INT16_POS_SCALE = 1 / 0x7fff

export function float32ToInt16(float32: Float32Array): Int16Array {
  const n = float32.length
  const int16 = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

export function int16ToFloat32(int16: Int16Array): Float32Array {
  const n = int16.length
  const float32 = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = int16[i]!
    float32[i] = s < 0 ? s * INT16_NEG_SCALE : s * INT16_POS_SCALE
  }
  return float32
}

/**
 * Dequantize Int16 samples straight into a destination Float32 buffer at the
 * given offset. Avoids the throwaway Float32Array allocation (and the second
 * copy) that `int16ToFloat32` + `Float32Array.set` pays when filling a larger
 * channel buffer bin-by-bin — both the allocation churn and the extra pass show
 * up on the AudioBuffer-assembly hot path.
 */
export function int16ToFloat32Into(int16: Int16Array, dst: Float32Array, dstOffset: number): void {
  const n = int16.length
  for (let i = 0; i < n; i++) {
    const s = int16[i]!
    dst[dstOffset + i] = s < 0 ? s * INT16_NEG_SCALE : s * INT16_POS_SCALE
  }
}

/**
 * Downmix N-channel audio to stereo using standard ITU-R BS.775 coefficients.
 * 5.1 layout: L R C LFE Ls Rs
 * 7.1 layout: L R C LFE Ls Rs Lrs Rrs (rear surrounds folded into Ls/Rs)
 *
 * For mono/stereo input, returns the data unchanged (or duplicated for mono).
 */
export function downmixToStereo(
  channels: Float32Array[],
  totalFrames: number,
): { left: Float32Array; right: Float32Array } {
  const numCh = channels.length

  if (numCh <= 2) {
    const left = channels[0] ?? new Float32Array(totalFrames)
    const right = channels[1] ?? left
    return { left, right }
  }

  // ITU coefficients for 5.1 downmix
  const centerGain = 0.7071 // -3 dB
  const lfeGain = 0 // discard LFE for preview
  const surroundGain = 0.7071

  const left = new Float32Array(totalFrames)
  const right = new Float32Array(totalFrames)

  const L = channels[0]!
  const R = channels[1]!
  const C = channels[2]
  const LFE = channels[3] // used with lfeGain (0)
  const Ls = channels[4]
  const Rs = channels[5]
  // 7.1 rear surrounds (fold into Ls/Rs)
  const Lrs = channels[6]
  const Rrs = channels[7]

  for (let i = 0; i < totalFrames; i++) {
    let l = L[i]!
    let r = R[i]!

    if (C) {
      const c = C[i]! * centerGain
      l += c
      r += c
    }
    if (lfeGain !== 0 && LFE) {
      const lfe = LFE[i]! * lfeGain
      l += lfe
      r += lfe
    }
    if (Ls) l += Ls[i]! * surroundGain
    if (Rs) r += Rs[i]! * surroundGain
    if (Lrs) l += Lrs[i]! * surroundGain
    if (Rrs) r += Rrs[i]! * surroundGain

    left[i] = l
    right[i] = r
  }

  return { left, right }
}

export function assembleChannelChunks(chunks: Float32Array[], totalFrames: number): Float32Array {
  const result = new Float32Array(totalFrames)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function resampleChannel(
  input: Float32Array,
  output: Float32Array,
  ratio: number,
  targetFrames: number,
): void {
  for (let i = 0; i < targetFrames; i++) {
    const srcPos = i / ratio
    const idx = Math.floor(srcPos)
    const frac = srcPos - idx
    const s0 = input[idx] ?? 0
    const s1 = input[idx + 1] ?? s0
    output[i] = s0 + (s1 - s0) * frac
  }
}

/**
 * Downsample a stereo pair via manual linear interpolation — ~10x faster than
 * OfflineAudioContext for preview-quality downsampling (22050 Hz). Anti-aliasing
 * is handled by the Nyquist limit at the target rate.
 *
 * When the source is already at or below the target rate, the inputs are
 * returned unchanged at the source rate.
 */
export function downsampleStereo(
  left: Float32Array,
  right: Float32Array,
  sourceRate: number,
  targetRate: number,
): StereoChannels {
  if (sourceRate <= targetRate) {
    return { left, right, frames: left.length, sampleRate: sourceRate }
  }

  const ratio = targetRate / sourceRate
  const sourceFrames = left.length
  const targetFrames = Math.ceil(sourceFrames * ratio)
  const outLeft = new Float32Array(targetFrames)
  const outRight = new Float32Array(targetFrames)
  resampleChannel(left, outLeft, ratio, targetFrames)
  resampleChannel(right, outRight, ratio, targetFrames)
  return { left: outLeft, right: outRight, frames: targetFrames, sampleRate: targetRate }
}

/** Assemble accumulated chunks into a stereo pair and downsample to the target rate. */
export function buildDownsampledStereo(
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  totalFrames: number,
  sourceRate: number,
  targetRate: number,
): StereoChannels {
  const left = assembleChannelChunks(leftChunks, totalFrames)
  const right = assembleChannelChunks(rightChunks, totalFrames)
  return downsampleStereo(left, right, sourceRate, targetRate)
}

/** Build one persisted bin (downsampled, Int16) from accumulated decode chunks. */
export function produceDecodedBin(
  binIndex: number,
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  frames: number,
  sourceRate: number,
  targetRate: number,
): DecodedAudioBinData {
  const ds = buildDownsampledStereo(leftChunks, rightChunks, frames, sourceRate, targetRate)
  return {
    binIndex,
    frames: ds.frames,
    sampleRate: ds.sampleRate,
    left: float32ToInt16(ds.left),
    right: float32ToInt16(ds.right),
  }
}
