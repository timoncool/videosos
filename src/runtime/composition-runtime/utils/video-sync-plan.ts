export interface VideoSyncTargetContext {
  relativeFrame: number
  isPremounted: boolean
  canSeek: boolean
  effectiveTargetTime: number
  clampedTargetTime: number
  videoDuration: number
  driftSeconds: number
}

export interface VideoSyncAction {
  shouldPause: boolean
  seekTo: number | null
}

export interface VideoPlayingInitialSyncPlan {
  seekTo: number | null
  shouldMarkInitialSyncComplete: boolean
  shouldUpdateLastSyncTime: boolean
}

export type VideoFrameCallbackCorrectionPlan =
  | {
      kind: 'seek'
      seekTo: number
      playbackRate: number
      shouldUpdateLastSyncTime: boolean
    }
  | {
      kind: 'adjust_rate'
      playbackRate: number
    }
  | {
      kind: 'nominal_rate'
      playbackRate: number
    }

export function shouldReactOwnPlaybackRate(input: {
  isPlaying: boolean
  supportsRequestVideoFrameCallback: boolean
  sharedTransitionSync: boolean
}): boolean {
  return (
    !input.isPlaying || (!input.supportsRequestVideoFrameCallback && !input.sharedTransitionSync)
  )
}

export function getVideoSyncTargetContext(input: {
  frame: number
  sequenceFrameOffset: number
  safeTrimBefore: number
  sourceFps: number
  targetTime: number
  readyState: number
  videoDuration: number
  currentTime: number
}): VideoSyncTargetContext {
  const relativeFrame = input.frame - input.sequenceFrameOffset
  const isPremounted = relativeFrame < 0
  const canSeek = input.readyState >= 1
  const effectiveTargetTime = isPremounted
    ? input.safeTrimBefore / input.sourceFps
    : input.targetTime
  // Clamp away from the exact video end to avoid browser/decoder quirks
  // (some decoders stall or return empty frames at the very last sample).
  const END_CLAMP_BUFFER = 0.05
  const clampedTargetTime = Math.min(
    Math.max(0, effectiveTargetTime),
    input.videoDuration - END_CLAMP_BUFFER,
  )

  return {
    relativeFrame,
    isPremounted,
    canSeek,
    effectiveTargetTime,
    clampedTargetTime,
    videoDuration: input.videoDuration,
    driftSeconds: input.currentTime - clampedTargetTime,
  }
}

export function planPremountedVideoSync(input: {
  isTransitionHeld: boolean
  isTransitionPrearmed?: boolean
  canSeek: boolean
  currentTime: number
  targetTime: number
  seekToleranceSeconds: number
}): VideoSyncAction {
  if (input.isTransitionPrearmed) {
    return {
      shouldPause: true,
      seekTo: null,
    }
  }
  if (input.isTransitionHeld) {
    return {
      shouldPause: false,
      seekTo: null,
    }
  }

  return {
    shouldPause: true,
    seekTo:
      input.canSeek && Math.abs(input.currentTime - input.targetTime) > input.seekToleranceSeconds
        ? input.targetTime
        : null,
  }
}

export function planLayoutVideoSync(input: {
  isPremounted: boolean
  isTransitionHeld: boolean
  isTransitionPrearmed?: boolean
  canSeek: boolean
  currentTime: number
  targetTime: number
  isPlaying: boolean
  needsInitialSync: boolean
}): VideoSyncAction & { shouldMarkInitialSyncComplete: boolean } {
  if (!input.canSeek) {
    return {
      shouldPause: false,
      seekTo: null,
      shouldMarkInitialSyncComplete: false,
    }
  }

  if (input.isPremounted) {
    return {
      ...planPremountedVideoSync({
        isTransitionHeld: input.isTransitionHeld,
        isTransitionPrearmed: input.isTransitionPrearmed,
        canSeek: input.canSeek,
        currentTime: input.currentTime,
        targetTime: input.targetTime,
        seekToleranceSeconds: 0.016,
      }),
      shouldMarkInitialSyncComplete: false,
    }
  }

  if (input.needsInitialSync) {
    return {
      shouldPause: false,
      seekTo: input.targetTime,
      shouldMarkInitialSyncComplete: true,
    }
  }

  return {
    shouldPause: false,
    seekTo:
      !input.isPlaying && Math.abs(input.currentTime - input.targetTime) > 0.016
        ? input.targetTime
        : null,
    shouldMarkInitialSyncComplete: false,
  }
}

export function planPlayingVideoInitialSync(input: {
  needsInitialSync: boolean
  canSeek: boolean
  currentTime: number
  targetTime: number
}): VideoPlayingInitialSyncPlan {
  if (!input.needsInitialSync || !input.canSeek) {
    return {
      seekTo: null,
      shouldMarkInitialSyncComplete: false,
      shouldUpdateLastSyncTime: false,
    }
  }

  return {
    seekTo: Math.abs(input.currentTime - input.targetTime) > 0.016 ? input.targetTime : null,
    shouldMarkInitialSyncComplete: true,
    shouldUpdateLastSyncTime: true,
  }
}

