/**
 * The full-segment audio pipeline: decode, DSP, ducking, mix and master bus.
 */

import type { CompositionInputProps } from '@/types/export'
import { createLogger } from '@/shared/logging/logger'
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/utils/ac3-decoder'
import { applyAudioEqStages } from '@/shared/utils/audio-eq'
import { isAudioPitchShiftActive } from '@/shared/utils/audio-pitch'
import type { AudioProcessingConfig } from './types'
import { decodeAudioFromSource, getErrorMessage } from './decode'
import {
  applyAnimatedVolume,
  applyClipFadeSpans,
  applyFades,
  applySpeedAndPitch,
  applyVolume,
  dbToGain,
  resample,
  reverseAudioChannels,
} from './dsp'
import { applyDucking, collectDuckingSources } from './ducking'
import { createAudioMixBuffer, mixAudioSegmentInto, softClipAudioMix } from './mixdown'
import { resolveSubCompMediaUrls } from './media-urls'
import { extractAudioSegments } from './planning'

const log = createLogger('CanvasAudio/pipeline')

/**
 * Process all audio for the composition.
 *
 * @param composition - The composition with tracks
 * @param signal - Optional abort signal
 * @returns Processed audio ready for encoding
 */
export async function processAudio(
  composition: CompositionInputProps,
  signal?: AbortSignal,
): Promise<{
  samples: Float32Array[]
  sampleRate: number
  channels: number
} | null> {
  const { fps, durationInFrames = 0 } = composition

  // Ordering contract: sub-composition media URLs must be resolved before
  // extractAudioSegments runs, or nested items read as src-less and their audio
  // is silently dropped from the mix.
  await resolveSubCompMediaUrls(composition)

  // Extract audio segments
  const segments = extractAudioSegments(composition, fps)

  // Filter out muted segments early
  const activeSegments = segments.filter((s) => !s.muted)

  if (activeSegments.length === 0) {
    log.info('No audio segments to process')
    return null
  }

  const requiresAc3Decoder = activeSegments.some((segment) => isAc3AudioCodec(segment.audioCodec))
  if (requiresAc3Decoder) {
    await ensureAc3DecoderRegistered()
    log.debug('AC-3 decoder pre-registered for export audio decode')
  }

  const duckingSources = collectDuckingSources(composition, fps)

  // Configuration
  const config: AudioProcessingConfig = {
    sampleRate: 48000, // Standard export sample rate
    channels: 2, // Stereo
    fps,
    totalFrames: durationInFrames,
  }

  log.info('Processing audio', {
    segmentCount: activeSegments.length,
    sampleRate: config.sampleRate,
    channels: config.channels,
    durationSeconds: durationInFrames / fps,
  })

  // Allocate the final mix once, then fold each processed segment into it
  // immediately. Keeping every decoded segment alive until the end multiplies
  // memory use on long, multi-clip timelines.
  const mixedSamples = createAudioMixBuffer(config)
  let processedSegmentCount = 0

  for (const segment of activeSegments) {
    if (signal?.aborted) {
      throw new DOMException('Audio processing cancelled', 'AbortError')
    }

    try {
      // Calculate the time range we actually need from the source
      // sourceStartFrame is in source-native FPS frames, so divide by sourceFps (not project fps)
      const sourceStartTime = segment.sourceStartFrame / segment.sourceFps
      // Account for speed: at 2x speed, we need twice as much source audio
      const sourceDurationNeeded = (segment.durationFrames / fps) * segment.speed
      const sourceEndTime = sourceStartTime + sourceDurationNeeded

      // Decode ONLY the needed range using mediabunny (huge performance improvement!)
      const decoded = await decodeAudioFromSource(
        segment.src,
        segment.itemId,
        sourceStartTime,
        sourceEndTime,
        segment.audioCodec,
      )

      // Process audio channels.
      // Note: decoded audio is already trimmed to the range we requested.

      // Apply speed across ALL channels at once to maintain phase coherence
      // between L/R (the WSOLA pipeline finds shared overlap windows).
      let processedChannels = decoded.samples
      if (segment.isReversed) {
        processedChannels = reverseAudioChannels(processedChannels)
      }
      if (
        Math.abs(segment.speed - 1) > 0.0001 ||
        isAudioPitchShiftActive(segment.pitchShiftSemitones)
      ) {
        processedChannels = await applySpeedAndPitch(
          processedChannels,
          segment.speed,
          segment.pitchShiftSemitones,
          decoded.sampleRate,
        )
      }
      processedChannels = applyAudioEqStages(
        processedChannels,
        decoded.sampleRate,
        segment.audioEqStages,
      )

      // Apply per-channel volume, fades, and resampling
      const fadeInSamples = Math.floor((segment.fadeInFrames / fps) * decoded.sampleRate)
      const fadeOutSamples = Math.floor((segment.fadeOutFrames / fps) * decoded.sampleRate)
      const crossfadeFadeInSamples = Math.floor(
        ((segment.crossfadeFadeInFrames ?? 0) / fps) * decoded.sampleRate,
      )
      const crossfadeFadeOutSamples = Math.floor(
        ((segment.crossfadeFadeOutFrames ?? 0) / fps) * decoded.sampleRate,
      )
      const contentStartOffsetSamples = Math.floor(
        ((segment.contentStartOffsetFrames ?? 0) / fps) * decoded.sampleRate,
      )
      const contentEndOffsetSamples = Math.floor(
        ((segment.contentEndOffsetFrames ?? 0) / fps) * decoded.sampleRate,
      )
      const fadeInDelaySamples = Math.floor(
        ((segment.fadeInDelayFrames ?? 0) / fps) * decoded.sampleRate,
      )
      const fadeOutLeadSamples = Math.floor(
        ((segment.fadeOutLeadFrames ?? 0) / fps) * decoded.sampleRate,
      )

      for (let c = 0; c < processedChannels.length; c++) {
        let channelSamples = processedChannels[c]!

        // Apply volume (animated if keyframes exist, static otherwise)
        if (segment.volumeKeyframes && segment.volumeKeyframes.length > 0) {
          channelSamples = applyAnimatedVolume(
            channelSamples,
            segment.volumeKeyframes,
            segment.volume,
            segment.startFrame,
            segment.itemFrom,
            fps,
            decoded.sampleRate,
          )
        } else if (segment.volume !== 0) {
          channelSamples = applyVolume(channelSamples, segment.volume)
        }

        // Apply fades
        if (segment.clipFadeSpans && segment.clipFadeSpans.length > 0) {
          channelSamples = applyClipFadeSpans(
            channelSamples,
            segment.clipFadeSpans,
            decoded.sampleRate,
            fps,
          )
        } else if (fadeInSamples > 0 || fadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            fadeInSamples,
            fadeOutSamples,
            false,
            segment.fadeInCurve,
            segment.fadeOutCurve,
            segment.fadeInCurveX,
            segment.fadeOutCurveX,
            contentStartOffsetSamples,
            contentEndOffsetSamples,
            fadeInDelaySamples,
            fadeOutLeadSamples,
          )
        }

        if (crossfadeFadeInSamples > 0 || crossfadeFadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            crossfadeFadeInSamples,
            crossfadeFadeOutSamples,
            true,
          )
        }

        if (duckingSources.length > 0) {
          channelSamples = applyDucking(
            channelSamples,
            duckingSources,
            segment,
            segment.startFrame,
            fps,
            decoded.sampleRate,
          )
        }

        // Resample to target sample rate
        if (decoded.sampleRate !== config.sampleRate) {
          channelSamples = await resample(channelSamples, decoded.sampleRate, config.sampleRate)
        }

        processedChannels[c] = channelSamples
      }

      // Calculate start position in output
      const startSample = Math.floor((segment.startFrame / fps) * config.sampleRate)

      mixAudioSegmentInto(mixedSamples, { samples: processedChannels, startSample }, config)
      processedSegmentCount++

      log.debug('Processed audio segment', {
        itemId: segment.itemId,
        type: segment.type,
        startSample,
        outputSamples: processedChannels[0]?.length,
      })
    } catch (error) {
      log.error(`Failed to process audio segment ${segment.itemId}: ${getErrorMessage(error)}`)
      // Continue with other segments
    }
  }

  if (processedSegmentCount === 0) {
    log.warn('No audio segments were successfully processed')
    return null
  }

  softClipAudioMix(mixedSamples)

  // Apply project-scoped master bus gain to the final mix. Monitor volume
  // (per-device) is intentionally NOT applied during export — it's a
  // preview-only setting.
  const masterBusDb = composition.masterBusDb
  if (typeof masterBusDb === 'number' && masterBusDb !== 0) {
    const masterBusGain = dbToGain(masterBusDb)
    for (const channel of mixedSamples) {
      for (let i = 0; i < channel.length; i++) {
        channel[i] = channel[i]! * masterBusGain
      }
    }
  }

  log.info('Audio processing complete', {
    outputSamples: mixedSamples[0]?.length,
    channels: mixedSamples.length,
    durationSeconds: (mixedSamples[0]?.length ?? 0) / config.sampleRate,
    masterBusDb: masterBusDb ?? 0,
  })

  return {
    samples: mixedSamples,
    sampleRate: config.sampleRate,
    channels: config.channels,
  }
}

/**
 * Check if composition has any audio content.
 * Async because sub-composition media URLs may need to be resolved from OPFS
 * before extractAudioSegments can see valid src values.
 */
export async function hasAudioContent(composition: CompositionInputProps): Promise<boolean> {
  // Ordering contract: sub-composition media URLs must be resolved before
  // extractAudioSegments runs, or nested items read as src-less and their audio
  // is silently dropped from the mix.
  await resolveSubCompMediaUrls(composition)
  const segments = extractAudioSegments(composition, composition.fps)
  return segments.some((s) => !s.muted)
}
