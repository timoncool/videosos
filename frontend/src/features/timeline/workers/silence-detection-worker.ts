/// <reference lib="webworker" />

import {
  detectSilentRanges,
  type AudioBufferLike,
  type AudioSilenceDetectionOptions,
  type AudioSilenceRange,
} from '@/shared/utils/audio-silence'

interface SilenceDetectionSegment {
  channels: ArrayBuffer[]
  offsetSeconds: number
  sampleRate: number
}

interface SilenceDetectionRequest {
  id: string
  segments: SilenceDetectionSegment[]
  settings: AudioSilenceDetectionOptions
}

interface SilenceDetectionResponse {
  error?: string
  id: string
  ranges?: AudioSilenceRange[]
}

function detectSegment(
  segment: SilenceDetectionSegment,
  settings: AudioSilenceDetectionOptions,
): AudioSilenceRange[] {
  const channels = segment.channels.map((channel) => new Float32Array(channel))
  const length = channels[0]?.length ?? 0
  const buffer: AudioBufferLike = {
    duration: length / segment.sampleRate,
    length,
    numberOfChannels: channels.length,
    sampleRate: segment.sampleRate,
    getChannelData: (channel) => channels[channel] ?? new Float32Array(),
  }
  return detectSilentRanges(buffer, settings).map((range) => ({
    start: range.start + segment.offsetSeconds,
    end: range.end + segment.offsetSeconds,
  }))
}

self.addEventListener('message', (event: MessageEvent<SilenceDetectionRequest>) => {
  const { id, segments, settings } = event.data
  try {
    const ranges = segments.flatMap((segment) => detectSegment(segment, settings))
    self.postMessage({ id, ranges } satisfies SilenceDetectionResponse)
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies SilenceDetectionResponse)
  }
})

export {}
