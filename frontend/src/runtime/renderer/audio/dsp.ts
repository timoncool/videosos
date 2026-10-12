/**
 * Per-sample DSP: gain, animated volume, fades, time-stretch and resampling.
 */

import type { Keyframe as VolumeKeyframe } from '@/types/keyframe'
import { createLogger } from '@/shared/logging/logger'
import { interpolatePropertyValue } from '@/runtime/renderer/deps/keyframes-contract'
import {
  evaluateAudioFadeInCurve,
  evaluateAudioFadeOutCurve,
  type AudioClipFadeSpan,
} from '@/shared/utils/audio-fade-curve'
import {
  getAudioPitchRatioFromSemitones,
  isAudioPitchShiftActive,
} from '@/shared/utils/audio-pitch'

const log = createLogger('CanvasAudio/dsp')

/**
 * Convert dB to linear gain.
 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * Apply volume (in dB) to audio samples.
 */
export function applyVolume(samples: Float32Array, volumeDb: number): Float32Array {
  const gain = dbToGain(volumeDb)
  const output = new Float32Array(samples.length)

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i]! * gain
  }

  return output
}

/**
 * Apply animated volume envelope from keyframes to audio samples.
 * Interpolates dB value per-frame and applies per-sample gain.
 *
 * @param samples - Audio samples for one channel
 * @param volumeKeyframes - Volume keyframes (frame-relative to item start)
 * @param staticVolumeDb - Static volume dB fallback
 * @param segmentStartFrame - Timeline frame where this segment starts
 * @param itemFrom - Timeline frame where the original item starts
 * @param fps - Frames per second
 * @param sampleRate - Audio sample rate
 */
export function applyAnimatedVolume(
  samples: Float32Array,
  volumeKeyframes: VolumeKeyframe[],
  staticVolumeDb: number,
  segmentStartFrame: number,
  itemFrom: number,
  fps: number,
  sampleRate: number,
): Float32Array {
  const output = new Float32Array(samples.length)

  for (let i = 0; i < samples.length; i++) {
    // Convert sample index to timeline frame
    const timelineFrame = segmentStartFrame + (i / sampleRate) * fps
    // Convert to item-relative frame for keyframe interpolation
    const relativeFrame = timelineFrame - itemFrom
    const db = interpolatePropertyValue(volumeKeyframes, relativeFrame, staticVolumeDb)
    const gain = dbToGain(db)
    output[i] = samples[i]! * gain
  }

  return output
}

/**
 * Apply fade in/out to audio samples.
 *
 * @param samples - Audio samples
 * @param fadeInSamples - Number of samples for fade in
 * @param fadeOutSamples - Number of samples for fade out
 * @param useEqualPower - Use equal-power (sin/cos) fades for smoother crossfades
 */
export function applyFades(
  samples: Float32Array,
  fadeInSamples: number,
  fadeOutSamples: number,
  useEqualPower: boolean = false,
  fadeInCurve: number = 0,
  fadeOutCurve: number = 0,
  fadeInCurveX: number = 0.52,
  fadeOutCurveX: number = 0.52,
  contentStartOffsetSamples: number = 0,
  contentEndOffsetSamples: number = 0,
  fadeInDelaySamples: number = 0,
  fadeOutLeadSamples: number = 0,
): Float32Array {
  const output = new Float32Array(samples.length)
  output.set(samples)
  const contentStart = Math.max(
    0,
    Math.min(contentStartOffsetSamples + Math.max(0, fadeInDelaySamples), output.length),
  )
  const contentEnd = Math.max(
    contentStart,
    output.length - Math.max(0, contentEndOffsetSamples + Math.max(0, fadeOutLeadSamples)),
  )
  const contentLength = Math.max(0, contentEnd - contentStart)

  // Apply fade in
  if (fadeInSamples > 0) {
    for (let i = 0; i < contentStart && i < output.length; i++) {
      output[i] = 0
    }
    for (let i = 0; i < fadeInSamples && i < contentLength; i++) {
      const sampleIndex = contentStart + i
      const progress = i / fadeInSamples
      const gain = useEqualPower
        ? Math.sin((progress * Math.PI) / 2)
        : evaluateAudioFadeInCurve(progress, fadeInCurve, fadeInCurveX)
      output[sampleIndex] = output[sampleIndex]! * gain
    }
  }

  // Apply fade out
  if (fadeOutSamples > 0) {
    const fadeOutStart = Math.max(contentStart, contentEnd - fadeOutSamples)
    for (let i = 0; i < fadeOutSamples; i++) {
      const sampleIndex = fadeOutStart + i
      if (sampleIndex < contentStart || sampleIndex >= contentEnd) continue

      const progress = i / fadeOutSamples
      const gain = useEqualPower
        ? Math.cos((progress * Math.PI) / 2)
        : evaluateAudioFadeOutCurve(progress, fadeOutCurve, fadeOutCurveX)
      output[sampleIndex] = output[sampleIndex]! * gain
    }
    for (let i = contentEnd; i < output.length; i++) {
      output[i] = 0
    }
  }

  return output
}

