import type { ReactNode } from 'react'
import type { TimelineItem } from '@/types/timeline'

export function getItemAspectRatio(item: TimelineItem | null): number {
  if (
    item &&
    (item.type === 'video' || item.type === 'image') &&
    item.sourceWidth &&
    item.sourceHeight
  ) {
    return item.sourceWidth / item.sourceHeight
  }
  if (item?.type === 'composition' && item.compositionWidth && item.compositionHeight) {
    return item.compositionWidth / item.compositionHeight
  }
  return 16 / 9
}

export function computeFittedMediaSize(
  panelWidth: number,
  areaHeight: number,
  aspectRatio: number,
): {
  mediaWidth: number
  mediaHeight: number
} {
  let mediaWidth = panelWidth
  let mediaHeight = panelWidth / aspectRatio
  if (mediaHeight > areaHeight) {
    mediaHeight = areaHeight
    mediaWidth = areaHeight * aspectRatio
  }

  return {
    mediaWidth: Math.max(mediaWidth, 1),
    mediaHeight: Math.max(mediaHeight, 1),
  }
}

export interface PanelMediaRenderers {
  renderVideo: (item: TimelineItem, sourceTime: number) => ReactNode
  renderImage: (item: TimelineItem) => ReactNode
  renderComposition: (item: TimelineItem, sourceFrame: number) => ReactNode
  renderPlaceholder: (type: string, text: string) => ReactNode
}

export function renderPanelMedia(
  item: TimelineItem | null,
  sourceTime: number | undefined,
  placeholderText: string | undefined,
  renderers: PanelMediaRenderers,
  sourceFrame?: number,
): ReactNode {
  if (!item) {
    return renderers.renderPlaceholder('gap', placeholderText ?? 'GAP')
  }

  if (item.type === 'video') {
    return renderers.renderVideo(item, sourceTime ?? 0)
  }

  if (item.type === 'image') {
    return renderers.renderImage(item)
  }

  if (item.type === 'composition') {
    const fallbackSourceFrame = Math.max(
      0,
      Math.round((sourceTime ?? 0) * Math.max(1, item.sourceFps ?? 30)),
    )
    return renderers.renderComposition(item, sourceFrame ?? fallbackSourceFrame)
  }

  return renderers.renderPlaceholder(item.type, placeholderText ?? item.type)
}
