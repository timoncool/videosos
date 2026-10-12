/**
 * use-player.ts - Core playback hook for FreeCut Player
 *
 * Provides all playback operations including:
 * - play/pause/toggle
 * - Frame-based seeking
 * - Frame navigation (forward/back)
 * - Current frame queries
 * - Event emission
 */

import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { PlayerEmitter, usePlayerEmitter } from './event-emitter'
import {
  useBridgedTimelinePlayback,
  useBridgedSetTimelineContext,
  useBridgedSetTimelineFrame,
  useBridgedActualLastFrame,
  useBridgedActualFirstFrame,
  useClock,
} from './clock'

// Type definitions for the hook return value
interface UsePlayerMethods {
  frameBack: (frames: number) => void
  frameForward: (frames: number) => void
  isLastFrame: boolean
  isFirstFrame: boolean
  emitter: PlayerEmitter
  playing: boolean
  play: () => void
  pause: () => void
  pauseAndReturnToPlayStart: () => void
  seek: (newFrame: number) => void
  getCurrentFrame: () => number
  isPlaying: () => boolean
  hasPlayed: boolean
  isBuffering: () => boolean
  toggle: () => void
  setPlaybackRate: (rate: number) => void
  getPlaybackRate: () => number
}

/**
 * use-player hook - Core playback logic for the player
 *
 * @returns Object containing all playback methods and state
 */
export function usePlayer(
  durationInFrames: number,
  options: {
    loop?: boolean
    onEnded?: () => void
  } = {},
): UsePlayerMethods {
  // loop and onEnded are reserved for future use in the playback loop
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { loop: _loop = false, onEnded: _onEnded } = options

  // Get context values. The frame is intentionally NOT read from context here:
  // doing so subscribed every usePlayer caller to per-frame re-renders.
  const {
    playing: isPlayingState,
    imperativePlaying,
    playbackRate,
    setPlaybackRate: setClockPlaybackRate,
  } = useBridgedTimelinePlayback()
  const { setPlaying } = useBridgedSetTimelineContext()
  const setTimelineFrame = useBridgedSetTimelineFrame()
  const emitter = usePlayerEmitter()
  const clock = useClock()

  // Track if user has played at least once
  const [hasPlayed, setHasPlayed] = useState(false)

  // Refs for tracking state without causing re-renders
  const playStart = useRef(0)
  const frameRef = useRef(clock.currentFrame)
  const bufferingRef = useRef(false)

  // Keep the imperative frame ref synced from clock events. The clock emits
  // 'framechange' for both ticks and seeks (see Clock.seekToFrame).
  useEffect(() => {
    frameRef.current = clock.currentFrame
    return clock.onFrameChange((frame) => {
      frameRef.current = frame
    })
  }, [clock])

  // Calculate boundaries
  const lastFrame = useBridgedActualLastFrame(durationInFrames)
  const firstFrame = useBridgedActualFirstFrame()

  /**
   * Seek to a specific frame
   */
  const seek = useCallback(
    (newFrame: number) => {
      // Clamp to valid range
      let clampedFrame = Math.max(firstFrame, Math.min(newFrame, lastFrame))

      // Apply in/out frame bounds
      if (clampedFrame < firstFrame) clampedFrame = firstFrame
      if (clampedFrame > lastFrame) clampedFrame = lastFrame

      frameRef.current = clampedFrame
      setTimelineFrame(clampedFrame)
      emitter.dispatchSeek(clampedFrame)
    },
    [firstFrame, lastFrame, setTimelineFrame, emitter],
  )

  /**
   * Play the video
   */
  const play = useCallback(() => {
    if (imperativePlaying.current) {
      return
    }

    setHasPlayed(true)

    // If at the last frame, restart from beginning
    if (frameRef.current >= lastFrame) {
      seek(firstFrame)
    }

    imperativePlaying.current = true
    setPlaying(true)
    emitter.dispatchPlay()
  }, [imperativePlaying, lastFrame, firstFrame, setPlaying, emitter, seek])

  /**
   * Pause the video
   */
  const pause = useCallback(() => {
    if (imperativePlaying.current) {
      imperativePlaying.current = false
      setPlaying(false)
      emitter.dispatchPause()
    }
  }, [imperativePlaying, setPlaying, emitter])

  /**
   * Pause and return to where playback started
   */
  const pauseAndReturnToPlayStart = useCallback(() => {
    if (imperativePlaying.current) {
      imperativePlaying.current = false
      frameRef.current = playStart.current
      setTimelineFrame(playStart.current)
      setPlaying(false)
      emitter.dispatchPause()
    }
  }, [imperativePlaying, setTimelineFrame, setPlaying, emitter])

  /**
   * Toggle play/pause state
   */
  const toggle = useCallback(() => {
    if (imperativePlaying.current) {
      pause()
    } else {
      play()
    }
  }, [imperativePlaying, pause, play])

  /**
   * Check if currently playing
   */
  const isPlaying = useCallback(() => {
    return imperativePlaying.current
  }, [imperativePlaying])

  /**
   * Get the current frame
   */
  const getCurrentFrame = useCallback(() => {
    return frameRef.current
  }, [])

  /**
   * Get the current playback rate
   */
  const getPlaybackRate = useCallback(() => {
    return playbackRate
  }, [playbackRate])

  /**
   * Set the playback rate
   */
  const setPlaybackRate = useCallback(
    (rate: number) => {
      setClockPlaybackRate(rate)
      emitter.dispatchRateChange(rate)
    },
    [emitter, setClockPlaybackRate],
  )

  /**
   * Check if currently buffering
   */
  const isBuffering = useCallback(() => {
    return bufferingRef.current
  }, [])

  /**
   * Move back by a number of frames
   */
  const frameBack = useCallback(
    (frames: number) => {
      if (imperativePlaying.current) {
        return
      }

      const prevFrame = frameRef.current
      const newFrame = Math.max(firstFrame, prevFrame - frames)

      if (prevFrame !== newFrame) {
        seek(newFrame)
      }
    },
    [imperativePlaying, firstFrame, seek],
  )

  /**
   * Move forward by a number of frames
   */
  const frameForward = useCallback(
    (frames: number) => {
      if (imperativePlaying.current) {
        return
      }

      const prevFrame = frameRef.current
      const newFrame = Math.min(lastFrame, prevFrame + frames)

      if (prevFrame !== newFrame) {
        seek(newFrame)
      }
    },
    [imperativePlaying, lastFrame, seek],
  )

  // Build the return value
  const returnValue: UsePlayerMethods = useMemo(() => {
    return {
      frameBack,
      frameForward,
      isLastFrame: frameRef.current === lastFrame,
      isFirstFrame: frameRef.current === firstFrame,
      emitter,
      playing: isPlayingState,
      play,
      pause,
      pauseAndReturnToPlayStart,
      seek,
      getCurrentFrame,
      isPlaying,
      hasPlayed,
      isBuffering,
      toggle,
      setPlaybackRate,
      getPlaybackRate,
    }
  }, [
    frameBack,
    frameForward,
    lastFrame,
    firstFrame,
    emitter,
    isPlayingState,
    play,
    pause,
    pauseAndReturnToPlayStart,
    seek,
    getCurrentFrame,
    isPlaying,
    hasPlayed,
    isBuffering,
    toggle,
    setPlaybackRate,
    getPlaybackRate,
  ])

  return returnValue
}
