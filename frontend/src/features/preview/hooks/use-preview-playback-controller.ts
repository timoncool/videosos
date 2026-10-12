import { useCallback, useState, type MutableRefObject } from 'react'
import type { PreviewQuality } from '@/shared/state/playback'
import { usePlaybackStore } from '@/shared/state/playback'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineTrack } from '@/types/timeline'
import {
  type AdaptivePreviewQualityState,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality'
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard'
import { getPreviewRuntimeSnapshotFromPlaybackState } from '../utils/preview-state-coordinator'
import { resolvePlaybackColdStartFrameAdvance } from '../utils/playback-cold-start-event'
import { usePreviewRuntimeGuards } from './use-preview-runtime-guards'
import type { PreviewPerfStats } from './use-preview-diagnostics'

interface UsePreviewPlaybackControllerParams {
  fps: number
  combinedTracks: TimelineTrack[]
  keyframes: ItemKeyframes[]
  forceFastScrubOverlay: boolean
  domTextScrubOverlayEnabled: boolean
  previewPerfRef: MutableRefObject<PreviewPerfStats>
  isGizmoInteractingRef: MutableRefObject<boolean>
  preferPlayerForDomGizmoRef: MutableRefObject<boolean>
  preferPlayerForStyledTextScrubRef: MutableRefObject<boolean>
  adaptiveQualityStateRef: MutableRefObject<AdaptivePreviewQualityState>
  adaptiveFrameSampleRef: MutableRefObject<{ frame: number; tsMs: number } | null>
  ignorePlayerUpdatesRef: MutableRefObject<boolean>
  resolvePendingSeekLatency: (frame: number) => void
}

export function usePreviewPlaybackController({
  fps,
  combinedTracks,
  keyframes,
  forceFastScrubOverlay,
  domTextScrubOverlayEnabled,
  previewPerfRef,
  isGizmoInteractingRef,
  preferPlayerForDomGizmoRef,
  preferPlayerForStyledTextScrubRef,
  adaptiveQualityStateRef,
  adaptiveFrameSampleRef,
  ignorePlayerUpdatesRef,
  resolvePendingSeekLatency,
}: UsePreviewPlaybackControllerParams) {
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1)

  usePreviewRuntimeGuards({
    forceFastScrubOverlay,
    isGizmoInteractingRef,
    preferPlayerForDomGizmoRef,
    setAdaptiveQualityCap,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef,
  })

  const preferPlayerForStyledTextScrub =
    !domTextScrubOverlayEnabled &&
    !forceFastScrubOverlay &&
    shouldPreferPlayerForStyledTextScrubGuard(combinedTracks, keyframes)
  preferPlayerForStyledTextScrubRef.current = preferPlayerForStyledTextScrub

  const shouldPreferPlayerForPreview = useCallback(
    (previewFrame: number | null) => {
      return (
        preferPlayerForDomGizmoRef.current ||
        (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
      )
    },
    [preferPlayerForDomGizmoRef, preferPlayerForStyledTextScrubRef],
  )

  const handleFrameChange = useCallback(
    (frame: number) => {
      const nextFrame = Math.round(frame)
      resolvePendingSeekLatency(nextFrame)
      if (ignorePlayerUpdatesRef.current) return
      const playbackState = usePlaybackStore.getState()
      const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
        playbackState,
        isGizmoInteractingRef.current,
      )
      const interactionMode = runtimeSnapshot.mode
      if (interactionMode === 'scrubbing') return

      if (interactionMode === 'playing') {
        resolvePlaybackColdStartFrameAdvance(nextFrame)
        const nowMs = performance.now()
        const previousSample = adaptiveFrameSampleRef.current
        if (previousSample && nextFrame !== previousSample.frame) {
          const frameDelta = Math.max(1, Math.abs(nextFrame - previousSample.frame))
          const elapsedMs = nowMs - previousSample.tsMs
          if (elapsedMs > 0) {
            const result = updateAdaptivePreviewQuality({
              state: adaptiveQualityStateRef.current,
              sampleMsPerFrame: elapsedMs / frameDelta,
              frameBudgetMs: getFrameBudgetMs(fps, playbackState.playbackRate),
              userQuality: playbackState.previewQuality,
              nowMs,
              allowRecovery: false,
            })
            adaptiveQualityStateRef.current = result.state
            if (result.qualityChanged) {
              if (result.qualityChangeDirection === 'degrade') {
                previewPerfRef.current.adaptiveQualityDowngrades += 1
              } else if (result.qualityChangeDirection === 'recover') {
                previewPerfRef.current.adaptiveQualityRecovers += 1
              }
              setAdaptiveQualityCap(result.state.qualityCap)
            }
          }
        }
        adaptiveFrameSampleRef.current = { frame: nextFrame, tsMs: nowMs }
      } else {
        adaptiveFrameSampleRef.current = null
        if (
          adaptiveQualityStateRef.current.overBudgetSamples !== 0 ||
          adaptiveQualityStateRef.current.underBudgetSamples !== 0
        ) {
          adaptiveQualityStateRef.current = {
            ...adaptiveQualityStateRef.current,
            overBudgetSamples: 0,
            underBudgetSamples: 0,
          }
        }
      }

      const { currentFrame, setCurrentFrame } = playbackState
      if (currentFrame === nextFrame) return
      if (interactionMode === 'paused') return
      setCurrentFrame(nextFrame)
    },
    [
      adaptiveFrameSampleRef,
      adaptiveQualityStateRef,
      fps,
      ignorePlayerUpdatesRef,
      isGizmoInteractingRef,
      previewPerfRef,
      resolvePendingSeekLatency,
    ],
  )

  const handlePlayStateChange = useCallback((playing: boolean) => {
    const playback = usePlaybackStore.getState()
    if (playback.playbackScrubResumeTransport !== null) return
    if (playing) {
      if (!playback.isPlaying) {
        playback.play()
      }
    } else if (playback.isPlaying) {
      playback.pause()
    }
  }, [])

  return {
    adaptiveQualityCap,
    shouldPreferPlayerForPreview,
    handleFrameChange,
    handlePlayStateChange,
  }
}
