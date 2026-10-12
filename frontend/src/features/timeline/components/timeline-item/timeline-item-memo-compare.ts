import type { TimelineItem as TimelineItemType } from '@/types/timeline'

export interface TimelineItemCompareProps {
  item: TimelineItemType
  timelineDuration?: number
  trackLocked?: boolean
  trackHidden?: boolean
  isCompactWidth: boolean
  isDetailEligible: boolean
  onHoverChange?: (itemId: string, hovered: boolean) => void
}

/**
 * `React.memo` comparator for `TimelineItem`. Returns `true` when the props are
 * equal enough to skip a re-render.
 *
 * This whitelists the item properties that affect a clip's timeline rendering.
 * It is the twin of `areGroupPropsEqual` in `stable-video-sequence.tsx`: when a
 * new visual property is added to `TimelineItem`, add it to BOTH comparators or
 * clips will render stale during playback.
 */
export function areTimelineItemPropsEqual(
  prevProps: TimelineItemCompareProps,
  nextProps: TimelineItemCompareProps,
): boolean {
  const prevItem = prevProps.item
  const nextItem = nextProps.item

  const prevIsMask = prevItem.type === 'shape' ? prevItem.isMask : undefined
  const nextIsMask = nextItem.type === 'shape' ? nextItem.isMask : undefined

  return (
    prevItem.id === nextItem.id &&
    prevItem.from === nextItem.from &&
    prevItem.durationInFrames === nextItem.durationInFrames &&
    prevItem.trackId === nextItem.trackId &&
    prevItem.type === nextItem.type &&
    prevItem.label === nextItem.label &&
    prevItem.mediaId === nextItem.mediaId &&
    prevItem.sourceStart === nextItem.sourceStart &&
    prevItem.sourceEnd === nextItem.sourceEnd &&
    prevItem.sourceDuration === nextItem.sourceDuration &&
    prevItem.sourceFps === nextItem.sourceFps &&
    prevItem.trimStart === nextItem.trimStart &&
    prevItem.speed === nextItem.speed &&
    prevItem.isReversed === nextItem.isReversed &&
    prevItem.reverseConformStatus === nextItem.reverseConformStatus &&
    prevItem.volume === nextItem.volume &&
    prevItem.effects === nextItem.effects &&
    prevItem.audioFadeIn === nextItem.audioFadeIn &&
    prevItem.audioFadeOut === nextItem.audioFadeOut &&
    prevItem.audioFadeInCurve === nextItem.audioFadeInCurve &&
    prevItem.audioFadeOutCurve === nextItem.audioFadeOutCurve &&
    prevItem.audioFadeInCurveX === nextItem.audioFadeInCurveX &&
    prevItem.audioFadeOutCurveX === nextItem.audioFadeOutCurveX &&
    prevItem.fadeIn === nextItem.fadeIn &&
    prevItem.fadeOut === nextItem.fadeOut &&
    prevIsMask === nextIsMask &&
    prevProps.timelineDuration === nextProps.timelineDuration &&
    prevProps.trackLocked === nextProps.trackLocked &&
    prevProps.trackHidden === nextProps.trackHidden &&
    prevProps.isCompactWidth === nextProps.isCompactWidth &&
    prevProps.isDetailEligible === nextProps.isDetailEligible &&
    prevProps.onHoverChange === nextProps.onHoverChange
  )
}
