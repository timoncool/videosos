import { useMemo } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { frameToPixelsNow } from '../../utils/zoom-conversions'
import { isMediaItem, timelineToSourceFrames } from '../../utils/source-calculations'
import { computeSlideContinuitySourceDelta } from '../../utils/slide-utils'

interface RateStretchVisualFeedback {
  from: number
  duration: number
  speed: number
}

interface UseTimelineItemBoundsParams {
  previewBaseItem: TimelineItemType
  fps: number

  // Trim state
  isTrimming: boolean
  trimHandle: 'start' | 'end' | null
  trimDelta: number

  // Stretch state
  isStretching: boolean
  stretchFeedback: RateStretchVisualFeedback | null

  // Slip/slide
  isSlipSlideActive: boolean
  slipEditDelta: number
  slideEditOffset: number
  slideNeighborSide: 'left' | 'right' | null
  slideNeighborDelta: number
  slideLeftNeighborForSlidItem: TimelineItemType | null
  slideRightNeighborForSlidItem: TimelineItemType | null

  // Rolling/ripple/track-push
  rollingEditDelta: number
  rollingEditHandle: 'start' | 'end' | null
  rippleEditOffset: number
  rippleEdgeDelta: number
  trackPushOffset: number
}

export interface TimelineItemBounds {
  leftFrame: number
  rightFrame: number
  left: number
  right: number
  width: number
  visualLeftFrame: number
  visualWidthFrames: number
  visualLeft: number
  visualWidth: number
  slideFromOffset: number
  slideDurationOffset: number
  contentPreviewItem: TimelineItemType
  preferImmediateContentRendering: boolean
  effectiveSourceFps: number
}

