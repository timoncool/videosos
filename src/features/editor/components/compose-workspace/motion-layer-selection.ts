import { setTracks } from '@/features/editor/deps/timeline-motion'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

interface LayerEntry {
  item: TimelineItem
  track: TimelineTrack | undefined
}

export interface MotionLayerSelectionState {
  /** Last clicked layer, used as the anchor for Shift ranges. */
  anchorIdRef: { current: string | null }
}

export interface MotionLayerSelectionDeps {
  selectedItemIds: string[]
  selectedItemIdSet: Set<string>
  visibleLayerIds: string[]
  layerEntries: LayerEntry[]
  tracks: TimelineTrack[]
  layerRowHeight: number
  selectItems: (itemIds: string[]) => void
  formatGroupName: (groupNumber: number) => string
}

export interface MotionLayerSelectionCommands {
  selectLayer: (itemId: string, modifiers: { toggle?: boolean; range?: boolean }) => void
  prepareLayerContextMenu: (itemId: string) => void
  prepareGroupContextMenu: (itemIds: string[]) => void
  createGroupFromSelection: () => void
  ungroupTracks: (groupId: string) => void
}

/**
 * Selection and grouping for layer rows.
 *
 * A plain click replaces the selection, Ctrl/Cmd toggles one layer and Shift
 * extends from the anchor through the *visible* order — so collapsing rows
 * changes what a range means, which is why the range is computed from
 * `visibleLayerIds` rather than the item list. Grouping needs two selected
 * tracks to be worth doing; ungrouping clears the parent link instead of deleting
 * the group's children.
 */
export function createMotionLayerSelectionCommands(input: {
  state: MotionLayerSelectionState
  deps: MotionLayerSelectionDeps
}): MotionLayerSelectionCommands {
  const { anchorIdRef } = input.state
  const deps = input.deps

  const selectLayer = (
    itemId: string,
    modifiers: { toggle?: boolean; range?: boolean } = {},
  ): void => {
    if (modifiers.range) {
      const anchorId = anchorIdRef.current ?? deps.selectedItemIds.at(-1) ?? null
      const anchorIndex = anchorId ? deps.visibleLayerIds.indexOf(anchorId) : -1
      const itemIndex = deps.visibleLayerIds.indexOf(itemId)
      if (anchorIndex >= 0 && itemIndex >= 0) {
        const rangeStart = Math.min(anchorIndex, itemIndex)
        const rangeEnd = Math.max(anchorIndex, itemIndex)
        deps.selectItems(
          Array.from(
            new Set([
              ...deps.selectedItemIds,
              ...deps.visibleLayerIds.slice(rangeStart, rangeEnd + 1),
            ]),
          ),
        )
        return
      }
    }

    anchorIdRef.current = itemId
    if (!modifiers.toggle) {
      deps.selectItems([itemId])
      return
    }
    deps.selectItems(
      deps.selectedItemIdSet.has(itemId)
        ? deps.selectedItemIds.filter((id) => id !== itemId)
        : [...deps.selectedItemIds, itemId],
    )
  }

  const prepareLayerContextMenu = (itemId: string): void => {
    if (deps.selectedItemIdSet.has(itemId)) return
    anchorIdRef.current = itemId
    deps.selectItems([itemId])
  }

  const prepareGroupContextMenu = (itemIds: string[]): void => {
    if (itemIds.length > 0 && itemIds.every((itemId) => deps.selectedItemIdSet.has(itemId))) return
    deps.selectItems(itemIds)
  }

  const createGroupFromSelection = (): void => {
    const selectedTrackIds = Array.from(
      new Set(
        deps.layerEntries
          .filter((entry) => deps.selectedItemIdSet.has(entry.item.id))
          .map((entry) => entry.track?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    )
    if (selectedTrackIds.length < 2) return
    const selectedTracks = deps.tracks.filter((track) => selectedTrackIds.includes(track.id))
    const groupId = crypto.randomUUID()
    const groupNumber = deps.tracks.filter((track) => track.isGroup).length + 1
    const group: TimelineTrack = {
      id: groupId,
      name: deps.formatGroupName(groupNumber),
      kind: 'video',
      height: deps.layerRowHeight,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      order: Math.min(...selectedTracks.map((track) => track.order)),
      items: [],
      isGroup: true,
      isCollapsed: false,
    }
    setTracks([
      ...deps.tracks.map((track) =>
        selectedTrackIds.includes(track.id) ? { ...track, parentTrackId: groupId } : track,
      ),
      group,
    ])
  }

  const ungroupTracks = (groupId: string): void => {
    setTracks(
      deps.tracks
        .filter((track) => track.id !== groupId)
        .map((track) =>
          track.parentTrackId === groupId ? { ...track, parentTrackId: undefined } : track,
        ),
    )
  }

  return {
    selectLayer,
    prepareLayerContextMenu,
    prepareGroupContextMenu,
    createGroupFromSelection,
    ungroupTracks,
  }
}
