/**
 * Decoding of timeline audio sources, plus the process-wide cache of decoded
 * files. Everything that touches the decode cache lives here.
 */

import { createLogger } from '@/shared/logging/logger'
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/utils/ac3-decoder'
import type { DecodedAudio } from './types'

const log = createLogger('CanvasAudio/decode')

// =============================================================================
// PERFORMANCE OPTIMIZATION: Audio Decode Cache
// =============================================================================

/**
 * Cache for decoded audio to avoid re-decoding the same source file.
 * Key: source URL, Value: decoded audio data
 */
const audioDecodeCache = new Map<string, DecodedAudio>()

/**
 * Clear the audio decode cache (call after export completes)
 */
export function clearAudioDecodeCache(): void {
  audioDecodeCache.clear()
  log.debug('Audio decode cache cleared')
}

type MediabunnyAudioSampleSink = InstanceType<(typeof import('mediabunny'))['AudioSampleSink']>

type MediabunnyAudioSample = InstanceType<(typeof import('mediabunny'))['AudioSample']>

interface AudioDecodeAccumulator {
  channelChunks: Float32Array[][]
  totalFrames: number
  sampleRate: number
  channels: number
}

function createAudioChannelBackfill(totalFrames: number): Float32Array[] {
  if (totalFrames === 0) return []
  return [new Float32Array(totalFrames)]
}

function appendDecodedAudioSample(
  state: AudioDecodeAccumulator,
  sample: MediabunnyAudioSample,
  itemId: string,
): void {
  const frameCount = Math.max(0, sample.numberOfFrames)
  const sampleChannels = Math.max(1, sample.numberOfChannels)
  if (frameCount === 0) return

  if (state.channels === 0) {
    state.channels = sampleChannels
    for (let channel = 0; channel < state.channels; channel++) state.channelChunks.push([])
  } else if (sampleChannels > state.channels) {
    for (let channel = state.channels; channel < sampleChannels; channel++) {
      state.channelChunks.push(createAudioChannelBackfill(state.totalFrames))
    }
    state.channels = sampleChannels
  } else if (sampleChannels < state.channels) {
    log.warn('Inconsistent channel count during mediabunny audio decode', {
      itemId,
      expectedChannels: state.channels,
      actualChannels: sampleChannels,
    })
  }

  for (let channel = 0; channel < state.channels; channel++) {
    const channelData = new Float32Array(frameCount)
    sample.copyTo(channelData, {
      planeIndex: Math.min(channel, sampleChannels - 1),
      format: 'f32-planar',
    })
    state.channelChunks[channel]!.push(channelData)
  }
  state.totalFrames += frameCount
  if (sample.sampleRate > 0) state.sampleRate = sample.sampleRate
}

function mergeDecodedAudioChannels(state: AudioDecodeAccumulator): Float32Array[] {
  return state.channelChunks.map((chunks) => {
    const merged = new Float32Array(state.totalFrames)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return merged
  })
}

export async function decodeAudioRangeFromSink(
  sink: MediabunnyAudioSampleSink,
  itemId: string,
  startTime: number,
  endTime: number,
): Promise<DecodedAudio> {
  const state: AudioDecodeAccumulator = {
    channelChunks: [],
    totalFrames: 0,
    sampleRate: 48_000,
    channels: 0,
  }

  for await (const sample of sink.samples(startTime, endTime)) {
    try {
      appendDecodedAudioSample(state, sample, itemId)
    } finally {
      sample.close()
    }
  }

  if (state.channels === 0 || state.totalFrames === 0) {
    throw new Error('Audio decode produced no output')
  }

  return {
    itemId,
    sampleRate: state.sampleRate,
    channels: state.channels,
    samples: mergeDecodedAudioChannels(state),
    duration: endTime - startTime,
  }
}

async function decodeAudioWithMediabunny(params: {
  src: string
  itemId: string
  startTime?: number
  endTime?: number
  audioCodec?: string
}): Promise<DecodedAudio> {
  if (isAc3AudioCodec(params.audioCodec)) await ensureAc3DecoderRegistered()
  const mb = await import('mediabunny')
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: createMediabunnyInputSource(mb, params.src),
  })
  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) throw new Error('No audio track found')
    const duration = await input.computeDuration()
    const actualStartTime = params.startTime ?? 0
    const actualEndTime = params.endTime ?? duration
    log.debug('Extracting audio range', {
      itemId: params.itemId,
      startTime: actualStartTime,
      endTime: actualEndTime,
      totalDuration: duration,
    })
    return await decodeAudioRangeFromSink(
      new mb.AudioSampleSink(audioTrack),
      params.itemId,
      actualStartTime,
      actualEndTime,
    )
  } finally {
    input.dispose()
  }
}