export function applyClipFadeSpans(
  samples: Float32Array,
  fadeSpans: AudioClipFadeSpan[] | undefined,
  sampleRate: number,
  fps: number,
): Float32Array {
  if (!fadeSpans || fadeSpans.length === 0) return samples

  const output = new Float32Array(samples.length)
  output.set(samples)

  for (const span of fadeSpans) {
    const spanStart = Math.max(0, Math.floor((span.startFrame / fps) * sampleRate))
    const spanEnd = Math.min(
      output.length,
      Math.floor(((span.startFrame + span.durationInFrames) / fps) * sampleRate),
    )
    const spanLength = Math.max(0, spanEnd - spanStart)
    if (spanLength === 0) continue

    const fadeInSamples = Math.max(
      0,
      Math.min(spanLength, Math.floor(((span.fadeInFrames ?? 0) / fps) * sampleRate)),
    )
    const fadeOutSamples = Math.max(
      0,
      Math.min(spanLength, Math.floor(((span.fadeOutFrames ?? 0) / fps) * sampleRate)),
    )

    for (let i = 0; i < fadeInSamples; i++) {
      const progress = i / Math.max(1, fadeInSamples)
      const gain = evaluateAudioFadeInCurve(progress, span.fadeInCurve, span.fadeInCurveX)
      output[spanStart + i] = output[spanStart + i]! * gain
    }

    const fadeOutStart = spanEnd - fadeOutSamples
    for (let i = 0; i < fadeOutSamples; i++) {
      const sampleIndex = fadeOutStart + i
      if (sampleIndex < spanStart || sampleIndex >= spanEnd) continue
      const progress = i / Math.max(1, fadeOutSamples)
      const gain = evaluateAudioFadeOutCurve(progress, span.fadeOutCurve, span.fadeOutCurveX)
      output[sampleIndex] = output[sampleIndex]! * gain
    }
  }

  return output
}

/**
 * Apply speed change to audio with pitch preservation using the local time-stretch processor.
 * Processes all channels together through a single processor instance so that
 * WSOLA overlap windows are consistent across channels (prevents phase drift
 * between L/R that causes a hollow sound).
 *
 * @param channels - Input audio channels (mono or stereo)
 * @param speed - Playback rate (1.0 = normal, 2.0 = double speed, 0.5 = half speed)
 * @param sampleRate - Sample rate for the audio
 * @returns Processed channels with the same channel count
 */
