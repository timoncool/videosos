import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { ResolvedTransitionWindow } from '@/shared/timeline/transitions/transition-planner'
import { getBrowserMediaPlaybackRate } from '@/shared/state/playback/shuttle'
import {
  isFrameInsideSourceTimeRamp,
  resolveAATransitionRamps,
  resolveTransitionRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@/features/preview/deps/export'

export interface TransitionDomPlaybackState {
  sourceTime: number
  playbackRate: number
  hasActiveSourceRamp: boolean
}

/**
 * Position a paused browser-video lane for an exact transition participant.
 *
 * A-A transitions use an extended source-time ramp that differs from the DOM
 * composition's ordinary clip-local seek. Marking the lane as ramp-owned lets
 * the canvas compositor consume that browser-decoded frame instead of falling
 * through to a cold random-access decode while the user skims.
 */
export function synchronizePausedTransitionDomVideo(
  element: HTMLVideoElement,
  state: TransitionDomPlaybackState,
): void {
  element.dataset.transitionHold = '1'
  delete element.dataset.transitionPrearm
  if (state.hasActiveSourceRamp) {
    element.dataset.transitionSourceRamp = '1'
  } else {
    delete element.dataset.transitionSourceRamp
  }

  if (!element.paused) element.pause()
  if (element.readyState >= 1 && Math.abs(element.currentTime - state.sourceTime) > 0.001) {
    try {
      element.currentTime = state.sourceTime
    } catch {
      // Metadata or the pooled element can still be settling. The transition
      // session retries the hovered frame on the next drawable media event.
    }
  }
  element.playbackRate = state.playbackRate
}

/**
 * Resolve the browser-video state for a transition participant. This mirrors
 * the canvas renderer's extended span and A-A ramp math, allowing live DOM
 * frames to remain the exact source while avoiding a random-access decode on
 * every preview frame.
 */
export function resolveTransitionDomPlaybackState({
  window,
  clip,
  frame,
  timelineFps,
  transportRate,
}: {
  window: ResolvedTransitionWindow<TimelineItem>
  clip: VideoItem
  frame: number
  timelineFps: number
  transportRate: number
}): TransitionDomPlaybackState | null {
  if (frame < window.startFrame || frame >= window.endFrame) return null

  const transitionRange = {
    transitionStart: window.startFrame,
    transitionEnd: window.endFrame,
  }
  const ramps = resolveAATransitionRamps(
    window.leftClip,
    window.rightClip,
    transitionRange,
    timelineFps,
  )
  const ramp =
    ramps && clip.id === window.leftClip.id
      ? ramps.left
      : ramps && clip.id === window.rightClip.id
        ? ramps.right
        : undefined
  const renderSpan = resolveTransitionRenderTimelineSpan(clip, transitionRange, timelineFps, ramp)
  const sourceFps = clip.sourceFps ?? timelineFps
  const hasActiveSourceRamp = Boolean(ramp && isFrameInsideSourceTimeRamp(ramp, frame))
  const rampRate = hasActiveSourceRamp && ramp ? (ramp.slope * timelineFps) / sourceFps : 0

  return {
    sourceTime: resolveVideoRenderSourceTimeSeconds(clip, renderSpan, frame, timelineFps),
    playbackRate: getBrowserMediaPlaybackRate((clip.speed ?? 1) + rampRate, transportRate),
    hasActiveSourceRamp,
  }
}