function getCachedAudioDecode(src: string, itemId: string): DecodedAudio | null {
  const cached = audioDecodeCache.get(src)
  if (!cached) return null
  log.debug('Using cached decoded audio', { itemId, src: src.substring(0, 50) })
  return { ...cached, itemId }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function recoverAudioDecode(params: {
  src: string
  itemId: string
  startTime?: number
  endTime?: number
  audioCodec?: string
  ac3RetryAttempted: boolean
  allowWebAudioFallback: boolean
  error: unknown
}): Promise<DecodedAudio> {
  if (!params.ac3RetryAttempted && !isAc3AudioCodec(params.audioCodec)) {
    try {
      await ensureAc3DecoderRegistered()
      return await decodeAudioFromSource(
        params.src,
        params.itemId,
        params.startTime,
        params.endTime,
        params.audioCodec,
        true,
        params.allowWebAudioFallback,
      )
    } catch {
      // Continue to Web Audio fallback.
    }
  }
  if (!params.allowWebAudioFallback) throw params.error
  log.warn(
    `Mediabunny audio decode failed for ${params.itemId}, using fallback: ${getErrorMessage(params.error)}`,
  )
  return decodeAudioFallback(params.src, params.itemId, params.startTime, params.endTime)
}

/**
 * Decode audio from a media source using mediabunny for efficient range extraction.
 * Only decodes the portion of audio actually needed, not the entire file.
 *
 * @param src - Source URL (blob URL or regular URL)
 * @param itemId - Item ID for logging
 * @param startTime - Start time in seconds (optional, defaults to 0)
 * @param endTime - End time in seconds (optional, defaults to full duration)
 * @returns Decoded audio data for the specified range
 */
export async function decodeAudioFromSource(
  src: string,
  itemId: string,
  startTime?: number,
  endTime?: number,
  audioCodec?: string,
  ac3RetryAttempted: boolean = false,
  allowWebAudioFallback: boolean = true,
): Promise<DecodedAudio> {
  // Check cache first (only for full file decodes for backward compatibility)
  if (startTime === undefined && endTime === undefined) {
    const cached = getCachedAudioDecode(src, itemId)
    if (cached) return cached
  }

  log.debug('Decoding audio with mediabunny', {
    itemId,
    src: src.substring(0, 50),
    startTime,
    endTime,
    audioCodec,
  })

  try {
    const result = await decodeAudioWithMediabunny({
      src,
      itemId,
      startTime,
      endTime,
      audioCodec,
    })

    log.debug('Decoded audio with mediabunny', {
      itemId,
      sampleRate: result.sampleRate,
      channels: result.channels,
      duration: result.duration,
      samples: result.samples[0]?.length,
    })

    if (startTime === undefined && endTime === undefined) audioDecodeCache.set(src, result)

    return result
  } catch (error) {
    return recoverAudioDecode({
      src,
      itemId,
      startTime,
      endTime,
      audioCodec,
      ac3RetryAttempted,
      allowWebAudioFallback,
      error,
    })
  }
}

function sliceDecodedAudioRange(
  decoded: DecodedAudio,
  itemId: string,
  startTime?: number,
  endTime?: number,
): DecodedAudio {
  if (startTime === undefined && endTime === undefined) return { ...decoded, itemId }

  const startFrame = Math.max(0, Math.floor((startTime ?? 0) * decoded.sampleRate))
  const endFrame = Math.max(
    startFrame,
    Math.min(
      decoded.samples[0]?.length ?? 0,
      Math.ceil((endTime ?? decoded.duration) * decoded.sampleRate),
    ),
  )
  return {
    ...decoded,
    itemId,
    samples: decoded.samples.map((samples) => samples.subarray(startFrame, endFrame)),
    duration: (endFrame - startFrame) / decoded.sampleRate,
  }
}

/**
 * Fallback audio decoder using Web Audio API (decodes entire file)
 */
async function decodeAudioFallback(
  src: string,
  itemId: string,
  startTime?: number,
  endTime?: number,
): Promise<DecodedAudio> {
  // Check cache
  const cached = audioDecodeCache.get(src)
  if (cached) {
    log.debug('Using cached decoded audio (fallback)', { itemId })
    return sliceDecodedAudioRange(cached, itemId, startTime, endTime)
  }

  log.debug('Decoding audio with Web Audio API fallback', { itemId, src: src.substring(0, 50) })

  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()

  const offlineContext = new OfflineAudioContext(2, 1, 48000)
  const audioBuffer = await offlineContext.decodeAudioData(arrayBuffer)

  const samples: Float32Array[] = []
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    samples.push(audioBuffer.getChannelData(i))
  }

  const result: DecodedAudio = {
    itemId,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    samples,
    duration: audioBuffer.duration,
  }

  // Cache the result
  audioDecodeCache.set(src, result)

  log.debug('Decoded audio (fallback)', {
    itemId,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    duration: audioBuffer.duration,
    samples: samples[0]?.length,
  })

  return sliceDecodedAudioRange(result, itemId, startTime, endTime)
}
