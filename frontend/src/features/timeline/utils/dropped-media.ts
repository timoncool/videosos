import type { TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  buildMediaTimelineItem,
  buildMediaTimelineItems,
  type LinkedMediaTimelinePlacement,
  type MediaTimelineItemType,
  type MediaTimelinePlacement,
} from './media-timeline-item-builder'

export type DroppableMediaType = MediaTimelineItemType

export interface TimelineMediaPlacement extends Required<MediaTimelinePlacement> {}

export interface TimelineLinkedMediaPlacement {
  primary: TimelineMediaPlacement
  linkedAudio?: TimelineMediaPlacement
}

export function getDroppedMediaDurationInFrames(
  media: Pick<MediaMetadata, 'duration'> & Partial<Pick<MediaMetadata, 'fps'>>,
  mediaType: DroppableMediaType,
  timelineFps: number,
): number {
  if (mediaType === 'lottie') {
    const lottieFrames = Math.round(media.duration * (media.fps || timelineFps))
    // Guard against missing/invalid metadata producing a zero-length clip.
    return lottieFrames > 0 ? lottieFrames : timelineFps
  }

  const durationInFrames = Math.round(media.duration * timelineFps)
  if (durationInFrames > 0) {
    return durationInFrames
  }

  return mediaType === 'image' ? timelineFps * 3 : timelineFps
}

export function buildDroppedMediaTimelineItem(params: {
  media: MediaMetadata
  mediaId: string
  mediaType: DroppableMediaType
  label: string
  timelineFps: number
  blobUrl: string
  thumbnailUrl?: string | null
  canvasWidth: number
  canvasHeight: number
  placement: TimelineMediaPlacement
  originId?: string
  linkedGroupId?: string
}): TimelineItem {
  return buildMediaTimelineItem({
    media: params.media,
    mediaId: params.mediaId,
    mediaType: params.mediaType,
    label: params.label,
    projectFps: params.timelineFps,
    blobUrl: params.blobUrl,
    thumbnailUrl: params.thumbnailUrl,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    placement: params.placement,
    originId: params.originId ?? crypto.randomUUID(),
    linkedGroupId: params.linkedGroupId,
  })
}

export function buildDroppedMediaTimelineItems(params: {
  media: MediaMetadata
  mediaId: string
  mediaType: DroppableMediaType
  label: string
  timelineFps: number
  blobUrl: string
  thumbnailUrl?: string | null
  canvasWidth: number
  canvasHeight: number
  placement: TimelineLinkedMediaPlacement
  linkVideoAudio?: boolean
}): TimelineItem[] {
  return buildMediaTimelineItems({
    media: params.media,
    mediaId: params.mediaId,
    mediaType: params.mediaType,
    label: params.label,
    projectFps: params.timelineFps,
    blobUrl: params.blobUrl,
    thumbnailUrl: params.thumbnailUrl,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    placements: params.placement satisfies LinkedMediaTimelinePlacement,
    linkVideoAudio: params.linkVideoAudio,
  })
}
