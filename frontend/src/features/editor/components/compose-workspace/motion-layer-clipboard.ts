import { toast } from 'sonner'
import {
  addItemsOnNewTracks,
  duplicateItemsWithTrackChanges,
  removeItems,
  setTracks,
  wouldCreateCompositionCycle,
} from '@/features/editor/deps/timeline-motion'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { useClipboardStore } from '@/shared/state/clipboard'
import { usePlaybackStore } from '@/shared/state/playback'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

type ClipboardTimelineItem = Omit<TimelineItem, 'id'>
type CompositionById = Parameters<typeof wouldCreateCompositionCycle>[0]['compositionById']

function clipboardHasLinkedPair(
  items: ClipboardTimelineItem[],
  item: ClipboardTimelineItem,
): boolean {
  return items.some(
    (candidate) =>
      candidate.linkedGroupId === item.linkedGroupId &&
      ((candidate.type === 'audio' && item.type === 'video') ||
        (candidate.type === 'video' && item.type === 'audio')),
  )
}

/** Fresh group ids for linked pairs, so a paste cannot join the copied pair's own group. */
function createPastedLinkedGroupIds(items: ClipboardTimelineItem[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const item of items) {
    if (!item.linkedGroupId || result.has(item.linkedGroupId)) continue
    if (clipboardHasLinkedPair(items, item)) result.set(item.linkedGroupId, crypto.randomUUID())
  }
  return result
}

function wouldSkipPastedComposition(
  item: ClipboardTimelineItem,
  activeCompositionId: string | null,
  compositionById: CompositionById,
): boolean {
  if (!activeCompositionId || !('compositionId' in item)) return false
  if (typeof item.compositionId !== 'string') return false
  return wouldCreateCompositionCycle({
    parentCompositionId: activeCompositionId,
    insertedCompositionId: item.compositionId,
    compositionById,
  })
}

function createPastedLayerTrack(params: {
  item: ClipboardTimelineItem
  sourceTrack: TimelineTrack | undefined
  trackId: string
  order: number
  height: number
  parentTrackId: string | undefined
}): TimelineTrack {
  const fallback: TimelineTrack = {
    id: params.trackId,
    name: params.item.label || params.item.type,
    kind: params.item.type === 'audio' ? 'audio' : 'video',
    order: params.order,
    height: params.height,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  }
  return {
    ...(params.sourceTrack ?? fallback),
    id: params.trackId,
    name: `${params.sourceTrack?.name ?? params.item.label ?? params.item.type} copy`,
    order: params.order,
    parentTrackId: params.parentTrackId,
    isGroup: false,
    items: [],
  }
}

function createPastedLayer(params: {
  item: ClipboardTimelineItem
  index: number
  pasteFrame: number
  maxOrder: number
  height: number
  parentTrackId: string | undefined
  activeCompositionId: string | null
  compositionById: CompositionById
  trackById: Map<string, TimelineTrack>
  linkedGroupIds: Map<string, string>
}): { track: TimelineTrack; item: TimelineItem } | null {
  if (wouldSkipPastedComposition(params.item, params.activeCompositionId, params.compositionById)) {
    return null
  }
  const trackId = crypto.randomUUID()
  const itemId = crypto.randomUUID()
  return {
    track: createPastedLayerTrack({
      item: params.item,
      sourceTrack: params.trackById.get(params.item.trackId),
      trackId,
      order: params.maxOrder + params.index + 1,
      height: params.height,
      parentTrackId: params.parentTrackId,
    }),
    item: {
      ...params.item,
      id: itemId,
      originId: itemId,
      trackId,
      from: Math.max(0, params.pasteFrame + params.item.from),
      linkedGroupId: params.item.linkedGroupId
        ? params.linkedGroupIds.get(params.item.linkedGroupId)
        : undefined,
    } as TimelineItem,
  }
}

/** Linked audio rides with its video, so only the visible half is selected. */
function getVisibleLinkedItems(items: TimelineItem[]): TimelineItem[] {
  const hiddenAudioIds = new Set(
    items.flatMap((item) => {
      const companion = getLinkedAudioCompanion(items, item)
      return companion ? [companion.id] : []
    }),
  )
  return items.filter((item) => !hiddenAudioIds.has(item.id))
}

export interface MotionLayerClipboardDeps {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  trackById: Map<string, TimelineTrack>
  compositionById: CompositionById
  activeCompositionId: string | null
  layerRowHeight: number
  selectItems: (itemIds: string[]) => void
  expandLayerItemIds: (itemIds: string[]) => string[]
}

export interface MotionLayerClipboardCommands {
  copy: (itemIds: string[]) => void
  duplicate: (itemIds: string[], sourceGroup?: TimelineTrack) => void
  paste: (parentTrackId?: string) => void
  delete: (itemIds: string[], trackIds: string[]) => void
}

