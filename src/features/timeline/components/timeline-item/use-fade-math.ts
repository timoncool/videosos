import { useMemo } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { getAudioFadeRatio } from '../../utils/audio-fade'
import { getAudioFadeCurveControlPoint, getAudioFadeCurvePath } from '../../utils/audio-fade-curve'
import { getAudioVisualizationScale, getAudioVolumeLineY } from '../../utils/audio-volume'

const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100
const FADE_VIEWBOX_WIDTH = 1000
const VIDEO_FADE_LINE_Y_PERCENT = 50

export interface FadeMath {
  videoFadeInRatio: number
  videoFadeOutRatio: number
  audioFadeInRatio: number
  audioFadeOutRatio: number
  audioFadeInHoverLabel: string
  audioFadeOutHoverLabel: string
  videoFadeInHoverLabel: string
  videoFadeOutHoverLabel: string
  audioVolumeLineY: number
  audioVolumeLineYPercent: number
  audioVisualizationScale: number
  videoFadeLineYPercent: number
  isAudioVolumeControlActive: boolean
  audioVolumeLineStroke: string
  audioFadeInViewboxWidth: number
  audioFadeOutViewboxWidth: number
  videoFadeInViewboxWidth: number
  videoFadeOutViewboxWidth: number
  audioFadeInCurvePoint: ReturnType<typeof getAudioFadeCurveControlPoint> | null
  audioFadeOutCurvePoint: ReturnType<typeof getAudioFadeCurveControlPoint> | null
  audioFadeInCurvePath: string
  audioFadeOutCurvePath: string
  videoFadeInPath: string
  videoFadeOutPath: string
}

interface UseFadeMathParams {
  item: TimelineItemType
  fps: number
  isVisualFadeItem: boolean
  isSelected: boolean
  audioVolumeEditActive: boolean
  skipFadeComputation: boolean
  clipFadeDurationFrames: number
  displayedVideoFadeIn: number
  displayedVideoFadeOut: number
  displayedAudioFadeIn: number
  displayedAudioFadeOut: number
  displayedAudioFadeInCurve: number
  displayedAudioFadeOutCurve: number
  displayedAudioFadeInCurveX: number
  displayedAudioFadeOutCurveX: number
  displayedAudioVolumeDb: number
}

