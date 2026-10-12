/**
 * Shared shapes for the canvas audio pipeline.
 *
 * `AudioSegment` is the unit every stage works on: the planners build it, and
 * the full-segment and windowed mixers consume it.
 */

import type { ResolvedAudioEqSettings } from '@/types/audio'
import type { Keyframe as VolumeKeyframe } from '@/types/keyframe'
import type { AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve'

/**
 * Audio segment representing a timeline item's audio
 */
export interface AudioSegment {
  itemId: string
  trackId: string
  src: string
  startFrame: number // Timeline position
  durationFrames: number
  sourceStartFrame: number // In source media (for trim) — in source-native FPS frames
  sourceFps: number // Source media FPS (sourceStartFrame is in these frames)
  volume: number // -60 to +12 dB
  fadeInFrames: number
  fadeOutFrames: number
  fadeInCurve: number
  fadeOutCurve: number
  fadeInCurveX: number
  fadeOutCurveX: number
  pitchShiftSemitones: number
  audioEqStages: ResolvedAudioEqSettings[]
  contentStartOffsetFrames?: number
  contentEndOffsetFrames?: number
  fadeInDelayFrames?: number
  fadeOutLeadFrames?: number
  clipFadeSpans?: AudioClipFadeSpan[]
  crossfadeFadeInFrames?: number
  crossfadeFadeOutFrames?: number
  speed: number // Playback rate
  isReversed: boolean
  muted: boolean
  type: 'video' | 'audio'
  audioCodec?: string // Audio codec for lazy AC-3 decoder registration
  volumeKeyframes?: VolumeKeyframe[] // Animated volume keyframes
  itemFrom: number // Item's timeline start frame (for keyframe offset)
}

export interface AudioPacketPassthroughPlan {
  src: string
  durationSeconds: number
}

/**
 * Decoded audio data
 */
export interface DecodedAudio {
  itemId: string
  sampleRate: number
  channels: number
  samples: Float32Array[] // Per-channel samples
  duration: number // Duration in seconds
}

/**
 * Audio processing configuration
 */
export interface AudioProcessingConfig {
  sampleRate: number
  channels: number
  fps: number
  totalFrames: number
}