export function useTimelineItemBounds({
  previewBaseItem,
  fps,
  isTrimming,
  trimHandle,
  trimDelta,
  isStretching,
  stretchFeedback,
  isSlipSlideActive,
  slipEditDelta,
  slideEditOffset,
  slideNeighborSide,
  slideNeighborDelta,
  slideLeftNeighborForSlidItem,
  slideRightNeighborForSlidItem,
  rollingEditDelta,
  rollingEditHandle,
  rippleEditOffset,
  rippleEdgeDelta,
  trackPushOffset,
}: UseTimelineItemBoundsParams): TimelineItemBounds {
  const slideFromOffset = slideEditOffset + (slideNeighborSide === 'right' ? slideNeighborDelta : 0)
  const slideDurationOffset =
    (slideNeighborSide === 'left' ? slideNeighborDelta : 0) +
    (slideNeighborSide === 'right' ? -slideNeighborDelta : 0)

  const leftFrame = previewBaseItem.from + slideFromOffset + rippleEditOffset + trackPushOffset
  const rightFrame =
    previewBaseItem.from +
    previewBaseItem.durationInFrames +
    slideDurationOffset +
    slideFromOffset +
    rippleEditOffset +
    trackPushOffset
  const left = Math.round(frameToPixelsNow(leftFrame))
  const right = Math.round(frameToPixelsNow(rightFrame))
  const width = right - left

  const effectiveSourceFps = previewBaseItem.sourceFps ?? fps

  const contentPreviewItem = useMemo<TimelineItemType>(() => {
    let nextItem = previewBaseItem
    let previewStartTrimDelta = 0
    let previewEndTrimDelta = 0
    let previewDurationDelta = 0

    if (isTrimming && trimHandle) {
      if (trimHandle === 'start') {
        previewStartTrimDelta += trimDelta
        previewDurationDelta += -trimDelta
      } else {
        previewEndTrimDelta += trimDelta
        previewDurationDelta += trimDelta
      }
    }

    if (rollingEditDelta !== 0) {
      if (rollingEditHandle === 'end') {
        previewStartTrimDelta += rollingEditDelta
        previewDurationDelta += -rollingEditDelta
      } else if (rollingEditHandle === 'start') {
        previewEndTrimDelta += rollingEditDelta
        previewDurationDelta += rollingEditDelta
      }
    }

    if (slideNeighborSide && slideNeighborDelta !== 0) {
      if (slideNeighborSide === 'right') {
        previewStartTrimDelta += slideNeighborDelta
        previewDurationDelta += -slideNeighborDelta
      } else {
        previewEndTrimDelta += slideNeighborDelta
        previewDurationDelta += slideNeighborDelta
      }
    }

    if (isMediaItem(nextItem) && slideEditOffset !== 0) {
      const sourceDelta = computeSlideContinuitySourceDelta(
        nextItem,
        slideLeftNeighborForSlidItem,
        slideRightNeighborForSlidItem,
        slideEditOffset,
        fps,
      )
      if (sourceDelta !== 0 && nextItem.sourceEnd !== undefined) {
        nextItem = {
          ...nextItem,
          sourceStart: (nextItem.sourceStart ?? 0) + sourceDelta,
          sourceEnd: nextItem.sourceEnd + sourceDelta,
        }
      }
    }

    if (isMediaItem(previewBaseItem) && slipEditDelta !== 0) {
      const nextSourceStart = Math.max(0, (nextItem.sourceStart ?? 0) + slipEditDelta)
      const nextSourceEnd =
        nextItem.sourceEnd !== undefined
          ? Math.max(nextSourceStart + 1, nextItem.sourceEnd + slipEditDelta)
          : undefined

      nextItem = {
        ...nextItem,
        sourceStart: nextSourceStart,
        sourceEnd: nextSourceEnd,
      }
    }

    const isCompositionWrapper =
      nextItem.type === 'composition' || (nextItem.type === 'audio' && !!nextItem.compositionId)

    const supportsStartTrimSourceShift =
      previewBaseItem.type === 'video' || previewBaseItem.type === 'audio' || isCompositionWrapper
    if (supportsStartTrimSourceShift && previewStartTrimDelta !== 0) {
      const sourceFramesDelta = timelineToSourceFrames(
        previewStartTrimDelta,
        nextItem.speed ?? 1,
        fps,
        effectiveSourceFps,
      )
      nextItem = {
        ...nextItem,
        sourceStart: Math.max(0, (nextItem.sourceStart ?? 0) + sourceFramesDelta),
      }
    }

    if (previewDurationDelta !== 0) {
      nextItem = {
        ...nextItem,
        durationInFrames: Math.max(1, nextItem.durationInFrames + previewDurationDelta),
      }
    }

    if (isCompositionWrapper && previewEndTrimDelta !== 0 && nextItem.sourceEnd !== undefined) {
      const endSourceFramesDelta = timelineToSourceFrames(
        previewEndTrimDelta,
        nextItem.speed ?? 1,
        fps,
        effectiveSourceFps,
      )
      nextItem = {
        ...nextItem,
        sourceEnd: Math.max(
          (nextItem.sourceStart ?? 0) + 1,
          nextItem.sourceEnd + endSourceFramesDelta,
        ),
      }
    }

    return nextItem
  }, [
    previewBaseItem,
    isTrimming,
    trimHandle,
    trimDelta,
    rollingEditDelta,
    rollingEditHandle,
    slipEditDelta,
    slideEditOffset,
    slideNeighborSide,
    slideNeighborDelta,
    slideLeftNeighborForSlidItem,
    slideRightNeighborForSlidItem,
    fps,
    effectiveSourceFps,
  ])

  const preferImmediateContentRendering =
    isTrimming ||
    isSlipSlideActive ||
    rollingEditDelta !== 0 ||
    rippleEditOffset !== 0 ||
    rippleEdgeDelta !== 0 ||
    slideEditOffset !== 0 ||
    slideNeighborDelta !== 0

  const { visualLeftFrame, visualWidthFrames } = useMemo(() => {
    let trimVisualLeftFrame = leftFrame
    let trimVisualRightFrame = rightFrame

    if (rippleEdgeDelta !== 0) {
      trimVisualRightFrame =
        previewBaseItem.from + previewBaseItem.durationInFrames + rippleEdgeDelta
    } else if (isTrimming && trimHandle) {
      if (trimHandle === 'start') {
        trimVisualLeftFrame = previewBaseItem.from + trimDelta
      } else {
        trimVisualRightFrame = previewBaseItem.from + previewBaseItem.durationInFrames + trimDelta
      }
    }

    if (rollingEditDelta !== 0) {
      if (rollingEditHandle === 'end') {
        trimVisualLeftFrame = previewBaseItem.from + rollingEditDelta
      } else if (rollingEditHandle === 'start') {
        trimVisualRightFrame =
          previewBaseItem.from + previewBaseItem.durationInFrames + rollingEditDelta
      }
    }

    let stretchVisualLeftFrame = trimVisualLeftFrame
    let stretchVisualRightFrame = trimVisualRightFrame

    if (isStretching && stretchFeedback) {
      stretchVisualLeftFrame = stretchFeedback.from
      stretchVisualRightFrame = stretchFeedback.from + stretchFeedback.duration
    }

    const isActive = rippleEdgeDelta !== 0 || isTrimming || rollingEditDelta !== 0
    const nextVisualLeftFrame = isStretching
      ? stretchVisualLeftFrame
      : isActive
        ? trimVisualLeftFrame
        : leftFrame
    const nextVisualRightFrame = isStretching
      ? stretchVisualRightFrame
      : isActive
        ? trimVisualRightFrame
        : rightFrame

    return {
      visualLeftFrame: nextVisualLeftFrame,
      visualWidthFrames: Math.max(1, nextVisualRightFrame - nextVisualLeftFrame),
    }
  }, [
    isTrimming,
    trimHandle,
    isStretching,
    stretchFeedback,
    previewBaseItem.from,
    previewBaseItem.durationInFrames,
    trimDelta,
    rollingEditDelta,
    rollingEditHandle,
    rippleEdgeDelta,
    leftFrame,
    rightFrame,
  ])

  const visualLeft = Math.round(frameToPixelsNow(visualLeftFrame))
  const visualWidth = Math.round(frameToPixelsNow(visualWidthFrames))
  return {
    leftFrame,
    rightFrame,
    left,
    right,
    width,
    visualLeftFrame,
    visualWidthFrames,
    visualLeft,
    visualWidth,
    slideFromOffset,
    slideDurationOffset,
    contentPreviewItem,
    preferImmediateContentRendering,
    effectiveSourceFps,
  }
}