export function useFadeMath({
  item,
  fps,
  isVisualFadeItem,
  isSelected,
  audioVolumeEditActive,
  skipFadeComputation,
  clipFadeDurationFrames,
  displayedVideoFadeIn,
  displayedVideoFadeOut,
  displayedAudioFadeIn,
  displayedAudioFadeOut,
  displayedAudioFadeInCurve,
  displayedAudioFadeOutCurve,
  displayedAudioFadeInCurveX,
  displayedAudioFadeOutCurveX,
  displayedAudioVolumeDb,
}: UseFadeMathParams): FadeMath {
  const videoFadeInRatio = useMemo(
    () =>
      skipFadeComputation
        ? 0
        : isVisualFadeItem
          ? getAudioFadeRatio(displayedVideoFadeIn, fps, clipFadeDurationFrames)
          : 0,
    [skipFadeComputation, clipFadeDurationFrames, displayedVideoFadeIn, fps, isVisualFadeItem],
  )
  const videoFadeOutRatio = useMemo(
    () =>
      skipFadeComputation
        ? 0
        : isVisualFadeItem
          ? getAudioFadeRatio(displayedVideoFadeOut, fps, clipFadeDurationFrames)
          : 0,
    [skipFadeComputation, clipFadeDurationFrames, displayedVideoFadeOut, fps, isVisualFadeItem],
  )
  const audioFadeInRatio = useMemo(
    () =>
      skipFadeComputation
        ? 0
        : item.type === 'audio'
          ? getAudioFadeRatio(displayedAudioFadeIn, fps, clipFadeDurationFrames)
          : 0,
    [skipFadeComputation, clipFadeDurationFrames, displayedAudioFadeIn, fps, item.type],
  )
  const audioFadeOutRatio = useMemo(
    () =>
      skipFadeComputation
        ? 0
        : item.type === 'audio'
          ? getAudioFadeRatio(displayedAudioFadeOut, fps, clipFadeDurationFrames)
          : 0,
    [skipFadeComputation, clipFadeDurationFrames, displayedAudioFadeOut, fps, item.type],
  )
  const audioFadeInHoverLabel = useMemo(
    () => (skipFadeComputation ? '' : `Fade In ${displayedAudioFadeIn.toFixed(2)}s`),
    [skipFadeComputation, displayedAudioFadeIn],
  )
  const audioFadeOutHoverLabel = useMemo(
    () => (skipFadeComputation ? '' : `Fade Out ${displayedAudioFadeOut.toFixed(2)}s`),
    [skipFadeComputation, displayedAudioFadeOut],
  )
  const videoFadeInHoverLabel = useMemo(
    () => (skipFadeComputation ? '' : `Fade In ${displayedVideoFadeIn.toFixed(2)}s`),
    [skipFadeComputation, displayedVideoFadeIn],
  )
  const videoFadeOutHoverLabel = useMemo(
    () => (skipFadeComputation ? '' : `Fade Out ${displayedVideoFadeOut.toFixed(2)}s`),
    [skipFadeComputation, displayedVideoFadeOut],
  )
  const audioVolumeLineY = useMemo(
    () =>
      item.type === 'audio'
        ? getAudioVolumeLineY(displayedAudioVolumeDb, AUDIO_ENVELOPE_VIEWBOX_HEIGHT)
        : AUDIO_ENVELOPE_VIEWBOX_HEIGHT / 2,
    [displayedAudioVolumeDb, item.type],
  )
  const audioVisualizationScale = useMemo(
    () => (item.type === 'audio' ? getAudioVisualizationScale(displayedAudioVolumeDb) : 1),
    [displayedAudioVolumeDb, item.type],
  )
  const audioVolumeLineYPercent = useMemo(
    () => (audioVolumeLineY / AUDIO_ENVELOPE_VIEWBOX_HEIGHT) * 100,
    [audioVolumeLineY],
  )
  const isAudioVolumeControlActive = item.type === 'audio' && (isSelected || audioVolumeEditActive)
  const audioVolumeLineStroke = isAudioVolumeControlActive
    ? 'rgba(255,255,255,0.72)'
    : 'rgba(255,255,255,0.42)'

  const audioFadeInViewboxWidth = audioFadeInRatio * FADE_VIEWBOX_WIDTH
  const audioFadeOutViewboxWidth = audioFadeOutRatio * FADE_VIEWBOX_WIDTH
  const videoFadeInViewboxWidth = videoFadeInRatio * FADE_VIEWBOX_WIDTH
  const videoFadeOutViewboxWidth = videoFadeOutRatio * FADE_VIEWBOX_WIDTH

  const audioFadeInCurvePoint = useMemo(
    () =>
      skipFadeComputation
        ? null
        : getAudioFadeCurveControlPoint({
            handle: 'in',
            fadePixels: audioFadeInViewboxWidth,
            clipWidthPixels: FADE_VIEWBOX_WIDTH,
            curve: displayedAudioFadeInCurve,
            curveX: displayedAudioFadeInCurveX,
          }),
    [
      skipFadeComputation,
      audioFadeInViewboxWidth,
      displayedAudioFadeInCurve,
      displayedAudioFadeInCurveX,
    ],
  )
  const audioFadeOutCurvePoint = useMemo(
    () =>
      skipFadeComputation
        ? null
        : getAudioFadeCurveControlPoint({
            handle: 'out',
            fadePixels: audioFadeOutViewboxWidth,
            clipWidthPixels: FADE_VIEWBOX_WIDTH,
            curve: displayedAudioFadeOutCurve,
            curveX: displayedAudioFadeOutCurveX,
          }),
    [
      skipFadeComputation,
      audioFadeOutViewboxWidth,
      displayedAudioFadeOutCurve,
      displayedAudioFadeOutCurveX,
    ],
  )
  const audioFadeInCurvePath = useMemo(
    () =>
      skipFadeComputation
        ? ''
        : getAudioFadeCurvePath({
            handle: 'in',
            fadePixels: audioFadeInViewboxWidth,
            clipWidthPixels: FADE_VIEWBOX_WIDTH,
            curve: displayedAudioFadeInCurve,
            curveX: displayedAudioFadeInCurveX,
          }),
    [
      skipFadeComputation,
      audioFadeInViewboxWidth,
      displayedAudioFadeInCurve,
      displayedAudioFadeInCurveX,
    ],
  )
  const audioFadeOutCurvePath = useMemo(
    () =>
      skipFadeComputation
        ? ''
        : getAudioFadeCurvePath({
            handle: 'out',
            fadePixels: audioFadeOutViewboxWidth,
            clipWidthPixels: FADE_VIEWBOX_WIDTH,
            curve: displayedAudioFadeOutCurve,
            curveX: displayedAudioFadeOutCurveX,
          }),
    [
      skipFadeComputation,
      audioFadeOutViewboxWidth,
      displayedAudioFadeOutCurve,
      displayedAudioFadeOutCurveX,
    ],
  )
  const videoFadeInPath = useMemo(
    () =>
      skipFadeComputation
        ? ''
        : getAudioFadeCurvePath({
            handle: 'in',
            fadePixels: videoFadeInViewboxWidth,
            clipWidthPixels: FADE_VIEWBOX_WIDTH,
            curve: 0,
            curveX: 0.52,
          }),
    [skipFadeComputation, videoFadeInViewboxWidth],
  )
  const videoFadeOutPath = useMemo(
    () =>
      skipFadeComputation
        ? ''
        : getAudioFadeCurvePath({
            handle: 'out',
            fadePixels: videoFadeOutViewboxWidth,
            clipWidthPixels: FADE_VIEWBOX_WIDTH,
            curve: 0,
            curveX: 0.52,
          }),
    [skipFadeComputation, videoFadeOutViewboxWidth],
  )

  return {
    videoFadeInRatio,
    videoFadeOutRatio,
    audioFadeInRatio,
    audioFadeOutRatio,
    audioFadeInHoverLabel,
    audioFadeOutHoverLabel,
    videoFadeInHoverLabel,
    videoFadeOutHoverLabel,
    audioVolumeLineY,
    audioVolumeLineYPercent,
    audioVisualizationScale,
    videoFadeLineYPercent: VIDEO_FADE_LINE_Y_PERCENT,
    isAudioVolumeControlActive,
    audioVolumeLineStroke,
    audioFadeInViewboxWidth,
    audioFadeOutViewboxWidth,
    videoFadeInViewboxWidth,
    videoFadeOutViewboxWidth,
    audioFadeInCurvePoint,
    audioFadeOutCurvePoint,
    audioFadeInCurvePath,
    audioFadeOutCurvePath,
    videoFadeInPath,
    videoFadeOutPath,
  }
}
