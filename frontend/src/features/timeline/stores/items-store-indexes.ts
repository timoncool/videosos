import type { AudioItem, TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'
import { useTransitionsStore } from './transitions-store'

export interface ItemsIndexState {
  items: TimelineItem[]
  itemsByTrackId: Record<string, TimelineItem[]>
  itemById: Record<string, TimelineItem>
  itemsByLinkedGroupId: Record<string, TimelineItem[]>
  linkedItemsByItemId: Record<string, TimelineItem[]>
  captionIdsByClipId: Record<string, string[]>
  maxItemEndFrame: number
}

type TrackRelationTarget = Pick<TimelineItem, 'id' | 'from' | 'durationInFrames'>

interface TrackBoundaryCandidate {
  item: TimelineItem
  order: number
}

interface TrackRelationIndex {
  candidatesByStart: Map<number, TrackBoundaryCandidate[]>
  candidatesByEnd: Map<number, TrackBoundaryCandidate[]>
  itemById: Map<string, TimelineItem>
  sortedEndFrames: number[]
  relationsByItemId: Map<string, TrackItemRelations>
}

export interface TrackItemRelations {
  /**
   * Matches the legacy reactive selector: the last left/right ids encountered
   * in track order, with a left match taking precedence over a right match.
   */
  neighborKey: string
  /** Matches the legacy `Array.find` lookup: first adjacent item in track order. */
  leftNeighbor: TimelineItem | null
  /** Matches the legacy `Array.find` lookup: first adjacent item in track order. */
  rightNeighbor: TimelineItem | null
  /** Maximum empty span immediately before the item. */
  gapBeforeFrames: number
  /**
   * Matches the drag-join scan, which stops as soon as both sides have been
   * found and therefore has different duplicate-boundary tie behavior.
   */
  dragNeighborIds: {
    leftId: string | null
    rightId: string | null
  }
}

const EMPTY_TRACK_ITEM_RELATIONS: TrackItemRelations = Object.freeze({
  neighborKey: '|',
  leftNeighbor: null,
  rightNeighbor: null,
  gapBeforeFrames: 0,
  dragNeighborIds: Object.freeze({
    leftId: null,
    rightId: null,
  }),
})

/**
 * Per-track arrays retain their identity when another track changes. Cache the
 * boundary index by that identity so one item-store update pays for at most one
 * relation build per changed track instead of every mounted clip rescanning it.
 */
const trackRelationIndexCache = new WeakMap<ReadonlyArray<TimelineItem>, TrackRelationIndex>()

function appendBoundaryCandidate(
  map: Map<number, TrackBoundaryCandidate[]>,
  frame: number,
  candidate: TrackBoundaryCandidate,
) {
  const candidates = map.get(frame)
  if (candidates) {
    candidates.push(candidate)
  } else {
    map.set(frame, [candidate])
  }
}

function findFirstCandidate(
  candidates: TrackBoundaryCandidate[] | undefined,
  targetId: string,
  include: (candidate: TrackBoundaryCandidate) => boolean = () => true,
): TrackBoundaryCandidate | null {
  if (!candidates) return null
  for (const candidate of candidates) {
    if (candidate.item.id !== targetId && include(candidate)) {
      return candidate
    }
  }
  return null
}

function findLastCandidate(
  candidates: TrackBoundaryCandidate[] | undefined,
  targetId: string,
  include: (candidate: TrackBoundaryCandidate) => boolean = () => true,
  maxOrder = Number.POSITIVE_INFINITY,
): TrackBoundaryCandidate | null {
  if (!candidates) return null
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!
    if (candidate.order <= maxOrder && candidate.item.id !== targetId && include(candidate)) {
      return candidate
    }
  }
  return null
}

function findPreviousEndFrame(
  index: TrackRelationIndex,
  targetId: string,
  targetStart: number,
): number {
  let low = 0
  let high = index.sortedEndFrames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (index.sortedEndFrames[middle]! <= targetStart) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  for (let frameIndex = low - 1; frameIndex >= 0; frameIndex--) {
    const endFrame = index.sortedEndFrames[frameIndex]!
    const candidates = index.candidatesByEnd.get(endFrame)
    if (candidates?.some((candidate) => candidate.item.id !== targetId)) {
      return endFrame
    }
  }
  return 0
}

