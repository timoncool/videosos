/**
 * Channel downmixing to the export channel count, and the additive mix buffer
 * every processed segment is folded into.
 */

import { createLogger } from '@/shared/logging/logger'
import type { AudioProcessingConfig } from './types'

const log = createLogger('CanvasAudio/mixdown')

/**
 * Downmix a multi-channel decoded source to the target channel count using
 * the ITU-R BS.775 / Dolby Pro Logic II coefficients. Standard channel
 * order from mediabunny (and the FFmpeg-backed AC-3/E-AC-3 decoder) is
 * `L, R, C, LFE, Ls, Rs` for 5.1 and `L, R, C, LFE, Ls, Rs, Lr, Rr` for
 * 7.1.
 *
 * Without this, a 5.1 EAC3 source going to a stereo export was dropping
 * the center channel — meaning all the dialogue was missing from the
 * exported audio while music + effects on L/R sounded thin.
 *
 * If the source already has the same channel count as the output, samples
 * are returned untouched. If the source has fewer channels (e.g. mono into
 * stereo) the lone channel is duplicated.
 */
export function downmixToOutputChannels(
  source: readonly Float32Array[],
  outputChannels: number,
): Float32Array[] {
  if (source.length === 0) return []
  if (source.length === outputChannels) return source.map((c) => c)

  // Mono source going into multi-channel output: duplicate.
  if (source.length === 1) {
    const mono = source[0]!
    const out: Float32Array[] = []
    for (let c = 0; c < outputChannels; c++) out.push(mono)
    return out
  }

  // Stereo output is the common case for export — handle it directly.
  if (outputChannels === 2) {
    return downmixToStereo(source)
  }

  // Mono output: average all source channels with center/LFE attenuation.
  if (outputChannels === 1) {
    const stereo = downmixToStereo(source)
    const length = stereo[0]!.length
    const merged = new Float32Array(length)
    const left = stereo[0]!
    const right = stereo[1]!
    for (let i = 0; i < length; i++) {
      merged[i] = (left[i]! + right[i]!) * 0.5
    }
    return [merged]
  }

  // Unrecognised target — slice to the requested channels and pad with
  // silence; the prior behavior. Real broadcast targets stop at stereo
  // here, so this branch is just defensive.
  const out: Float32Array[] = []
  for (let c = 0; c < outputChannels; c++) {
    out.push(source[c] ?? new Float32Array(source[0]!.length))
  }
  return out
}

const SQRT_HALF = Math.SQRT1_2 // ≈ 0.7071068

function downmixToStereo(source: readonly Float32Array[]): Float32Array[] {
  // Mediabunny 5.1 / 7.1 channel order (FFmpeg standard):
  //   0 L, 1 R, 2 C, 3 LFE, 4 Ls, 5 Rs, [6 Lr, 7 Rr]
  // Stereo downmix coefficients (ITU-R BS.775 / Dolby):
  //   Lo = L + sqrt(0.5)·C + sqrt(0.5)·Ls (+ surround back if 7.1)
  //   Ro = R + sqrt(0.5)·C + sqrt(0.5)·Rs
  // LFE is dropped — re-mixing it into stereo without bandlimiting causes
  // muddy bass. Matches Dolby's recommended Lo/Ro downmix.
  const [L, R, C, _LFE, Ls, Rs, Lr, Rr] = source
  const length = L?.length ?? R?.length ?? 0
  if (length === 0) return [new Float32Array(0), new Float32Array(0)]

  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let lo = L?.[i] ?? 0
    let ro = R?.[i] ?? 0
    const c = C?.[i]
    if (c !== undefined) {
      lo += SQRT_HALF * c
      ro += SQRT_HALF * c
    }
    const ls = Ls?.[i]
    if (ls !== undefined) lo += SQRT_HALF * ls
    const rs = Rs?.[i]
    if (rs !== undefined) ro += SQRT_HALF * rs
    const lr = Lr?.[i]
    if (lr !== undefined) lo += SQRT_HALF * lr
    const rr = Rr?.[i]
    if (rr !== undefined) ro += SQRT_HALF * rr
    left[i] = lo
    right[i] = ro
  }
  return [left, right]
}

/**
 * Mix multiple audio tracks together.
 *
 * @param segments - Processed audio segments with timing
 * @param config - Audio processing configuration
 * @returns Mixed stereo audio samples
 */
export function createAudioMixBuffer(config: AudioProcessingConfig): Float32Array[] {
  const { sampleRate, channels, fps, totalFrames } = config
  const totalSamples = Math.ceil((totalFrames / fps) * sampleRate)
  const output: Float32Array[] = []
  for (let c = 0; c < channels; c++) {
    output.push(new Float32Array(totalSamples))
  }
  return output
}

export function mixAudioSegmentInto(
  output: Float32Array[],
  segment: { samples: Float32Array[]; startSample: number },
  config: AudioProcessingConfig,
): void {
  const { channels } = config
  const totalSamples = output[0]?.length ?? 0
  const downmixed = downmixToOutputChannels(segment.samples, channels)

  for (let c = 0; c < channels; c++) {
    const channelSamples = downmixed[c]!
    const outputChannel = output[c]!
    const sourceStart = Math.max(0, -segment.startSample)
    const sourceEnd = Math.min(channelSamples.length, totalSamples - segment.startSample)
    for (let i = sourceStart; i < sourceEnd; i++) {
      const outputIndex = segment.startSample + i
      outputChannel[outputIndex] = outputChannel[outputIndex]! + channelSamples[i]!
    }
  }
}

export function softClipAudioMix(output: Float32Array[]): void {
  // Soft-clip to prevent harsh digital clipping while preserving overall loudness.
  // This matches browser preview behavior where audio peaks are naturally saturated
  // rather than the entire mix being reduced in volume.
  let clippedSamples = 0
  for (const channel of output) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i]
      if (sample !== undefined && Math.abs(sample) > 1.0) {
        // tanh soft limiter: smoothly compresses peaks above 1.0
        channel[i] = Math.tanh(sample)
        clippedSamples++
      }
    }
  }
  if (clippedSamples > 0) {
    log.debug('Soft-clipped audio peaks', { clippedSamples })
  }
}
