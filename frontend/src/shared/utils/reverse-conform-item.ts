import type { TimelineItem, VideoItem } from '@/types/timeline'

type ReverseConformMode = 'preview' | 'export'

function hasReadyReverseConform(
  item: TimelineItem,
): item is TimelineItem & { reverseConformSrc: string } {
  return (
    (item.type === 'video' || item.type === 'audio') &&
    item.isReversed === true &&
    item.reverseConformStatus === 'ready' &&
    typeof item.reverseConformSrc === 'string' &&
    item.reverseConformSrc.length > 0
  )
}

function hasReadyReversePreviewConform(
  item: TimelineItem,
): item is TimelineItem & { reverseConformPreviewSrc: string } {
  return (
    item.type === 'video' &&
    item.isReversed === true &&
    item.reverseConformStatus === 'ready' &&
    typeof item.reverseConformPreviewSrc === 'string' &&
    item.reverseConformPreviewSrc.length > 0
  )
}

export function resolveReverseConformedVideoItem<TItem extends VideoItem>(
  item: TItem,
  timelineFps: number,
  options: { mode?: ReverseConformMode; useProxy?: boolean } = {},
): TItem {
  const canUsePreviewConform =
    options.mode !== 'export' &&
    hasReadyReversePreviewConform(item) &&
    (options.useProxy === true ||
      item.reverseConformPreviewUsesProxy !== true ||
      !hasReadyReverseConform(item))
  const conformSrc = canUsePreviewConform
    ? item.reverseConformPreviewSrc
    : hasReadyReverseConform(item)
      ? item.reverseConformSrc
      : null

  if (!conformSrc) {
    return item
  }

  if (item.reverseConformPreviewIsSourceLevel === true && canUsePreviewConform) {
    const sourceFps = Math.max(0.001, item.sourceFps ?? timelineFps)
    const conformFps = Math.max(0.001, item.reverseConformPreviewFps ?? sourceFps)
    const sourceDuration = Math.max(
      1,
      item.reverseConformPreviewSourceDuration ?? item.sourceDuration ?? item.durationInFrames,
    )
    const sourceStart = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
    const sourceFramesNeeded = (item.durationInFrames * (item.speed ?? 1) * sourceFps) / timelineFps
    const sourceEnd = Math.min(sourceDuration, item.sourceEnd ?? sourceStart + sourceFramesNeeded)
    const conformStart = ((sourceDuration - sourceEnd) * conformFps) / sourceFps
    const conformEnd = ((sourceDuration - sourceStart) * conformFps) / sourceFps

    return {
      ...item,
      src: conformSrc,
      audioSrc: conformSrc,
      isReversed: undefined,
      sourceStart: conformStart,
      trimStart: conformStart,
      offset: conformStart,
      sourceEnd: conformEnd,
      sourceDuration: (sourceDuration * conformFps) / sourceFps,
      sourceFps: conformFps,
    }
  }

  // Legacy per-clip conforms use a timeline-frame offset into the rendered clip.
  // Split halves share the conform reference but read different ranges from it.
  const conformLocalStart = item.reverseConformLocalStart ?? 0
  const conformLocalEnd = conformLocalStart + item.durationInFrames

  return {
    ...item,
    src: conformSrc,
    audioSrc: conformSrc,
    isReversed: undefined,
    speed: 1,
    sourceStart: conformLocalStart,
    trimStart: conformLocalStart,
    offset: conformLocalStart,
    sourceEnd: conformLocalEnd,
    sourceDuration: conformLocalEnd,
    sourceFps: timelineFps,
  }
}