export function planPlayingVideoDriftCorrection(input: {
  canSeek: boolean
  currentTime: number
  targetTime: number
  lastSyncTimeMs: number
  nowMs: number
}): VideoSyncAction {
  if (!input.canSeek) {
    return {
      shouldPause: false,
      seekTo: null,
    }
  }

  const drift = input.currentTime - input.targetTime
  const timeSinceLastSync = input.nowMs - input.lastSyncTimeMs
  // Asymmetric thresholds: tolerate small negative drift (video can catch up
  // naturally) but use a larger positive threshold for far-ahead cases where
  // an immediate seek is needed. The 80ms debounce for the behind case avoids
  // jitter from transient drift spikes.
  const videoBehind = drift < -0.2
  const videoFarAhead = drift > 0.5

  return {
    shouldPause: false,
    seekTo: videoFarAhead || (videoBehind && timeSinceLastSync > 80) ? input.targetTime : null,
  }
}

export function planPausedVideoFrameSync(input: {
  frameChanged: boolean
  canSeek: boolean
  currentTime: number
  targetTime: number
}): VideoSyncAction {
  return {
    shouldPause: false,
    seekTo:
      input.frameChanged && input.canSeek && Math.abs(input.currentTime - input.targetTime) > 0.016
        ? input.targetTime
        : null,
  }
}

// Continuous playback drift is corrected by rate. Hard seeks are reserved for
// actual Clock target discontinuities, because every media seek can restart a
// keyframe/GOP decode and amplify an overloaded pipeline.
const LARGE_DRIFT_SECONDS = 0.2
const MAX_LARGE_DRIFT_RATE_CORRECTION = 0.15

export function isVideoSyncTargetDiscontinuity(input: {
  previousTargetTime: number | null
  targetTime: number
  elapsedMs: number
  nominalRate: number
}): boolean {
  if (input.previousTargetTime === null) return false

  const expectedAdvance =
    (Math.max(0, input.elapsedMs) / 1000) * Math.max(0, Math.abs(input.nominalRate))
  const actualAdvance = input.targetTime - input.previousTargetTime
  return Math.abs(actualAdvance - expectedAdvance) > Math.max(0.5, expectedAdvance * 2)
}

export function shouldUpdateVideoPlaybackRate(
  currentRate: number,
  nextRate: number,
  tolerance = 0.015,
): boolean {
  return (
    !Number.isFinite(currentRate) ||
    !Number.isFinite(nextRate) ||
    Math.abs(currentRate - nextRate) >= tolerance
  )
}

export function planVideoFrameCallbackCorrection(input: {
  currentTime: number
  targetTime: number
  nominalRate: number
  readyState: number
  /** True only when the Clock target jumped independently of elapsed playback. */
  targetDiscontinuity?: boolean
}): VideoFrameCallbackCorrectionPlan {
  const drift = input.currentTime - input.targetTime
  const absDrift = Math.abs(drift)

  if (absDrift > LARGE_DRIFT_SECONDS) {
    if (input.readyState >= 1) {
      // Decoder overload is not a transport discontinuity. Re-seeking the
      // advancing Clock target would force another keyframe/GOP decode and keep
      // the media pipeline behind. Only real Clock jumps should hard-seek.
      if (input.targetDiscontinuity) {
        return {
          kind: 'seek',
          seekTo: input.targetTime,
          playbackRate: input.nominalRate,
          shouldUpdateLastSyncTime: true,
        }
      }

      const correction = Math.min(MAX_LARGE_DRIFT_RATE_CORRECTION, Math.max(0.05, absDrift * 0.2))
      return {
        kind: 'adjust_rate',
        playbackRate:
          drift > 0 ? input.nominalRate * (1 - correction) : input.nominalRate * (1 + correction),
      }
    }

    return {
      kind: 'nominal_rate',
      playbackRate: input.nominalRate,
    }
  }

  if (absDrift > 0.016) {
    const correction = Math.min(0.05, absDrift * 0.3)
    return {
      kind: 'adjust_rate',
      playbackRate:
        drift > 0 ? input.nominalRate * (1 - correction) : input.nominalRate * (1 + correction),
    }
  }

  return {
    kind: 'nominal_rate',
    playbackRate: input.nominalRate,
  }
}
export function shouldIssueCoalescedReverseVideoSeek(options: {
  seeking: boolean
  seekInFlight: boolean
  currentTime: number
  targetTime: number
}): boolean {
  return (
    !options.seeking &&
    !options.seekInFlight &&
    Math.abs(options.currentTime - options.targetTime) > 0.001
  )
}