function resolveTrackItemRelations(
  index: TrackRelationIndex,
  target: TrackRelationTarget,
): TrackItemRelations {
  const targetEnd = target.from + target.durationInFrames
  const leftCandidates = index.candidatesByEnd.get(target.from)
  const rightCandidates = index.candidatesByStart.get(targetEnd)
  // The legacy neighbor-key/drag scans use `if (...) left; else if (...) right`.
  // A malformed zero-duration candidate that matches both boundaries therefore
  // belongs only to the left side. Normalized timeline items are at least 1 frame,
  // but retaining this precedence keeps the index behavior exact for raw callers.
  const isRightOnlyCandidate = (candidate: TrackBoundaryCandidate) =>
    candidate.item.from + candidate.item.durationInFrames !== target.from

  const firstLeft = findFirstCandidate(leftCandidates, target.id)
  const firstRight = findFirstCandidate(rightCandidates, target.id)
  const keyLeft = findLastCandidate(leftCandidates, target.id)
  const keyRight = findLastCandidate(rightCandidates, target.id, isRightOnlyCandidate)

  const firstDragLeft = firstLeft
  const firstDragRight = findFirstCandidate(rightCandidates, target.id, isRightOnlyCandidate)
  const dragStopOrder =
    firstDragLeft && firstDragRight
      ? Math.max(firstDragLeft.order, firstDragRight.order)
      : Number.POSITIVE_INFINITY
  const dragLeft = findLastCandidate(leftCandidates, target.id, () => true, dragStopOrder)
  const dragRight = findLastCandidate(
    rightCandidates,
    target.id,
    isRightOnlyCandidate,
    dragStopOrder,
  )

  const previousEndFrame = findPreviousEndFrame(index, target.id, target.from)

  return {
    neighborKey: `${keyLeft?.item.id ?? ''}|${keyRight?.item.id ?? ''}`,
    leftNeighbor: firstLeft?.item ?? null,
    rightNeighbor: firstRight?.item ?? null,
    gapBeforeFrames: Math.max(0, target.from - previousEndFrame),
    dragNeighborIds: {
      leftId: dragLeft?.item.id ?? null,
      rightId: dragRight?.item.id ?? null,
    },
  }
}

function buildTrackRelationIndex(trackItems: ReadonlyArray<TimelineItem>): TrackRelationIndex {
  const index: TrackRelationIndex = {
    candidatesByStart: new Map(),
    candidatesByEnd: new Map(),
    itemById: new Map(),
    sortedEndFrames: [],
    relationsByItemId: new Map(),
  }

  for (let order = 0; order < trackItems.length; order++) {
    const item = trackItems[order]!
    const candidate = { item, order }
    index.itemById.set(item.id, item)
    appendBoundaryCandidate(index.candidatesByStart, item.from, candidate)
    appendBoundaryCandidate(index.candidatesByEnd, item.from + item.durationInFrames, candidate)
  }
  index.sortedEndFrames = [...index.candidatesByEnd.keys()].sort((left, right) => left - right)

  for (const item of trackItems) {
    index.relationsByItemId.set(item.id, resolveTrackItemRelations(index, item))
  }

  return index
}

/**
 * Return spatial relations for one item without rescanning its entire track.
 *
 * Store-backed callers hit the prebuilt id map. The geometry fallback preserves
 * behavior for tests or preview callers that pass an item not present in the
 * supplied array.
 */
export function getTrackItemRelations(
  trackItems: ReadonlyArray<TimelineItem> | undefined,
  target: TrackRelationTarget,
): TrackItemRelations {
  if (!trackItems || trackItems.length === 0) {
    if (target.from <= 0) return EMPTY_TRACK_ITEM_RELATIONS
    return {
      ...EMPTY_TRACK_ITEM_RELATIONS,
      gapBeforeFrames: target.from,
    }
  }

  let index = trackRelationIndexCache.get(trackItems)
  if (!index) {
    index = buildTrackRelationIndex(trackItems)
    trackRelationIndexCache.set(trackItems, index)
  }

  const storedItem = index.itemById.get(target.id)
  if (
    storedItem &&
    storedItem.from === target.from &&
    storedItem.durationInFrames === target.durationInFrames
  ) {
    return index.relationsByItemId.get(target.id) ?? EMPTY_TRACK_ITEM_RELATIONS
  }

  return resolveTrackItemRelations(index, target)
}