/** One duplicate per source: a copy track at the bottom, the item on it. */
function buildDuplicatePlacement(input: {
  sourceItems: TimelineItem[]
  tracks: TimelineTrack[]
  trackById: Map<string, TimelineTrack>
  sourceGroup: TimelineTrack | undefined
  maxOrder: number
  height: number
}): { newTracks: TimelineTrack[]; positions: Array<{ from: number; trackId: string }> } {
  const newTracks: TimelineTrack[] = []
  const duplicatedGroupId = input.sourceGroup ? crypto.randomUUID() : null
  if (input.sourceGroup && duplicatedGroupId) {
    newTracks.push({
      ...input.sourceGroup,
      id: duplicatedGroupId,
      name: `${input.sourceGroup.name} copy`,
      order: input.maxOrder + 1,
      items: [],
      isCollapsed: false,
    })
  }
  const positions = input.sourceItems.map((item, index) => {
    const sourceTrack = input.trackById.get(item.trackId)
    const newTrackId = crypto.randomUUID()
    newTracks.push({
      ...(sourceTrack ?? {
        name: item.label || item.type,
        kind: item.type === 'audio' ? 'audio' : 'video',
        height: input.height,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        items: [],
      }),
      id: newTrackId,
      // A duplicate is named after the layer it copies, not after its track.
      name: `${item.label ?? sourceTrack?.name ?? item.type} copy`,
      order: input.maxOrder + newTracks.length + index + 1,
      parentTrackId: duplicatedGroupId ?? sourceTrack?.parentTrackId,
      isGroup: false,
      items: [],
    } as TimelineTrack)
    return { from: item.from, trackId: newTrackId }
  })
  return { newTracks, positions }
}

/**
 * Layer clipboard commands.
 *
 * Copy stores items without ids plus their originals, so a paste can mint new
 * ids and keep linked audio/video pairs together in a fresh group; duplicate
 * does the same inline, one copy track per source, without touching the
 * clipboard. Delete expands group members first so removing a layer group cannot
 * leave orphaned children behind.
 */
export function createMotionLayerClipboardCommands(
  deps: MotionLayerClipboardDeps,
): MotionLayerClipboardCommands {
  const copy = (itemIds: string[]): void => {
    const itemIdSet = new Set(deps.expandLayerItemIds(itemIds))
    const copiedItems = deps.items.filter((item) => itemIdSet.has(item.id))
    if (copiedItems.length === 0) return
    useClipboardStore
      .getState()
      .copyItems(copiedItems, usePlaybackStore.getState().currentFrame, 'copy')
    toast.success(itemIds.length === 1 ? 'Copied layer' : `Copied ${itemIds.length} layers`)
  }

  const duplicate = (itemIds: string[], sourceGroup?: TimelineTrack): void => {
    const expandedItemIds = deps.expandLayerItemIds(itemIds)
    const sourceItems = expandedItemIds
      .map((itemId) => deps.items.find((item) => item.id === itemId))
      .filter((item): item is TimelineItem => Boolean(item))
    if (sourceItems.length === 0) return

    const { newTracks, positions } = buildDuplicatePlacement({
      sourceItems,
      tracks: deps.tracks,
      trackById: deps.trackById,
      sourceGroup,
      maxOrder: Math.max(-1, ...deps.tracks.map((track) => track.order)),
      height: deps.layerRowHeight,
    })
    const duplicatedItems = duplicateItemsWithTrackChanges(
      [...deps.tracks, ...newTracks],
      sourceItems.map((item) => item.id),
      positions,
    )
    const duplicatedHiddenAudioIds = new Set(
      duplicatedItems.flatMap((item) => {
        const companion = getLinkedAudioCompanion(duplicatedItems, item)
        return companion ? [companion.id] : []
      }),
    )
    deps.selectItems(
      duplicatedItems
        .filter((item) => !duplicatedHiddenAudioIds.has(item.id))
        .map((item) => item.id),
    )
  }

  const paste = (parentTrackId?: string): void => {
    const clipboard = useClipboardStore.getState().itemsClipboard
    if (!clipboard || clipboard.items.length === 0) return
    const pasteFrame = usePlaybackStore.getState().currentFrame
    const maxOrder = Math.max(-1, ...deps.tracks.map((track) => track.order))
    const pastedLinkedGroupIds = createPastedLinkedGroupIds(clipboard.items)
    const pastedLayers = clipboard.items.flatMap((item, index) => {
      const pasted = createPastedLayer({
        item,
        index,
        pasteFrame,
        maxOrder,
        height: deps.layerRowHeight,
        parentTrackId,
        activeCompositionId: deps.activeCompositionId,
        compositionById: deps.compositionById,
        trackById: deps.trackById,
        linkedGroupIds: pastedLinkedGroupIds,
      })
      return pasted ? [pasted] : []
    })
    if (pastedLayers.length === 0) return
    const newItems = pastedLayers.map((layer) => layer.item)
    addItemsOnNewTracks(
      newItems,
      [...deps.tracks, ...pastedLayers.map((layer) => layer.track)],
    )
    const visiblePastedItems = getVisibleLinkedItems(newItems)
    deps.selectItems(visiblePastedItems.map((item) => item.id))
    toast.success(
      visiblePastedItems.length === 1
        ? 'Pasted layer'
        : `Pasted ${visiblePastedItems.length} layers`,
    )
  }

  const remove = (itemIds: string[], trackIds: string[]): void => {
    const expandedItemIds = deps.expandLayerItemIds(itemIds)
    removeItems(expandedItemIds)
    const expandedItemIdSet = new Set(expandedItemIds)
    const removedTrackIds = new Set([
      ...trackIds,
      ...deps.items
        .filter((item) => expandedItemIdSet.has(item.id))
        .map((item) => item.trackId),
    ])
    setTracks(deps.tracks.filter((track) => !removedTrackIds.has(track.id)))
    deps.selectItems([])
  }

  return { copy, duplicate, paste, delete: remove }
}
