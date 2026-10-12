import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineItemOverlayStore } from '@/features/timeline/stores/timeline-item-overlay-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { sourceSecondsToTimelineFrame } from '@/features/timeline/utils/media-item-frames'
import type { AudioSilenceRange } from '@/shared/utils/audio-silence'

export interface RemovalPreviewSummary {
  rangeCount: number
  totalSeconds: number
}

export function isAudioVideoItem(item: TimelineItem | undefined): item is TimelineItem & {
  type: 'video' | 'audio'
  mediaId: string
} {
  return (
    item !== undefined &&
    (item.type === 'video' || item.type === 'audio') &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0
  )
}

function getItemPreviewRanges(
  item: TimelineItem,
  ranges: readonly AudioSilenceRange[],
  timelineFps: number,
): Array<{ startRatio: number; endRatio: number; seconds: number }> {
  return ranges.flatMap((range) => {
    const mappedStartFrame = sourceSecondsToTimelineFrame(item, range.start, timelineFps)
    const mappedEndFrame = sourceSecondsToTimelineFrame(item, range.end, timelineFps)
    const startFrame = Math.min(mappedStartFrame, mappedEndFrame)
    const endFrame = Math.max(mappedStartFrame, mappedEndFrame)
    const startRatio = Math.max(0, Math.min(1, (startFrame - item.from) / item.durationInFrames))
    const endRatio = Math.max(0, Math.min(1, (endFrame - item.from) / item.durationInFrames))
    if (endRatio <= startRatio) return []
    return [
      {
        startRatio,
        endRatio,
        seconds: ((endRatio - startRatio) * item.durationInFrames) / timelineFps,
      },
    ]
  })
}

export function clearRemovalPreviewOverlays(
  itemIds: readonly string[],
  overlayId: string,
  overlayStore: ReturnType<
    typeof useTimelineItemOverlayStore.getState
  > = useTimelineItemOverlayStore.getState(),
): void {
  for (const itemId of itemIds) {
    overlayStore.removeOverlay(itemId, overlayId)
  }
}

export function applyRemovalPreviewOverlays(params: {
  itemIds: readonly string[]
  rangesByMediaId: Record<string, readonly AudioSilenceRange[]>
  overlayId: string
  labelNoun: string
  tone: 'warning' | 'error'
}): RemovalPreviewSummary {
  const timelineFps = useTimelineSettingsStore.getState().fps
  const itemsById = useItemsStore.getState().itemById
  const overlayStore = useTimelineItemOverlayStore.getState()
  const secondsByLogicalRange = new Map<string, number>()

  for (const itemId of params.itemIds) {
    const item = itemsById[itemId]
    if (!isAudioVideoItem(item)) {
      overlayStore.removeOverlay(itemId, params.overlayId)
      continue
    }

    const ranges = params.rangesByMediaId[item.mediaId] ?? []
    const previewRanges = getItemPreviewRanges(item, ranges, timelineFps)
    if (previewRanges.length === 0) {
      overlayStore.removeOverlay(itemId, params.overlayId)
      continue
    }

    ranges.forEach((range) => {
      const previewRange = getItemPreviewRanges(item, [range], timelineFps)[0]
      if (!previewRange) return
      const key = `${item.originId ?? item.id}:${item.mediaId}:${range.start.toFixed(6)}:${range.end.toFixed(6)}`
      if (!secondsByLogicalRange.has(key)) secondsByLogicalRange.set(key, previewRange.seconds)
    })
    overlayStore.upsertOverlay(itemId, {
      id: params.overlayId,
      label: `${previewRanges.length} ${params.labelNoun} range${previewRanges.length === 1 ? '' : 's'}`,
      tone: params.tone,
      ranges: previewRanges.map((range) => ({
        startRatio: range.startRatio,
        endRatio: range.endRatio,
      })),
    })
  }

  return {
    rangeCount: secondsByLogicalRange.size,
    totalSeconds: Array.from(secondsByLogicalRange.values()).reduce(
      (sum, seconds) => sum + seconds,
      0,
    ),
  }
}