function areItemArraysEqual(a: TimelineItem[] | undefined, b: TimelineItem[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function areStringArraysEqual(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function buildItemsByTrackId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    ;(grouped[item.trackId] ??= []).push(item)
  }

  const next: Record<string, TimelineItem[]> = {}
  for (const [trackId, trackItems] of Object.entries(grouped)) {
    const previousTrackItems = previous[trackId]
    next[trackId] =
      previousTrackItems && areItemArraysEqual(previousTrackItems, trackItems)
        ? previousTrackItems
        : trackItems
  }

  return next
}

function buildItemsByLinkedGroupId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    if (item.linkedGroupId) {
      ;(grouped[item.linkedGroupId] ??= []).push(item)
    }
  }

  const next: Record<string, TimelineItem[]> = {}
  for (const [groupId, groupItems] of Object.entries(grouped)) {
    const previousGroupItems = previous[groupId]
    next[groupId] =
      previousGroupItems && areItemArraysEqual(previousGroupItems, groupItems)
        ? previousGroupItems
        : groupItems
  }

  return next
}

function isCaptionableClip(item: TimelineItem): item is AudioItem | VideoItem {
  return (
    (item.type === 'audio' || item.type === 'video') &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0
  )
}

function isLegacyGeneratedCaptionItem(item: TimelineItem): item is TextItem {
  const plainText = item.type === 'text' ? getTextItemPlainText(item) : ''
  return (
    item.type === 'text' &&
    !item.captionSource &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0 &&
    plainText.trim().length > 0 &&
    item.label === plainText.slice(0, 48)
  )
}

// Lazy, items-keyed memoization. The legacy caption-detection pass is O(N) with
// string slicing + per-mediaId sorts; running it inside withItemIndexes makes
// every drag-frame mutation pay for it. Callers go through
// `selectReplaceableCaptionClipIds` instead, which rebuilds only when `items`
// changes identity.
let captionCacheItems: TimelineItem[] | null = null
let captionCacheSet: Set<string> = new Set()

export function selectReplaceableCaptionClipIds(state: { items: TimelineItem[] }): Set<string> {
  if (captionCacheItems === state.items) return captionCacheSet
  captionCacheItems = state.items
  captionCacheSet = buildReplaceableCaptionClipIds(state.items)
  return captionCacheSet
}

// Items-keyed memo for per-cue caption ownership (embedded subtitles and
// subtitle imports). Every mounted clip asks whether it owns consolidatable
// captions on each store notification; a raw scan would be O(N²).
let consolidatableCaptionItems: TimelineItem[] | null = null
let consolidatableCaptionClipIds: Set<string> = new Set()

export function selectConsolidatableCaptionClipIds(state: {
  items: TimelineItem[]
}): Set<string> {
  if (consolidatableCaptionItems === state.items) return consolidatableCaptionClipIds
  const ids = new Set<string>()
  for (const item of state.items) {
    if (item.type !== 'text') continue
    const source = item.captionSource
    if (
      source &&
      (source.type === 'embedded-subtitles' || source.type === 'subtitle-import') &&
      source.clipId
    ) {
      ids.add(source.clipId)
    }
  }
  consolidatableCaptionItems = state.items
  consolidatableCaptionClipIds = ids
  return ids
}

// Items-keyed memo for the audio mixer graph. Returning the same array while
// items are unchanged keeps the mixer panel from re-filtering (and rebuilding
// its graph) on every unrelated item edit.
let audioGraphItemsCacheItems: TimelineItem[] | null = null
let audioGraphItemsCache: TimelineItem[] = []

export function selectAudioGraphItems(state: { items: TimelineItem[] }): TimelineItem[] {
  if (audioGraphItemsCacheItems === state.items) return audioGraphItemsCache
  audioGraphItemsCacheItems = state.items
  audioGraphItemsCache = state.items.filter(
    (item) => item.type === 'audio' || item.type === 'video' || item.type === 'composition',
  )
  return audioGraphItemsCache
}

