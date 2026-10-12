import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

export interface DomTextScrubOverlayPlan {
  enabled: boolean
  textTracks: TimelineTrack[]
  textKeyframes: ItemKeyframes[]
}

interface OrderedItem<TItem extends TimelineItem = TimelineItem> {
  item: TItem
  order: number
}

interface VisibleOverlayItems {
  text: Array<OrderedItem<Extract<TimelineItem, { type: 'text' }>>>
  nonText: OrderedItem[]
  hasMaskOrAdjustment: boolean
}

function isRenderableVisualItem(item: TimelineItem): boolean {
  if (item.type === 'audio' || item.type === 'adjustment' || item.type === 'controller') {
    return false
  }
  return item.type !== 'shape' || item.isMask !== true
}

function hasTextMotion(item: Extract<TimelineItem, { type: 'text' }>): boolean {
  return Boolean(item.textMotion?.in || item.textMotion?.out || item.textMotion?.loop)
}

function hasEnabledEffects(item: TimelineItem): boolean {
  return item.effects?.some((effect) => effect.enabled !== false) === true
}

function overlaps(a: TimelineItem, b: TimelineItem): boolean {
  return a.from < b.from + b.durationInFrames && b.from < a.from + a.durationInFrames
}

function isMaskOrAdjustment(item: TimelineItem): boolean {
  return item.type === 'adjustment' || (item.type === 'shape' && item.isMask === true)
}

function appendVisibleTrackItems(track: TimelineTrack, visible: VisibleOverlayItems): void {
  const order = track.order ?? 0
  for (const item of track.items) {
    if (isMaskOrAdjustment(item)) visible.hasMaskOrAdjustment = true
    if (!isRenderableVisualItem(item)) continue
    if (item.type === 'text') visible.text.push({ item, order })
    else visible.nonText.push({ item, order })
  }
}

function collectVisibleOverlayItems(tracks: TimelineTrack[]): VisibleOverlayItems {
  const visible: VisibleOverlayItems = {
    text: [],
    nonText: [],
    hasMaskOrAdjustment: false,
  }

  for (const track of tracks) {
    if (!track.visible) continue
    appendVisibleTrackItems(track, visible)
  }

  return visible
}

function isDomSafeText(item: Extract<TimelineItem, { type: 'text' }>): boolean {
  return (
    !hasTextMotion(item) &&
    !hasEnabledEffects(item) &&
    (!item.blendMode || item.blendMode === 'normal') &&
    !item.transformParent?.parentItemId
  )
}

function staysAboveOverlappingItems(text: OrderedItem, nonText: OrderedItem[]): boolean {
  return nonText.every((other) => !overlaps(text.item, other.item) || text.order < other.order)
}

/**
 * Split top-most, DOM-safe text from the fast scrub composition.
 *
 * A single DOM overlay can only preserve stacking when no visible non-text
 * item overlaps above a text item. Complex compositing stays on the canonical
 * full-DOM path instead of accepting a subtly incorrect preview.
 */
export function buildDomTextScrubOverlayPlan(
  tracks: TimelineTrack[],
  keyframes: ItemKeyframes[],
): DomTextScrubOverlayPlan {
  const visible = collectVisibleOverlayItems(tracks)
  const textIsDomSafe = visible.text.every(({ item }) => isDomSafeText(item))
  const textStaysTopMost = visible.text.every((text) =>
    staysAboveOverlappingItems(text, visible.nonText),
  )
  const enabled =
    visible.text.length > 0 && textIsDomSafe && textStaysTopMost && !visible.hasMaskOrAdjustment

  if (!enabled) {
    return {
      enabled: false,
      textTracks: [],
      textKeyframes: [],
    }
  }

  const textItemIds = new Set(visible.text.map(({ item }) => item.id))
  return {
    enabled: true,
    textTracks: tracks.map((track) => ({
      ...track,
      items: track.items.filter((item) => item.type === 'text'),
    })),
    textKeyframes: keyframes.filter((entry) => textItemIds.has(entry.itemId)),
  }
}
