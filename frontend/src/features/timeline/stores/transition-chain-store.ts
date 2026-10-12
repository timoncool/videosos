/**
 * Transition Index Store
 *
 * Derived state store that pre-computes transition indexes for O(1) lookups.
 * Subscribes to the items and transitions stores and recomputes only when
 * items/transitions change.
 *
 * Performance benefits:
 * - O(1) transition lookups via indexes
 * - Indexes computed once when data changes, not every frame
 * - Version tracking enables efficient React.memo comparisons
 */

import { create } from 'zustand'
import { useItemsStore } from './items-store'
import { useTransitionsStore } from './transitions-store'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { Transition, ClipTransitionIndex } from '@/types/transition'
import { buildTransitionIndexes, type TransitionIndexes } from '../utils/transition-indexes'

/**
 * Enriched visual item with track metadata for rendering.
 * Matches the structure expected by MainComposition.
 */
type EnrichedVisualItem = TimelineItem & {
  zIndex: number
  muted: boolean
  trackOrder: number
  trackVisible: boolean
}

interface TransitionChainState {
  // Pre-computed indexes for O(1) lookups
  transitionsByClipId: Map<string, ClipTransitionIndex>
  transitionsByTrackId: Map<string, Transition[]>
  transitionsById: Map<string, Transition>

  // Enriched items for rendering
  enrichedItemsById: Map<string, EnrichedVisualItem>

  // Version tracking for cache invalidation
  computeVersion: number
}

interface TransitionChainActions {
  /**
   * Recompute all indexes from timeline data.
   * Called automatically when timeline-store changes.
   */
  recompute: (items: TimelineItem[], transitions: Transition[], tracks: TimelineTrack[]) => void

  /**
   * Get enriched visual items for a track (for rendering).
   */
  getEnrichedItemsForTrack: (trackId: string) => EnrichedVisualItem[]

  /**
   * Get transition between two clips (if exists).
   */
  getTransitionBetween: (leftClipId: string, rightClipId: string) => Transition | undefined
}

type TransitionChainStore = TransitionChainState & TransitionChainActions

const useTransitionChainStore = create<TransitionChainStore>()((set, get) => ({
  // Initial state (empty)
  transitionsByClipId: new Map(),
  transitionsByTrackId: new Map(),
  transitionsById: new Map(),
  enrichedItemsById: new Map(),
  computeVersion: 0,

  recompute: (items, transitions, tracks) => {
    const state = get()

    // Build transition indexes
    const indexes: TransitionIndexes = buildTransitionIndexes(transitions)

    // Build enriched items map
    const enrichedItemsById = new Map<string, EnrichedVisualItem>()
    const maxOrder = Math.max(...tracks.map((t) => t.order ?? 0), 0)

    for (const track of tracks) {
      for (const item of items.filter((i) => i.trackId === track.id)) {
        if (item.type === 'video' || item.type === 'image') {
          enrichedItemsById.set(item.id, {
            ...item,
            zIndex: maxOrder - (track.order ?? 0),
            muted: track.muted ?? false,
            trackOrder: track.order ?? 0,
            trackVisible: track.visible !== false,
          } as EnrichedVisualItem)
        }
      }
    }

    set({
      transitionsByClipId: indexes.transitionsByClipId,
      transitionsByTrackId: indexes.transitionsByTrackId,
      transitionsById: indexes.transitionsById,
      enrichedItemsById,
      computeVersion: state.computeVersion + 1,
    })
  },

  getEnrichedItemsForTrack: (trackId) => {
    const { enrichedItemsById } = get()
    const items: EnrichedVisualItem[] = []
    for (const item of enrichedItemsById.values()) {
      if (item.trackId === trackId) {
        items.push(item)
      }
    }
    return items.sort((a, b) => a.from - b.from)
  },

  getTransitionBetween: (leftClipId, rightClipId) => {
    const { transitionsByClipId } = get()
    const leftIndex = transitionsByClipId.get(leftClipId)
    if (leftIndex?.outgoing && leftIndex.outgoing.rightClipId === rightClipId) {
      return leftIndex.outgoing
    }
    return undefined
  },
}))

/**
 * Initialize subscription to timeline-store.
 * This sets up automatic recomputation when timeline data changes.
 */
export function initTransitionChainSubscription(): () => void {
  // Get initial data and compute
  const itemsState = useItemsStore.getState()
  const transitions = useTransitionsStore.getState().transitions
  useTransitionChainStore.getState().recompute(itemsState.items, transitions, itemsState.tracks)

  // Track previous values for shallow comparison
  let prevItems = itemsState.items
  let prevTransitions = transitions
  let prevTracks = itemsState.tracks

  // Subscribe to the two domain stores that hold the recompute inputs
  const sync = () => {
    const nextItems = useItemsStore.getState().items
    const nextTracks = useItemsStore.getState().tracks
    const nextTransitions = useTransitionsStore.getState().transitions

    // Only recompute if items, transitions, or tracks changed
    if (
      nextItems === prevItems &&
      nextTransitions === prevTransitions &&
      nextTracks === prevTracks
    ) {
      return
    }

    prevItems = nextItems
    prevTransitions = nextTransitions
    prevTracks = nextTracks

    useTransitionChainStore.getState().recompute(nextItems, nextTransitions, nextTracks)
  }

  const unsubscribeItems = useItemsStore.subscribe(sync)
  const unsubscribeTransitions = useTransitionsStore.subscribe(sync)

  return () => {
    unsubscribeItems()
    unsubscribeTransitions()
  }
}