export async function applySpeedAndPitch(
  channels: Float32Array[],
  speed: number,
  pitchShiftSemitones: number,
  sampleRate: number,
): Promise<Float32Array[]> {
  const requiresTimeStretch =
    Math.abs(speed - 1) > 0.0001 || isAudioPitchShiftActive(pitchShiftSemitones)
  if (!requiresTimeStretch) return channels
  if (channels.length === 0 || channels[0]!.length === 0) return channels

  const numChannels = channels.length
  const samplesPerChannel = channels[0]!.length

  log.debug('Applying speed/pitch change with time-stretch processor', {
    speed,
    pitchShiftSemitones,
    sampleRate,
    numChannels,
  })

  try {
    const timeStretch = await import('@/infrastructure/audio/time-stretch')
    const st = new timeStretch.TimeStretchProcessor()

    st.tempo = speed
    st.pitch = getAudioPitchRatioFromSemitones(pitchShiftSemitones)
    st.rate = 1.0

    // The processor consumes interleaved stereo. Interleave all channels
    // (for mono, duplicate to stereo so it gets valid input).
    const stereoInput = new Float32Array(samplesPerChannel * 2)
    const left = channels[0]!
    const right = numChannels >= 2 ? channels[1]! : left
    for (let i = 0; i < samplesPerChannel; i++) {
      stereoInput[i * 2] = left[i]!
      stereoInput[i * 2 + 1] = right[i]!
    }

    let inputOffset = 0
    const source = {
      extract: (target: Float32Array, numFrames: number): number => {
        const samplesToRead = Math.min(numFrames * 2, stereoInput.length - inputOffset)
        if (samplesToRead <= 0) return 0

        for (let i = 0; i < samplesToRead; i++) {
          target[i] = stereoInput[inputOffset + i]!
        }
        inputOffset += samplesToRead
        return samplesToRead / 2
      },
    }

    const filter = new timeStretch.TimeStretchFilter(source, st)

    const expectedOutputLength = Math.floor(samplesPerChannel / speed)
    const stereoOutput = new Float32Array(expectedOutputLength * 2)

    let outputOffset = 0
    const chunkSize = 4096
    const chunk = new Float32Array(chunkSize * 2)

    while (outputOffset < stereoOutput.length) {
      const framesExtracted = filter.extract(chunk, chunkSize)
      if (framesExtracted === 0) break

      const samplesToWrite = Math.min(framesExtracted * 2, stereoOutput.length - outputOffset)
      for (let i = 0; i < samplesToWrite; i++) {
        stereoOutput[outputOffset + i] = chunk[i]!
      }
      outputOffset += framesExtracted * 2
    }

    // De-interleave back to separate channels
    const actualOutputLength = Math.floor(outputOffset / 2)
    const outputChannels: Float32Array[] = []

    // Always extract both L and R from the interleaved output
    const outLeft = new Float32Array(actualOutputLength)
    const outRight = new Float32Array(actualOutputLength)
    for (let i = 0; i < actualOutputLength; i++) {
      outLeft[i] = stereoOutput[i * 2]!
      outRight[i] = stereoOutput[i * 2 + 1]!
    }

    if (numChannels >= 2) {
      outputChannels.push(outLeft, outRight)
      // Pass through any additional channels beyond stereo (rare)
      for (let c = 2; c < numChannels; c++) {
        outputChannels.push(outLeft) // duplicate left for extra channels
      }
    } else {
      // Mono source: return left channel only
      outputChannels.push(outLeft)
    }

    log.debug('Time-stretch processing complete', {
      inputLength: samplesPerChannel,
      outputLength: actualOutputLength,
      expectedLength: expectedOutputLength,
      speed,
      numChannels,
    })

    return outputChannels
  } catch (error) {
    log.warn('Time-stretch processing failed, falling back to simple resampling', {
      error,
      speed,
      pitchShiftSemitones,
    })

    if (isAudioPitchShiftActive(pitchShiftSemitones)) {
      log.warn('Independent export pitch shift was skipped because time-stretch processing failed')
    }

    // Fallback: simple resampling per-channel (speed only, pitch shift omitted)
    const outputLength = Math.floor(samplesPerChannel / speed)
    return channels.map((samples) => {
      const output = new Float32Array(outputLength)
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i * speed
        const index0 = Math.floor(sourceIndex)
        const index1 = Math.min(index0 + 1, samples.length - 1)
        const fraction = sourceIndex - index0
        output[i] = samples[index0]! * (1 - fraction) + samples[index1]! * fraction
      }
      return output
    })
  }
}

/**
 * Resample audio to target sample rate using OfflineAudioContext for high-quality
 * sinc interpolation (matches browser-native resampling quality).
 */
export async function resample(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Promise<Float32Array> {
  if (sourceSampleRate === targetSampleRate) return samples

  const duration = samples.length / sourceSampleRate
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(duration * targetSampleRate),
    targetSampleRate,
  )

  const buffer = offlineCtx.createBuffer(1, samples.length, sourceSampleRate)
  buffer.getChannelData(0).set(samples)

  const source = offlineCtx.createBufferSource()
  source.buffer = buffer
  source.connect(offlineCtx.destination)
  source.start(0)

  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}

export function reverseAudioChannels(channels: Float32Array[]): Float32Array[] {
  return channels.map((samples) => {
    const reversed = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      reversed[i] = samples[samples.length - 1 - i] ?? 0
    }
    return reversed
  })
}