// Items-keyed memo for consumers that only need stable item ids (marquee hit
// testing at the timeline root). Avoids re-allocating the id array on every
// unrelated items update.
let itemIdsCacheItems: TimelineItem[] | null = null
let itemIdsCache: string[] = []

export function selectItemIds(state: { items: TimelineItem[] }): string[] {
  if (itemIdsCacheItems === state.items) return itemIdsCache
  itemIdsCacheItems = state.items
  itemIdsCache = state.items.map((item) => item.id)
  return itemIdsCache
}

function buildReplaceableCaptionClipIds(items: TimelineItem[]): Set<string> {
  const ids = new Set<string>()
  const clipsByMediaId: Record<string, Array<AudioItem | VideoItem>> = {}

  for (const item of items) {
    if (
      item.type === 'text' &&
      item.captionSource?.type === 'transcript' &&
      item.captionSource.clipId
    ) {
      ids.add(item.captionSource.clipId)
      continue
    }

    if (item.type === 'subtitle' && item.source.type === 'transcript' && item.source.clipId) {
      ids.add(item.source.clipId)
      continue
    }

    if (
      isCaptionableClip(item) &&
      item.transcriptCaptions?.type === 'transcript' &&
      item.transcriptCaptions.cues.length > 0
    ) {
      ids.add(item.id)
    }

    if (isCaptionableClip(item)) {
      const mediaId = item.mediaId
      if (!mediaId) continue
      ;(clipsByMediaId[mediaId] ??= []).push(item)
    }
  }

  for (const clips of Object.values(clipsByMediaId)) {
    clips.sort((left, right) => left.from - right.from)
  }

  for (const item of items) {
    if (!isLegacyGeneratedCaptionItem(item) || !item.mediaId) {
      continue
    }

    const mediaId = item.mediaId
    const itemEnd = item.from + item.durationInFrames
    const candidateClips = clipsByMediaId[mediaId]
    if (!candidateClips) {
      continue
    }

    for (const clip of candidateClips) {
      if (clip.from > item.from) {
        break
      }

      const clipEnd = clip.from + clip.durationInFrames
      if (item.from >= clip.from && itemEnd <= clipEnd) {
        ids.add(clip.id)
      }
    }
  }

  return ids
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (
    (left.type === 'video' && right.type === 'audio') ||
    (left.type === 'audio' && right.type === 'video')
  )
}

function isLegacyLinkCandidate(item: TimelineItem): item is AudioItem | VideoItem {
  return (
    !item.linkedGroupId &&
    isCaptionableClip(item) &&
    typeof item.originId === 'string' &&
    item.originId.length > 0
  )
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false
  if (!anchor.originId || anchor.originId !== candidate.originId) return false
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames
}

function buildLinkedItemsByItemId(
  items: TimelineItem[],
  itemsByLinkedGroupId: Record<string, TimelineItem[]>,
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const next: Record<string, TimelineItem[]> = {}

  for (const groupItems of Object.values(itemsByLinkedGroupId)) {
    if (groupItems.length <= 1) {
      continue
    }

    for (const item of groupItems) {
      next[item.id] = groupItems
    }
  }

  const legacyGroups: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    if (!isLegacyLinkCandidate(item)) {
      continue
    }

    const key = `${item.originId}|${item.mediaId}|${item.from}|${item.durationInFrames}`
    ;(legacyGroups[key] ??= []).push(item)
  }

  for (const groupItems of Object.values(legacyGroups)) {
    if (groupItems.length <= 1) {
      continue
    }

    for (const anchor of groupItems) {
      const linkedItems = groupItems.filter(
        (candidate) => candidate.id === anchor.id || isLegacyLinkedPair(anchor, candidate),
      )

      if (linkedItems.length <= 1) {
        continue
      }

      const previousLinkedItems = previous[anchor.id]
      next[anchor.id] =
        previousLinkedItems && areItemArraysEqual(previousLinkedItems, linkedItems)
          ? previousLinkedItems
          : linkedItems
    }
  }

  return next
}

function buildItemById(
  items: TimelineItem[],
  previous: Record<string, TimelineItem>,
): Record<string, TimelineItem> {
  const next: Record<string, TimelineItem> = {}
  for (const item of items) {
    const previousItem = previous[item.id]
    next[item.id] = previousItem !== undefined && previousItem === item ? previousItem : item
  }
  return next
}

