/**
 * Adapter exports for player-layer dependencies.
 * Composition runtime modules should import player hooks/components from here.
 */

export {
  AbsoluteFill,
  Sequence,
  SequenceContext,
  interpolate,
  useSequenceContext,
} from '@/runtime/player/composition'
export { VideoConfigProvider } from '@/runtime/player/VideoConfigProvider'
export { useVideoConfig } from '@/runtime/player/video-config-context'
export { useBridgedIsPlaying } from '@/runtime/player/clock'
export {
  useClock,
  useClockFrameSelector,
  useClockPlaybackRate,
} from '@/runtime/player/clock/clock-hooks'
export { useVideoSourcePool } from '@/runtime/player/video/VideoSourcePoolContext'
export { isVideoPoolAbortError } from '@/runtime/player/video/VideoSourcePool'