function buildCaptionIdsByClipId(
  items: TimelineItem[],
  previous: Record<string, string[]>,
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const item of items) {
    if (item.type !== 'text') continue
    const clipId = item.captionSource?.clipId
    if (clipId) {
      ;(grouped[clipId] ??= []).push(item.id)
    }
  }

  const next: Record<string, string[]> = {}
  for (const [clipId, ids] of Object.entries(grouped)) {
    const previousIds = previous[clipId]
    next[clipId] = previousIds && areStringArraysEqual(previousIds, ids) ? previousIds : ids
  }
  return next
}

export function buildItemsMediaDependencyIds(items: TimelineItem[]): string[] {
  const mediaIds = new Set<string>()
  for (const item of items) {
    if (item.mediaId) {
      mediaIds.add(item.mediaId)
    }
  }
  return [...mediaIds].sort()
}

export function buildMediaDependencyKey(mediaDependencyIds: string[]): string {
  return mediaDependencyIds.join('|')
}

function computeMaxItemEndFrame(items: TimelineItem[]): number {
  let max = 0
  for (const item of items) {
    const end = item.from + item.durationInFrames
    if (end > max) max = end
  }
  return max
}

export function withItemIndexes(
  items: TimelineItem[],
  previous: Pick<
    ItemsIndexState,
    | 'itemsByTrackId'
    | 'itemById'
    | 'itemsByLinkedGroupId'
    | 'linkedItemsByItemId'
    | 'captionIdsByClipId'
  >,
): ItemsIndexState {
  const itemsByLinkedGroupId = buildItemsByLinkedGroupId(items, previous.itemsByLinkedGroupId)
  return {
    items,
    itemsByTrackId: buildItemsByTrackId(items, previous.itemsByTrackId),
    itemById: buildItemById(items, previous.itemById),
    itemsByLinkedGroupId,
    linkedItemsByItemId: buildLinkedItemsByItemId(
      items,
      itemsByLinkedGroupId,
      previous.linkedItemsByItemId,
    ),
    captionIdsByClipId: buildCaptionIdsByClipId(items, previous.captionIdsByClipId),
    maxItemEndFrame: computeMaxItemEndFrame(items),
  }
}

/**
 * Get IDs of clips that have a transition with the given item.
 * These clips are allowed to overlap during trim operations.
 */
export function getTransitionLinkedIds(itemId: string): Set<string> {
  const transitions = useTransitionsStore.getState().transitions
  const linkedIds = new Set<string>()
  for (const t of transitions) {
    if (t.leftClipId === itemId) linkedIds.add(t.rightClipId)
    if (t.rightClipId === itemId) linkedIds.add(t.leftClipId)
  }
  return linkedIds
}

export function buildRippleShiftByItemId(
  items: TimelineItem[],
  deletedItems: TimelineItem[],
  linkedItemsByItemId: Record<string, TimelineItem[]> = {},
): Map<string, number> {
  const shiftByItemId = new Map<string, number>()

  for (const item of items) {
    let shiftAmount = 0
    for (const deletedItem of deletedItems) {
      if (
        deletedItem.trackId === item.trackId &&
        deletedItem.from + deletedItem.durationInFrames <= item.from
      ) {
        shiftAmount += deletedItem.durationInFrames
      }
    }
    shiftByItemId.set(item.id, shiftAmount)
  }

  const visited = new Set<string>()
  for (const item of items) {
    if (visited.has(item.id)) continue

    // Use the precomputed linked index (which also covers legacy pairs) instead
    // of re-scanning the whole array with getLinkedItems per item (O(N²)).
    const linkedItems = linkedItemsByItemId[item.id] ?? [item]
    for (const linkedItem of linkedItems) {
      visited.add(linkedItem.id)
    }

    if (linkedItems.length <= 1) continue

    let groupShift = 0
    for (const linkedItem of linkedItems) {
      groupShift = Math.max(groupShift, shiftByItemId.get(linkedItem.id) ?? 0)
    }

    if (groupShift <= 0) continue

    for (const linkedItem of linkedItems) {
      shiftByItemId.set(linkedItem.id, groupShift)
    }
  }

  return shiftByItemId
}
