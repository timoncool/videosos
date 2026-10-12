import { create } from 'zustand'
import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline'
import type { AudioEqSettings } from '@/types/audio'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'

/**
 * Navigation breadcrumb entry for composition hierarchy.
 * Tracks which composition the user is currently editing.
 */
interface CompositionBreadcrumb {
  /** compositionId — null for root (main timeline) */
  compositionId: string | null
  /** Display label */
  label: string
  /** Wrapper item used to enter this composition, when applicable */
  entryItemId?: string
}

/**
 * Stashed timeline state — saved when entering a composition so it can be
 * restored when exiting back.
 */
interface StashedTimeline {
  compositionId: string | null
  items: TimelineItem[]
  tracks: TimelineTrack[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  /** Playhead frame at the time of stashing, so we can restore it on exit */
  currentFrame: number
  /** Timeline view state kept with the data snapshot for non-navigating persistence. */
  zoomLevel?: number
  scrollPosition?: number
  busAudioEq?: AudioEqSettings
  /** Per-timeline markers + in/out range, swapped alongside the clips. */
  markers: ProjectMarker[]
  inPoint: number | null
  outPoint: number | null
}

interface CompositionNavigationState {
  /**
   * Drill-in path *within the active tab*. `breadcrumbs[0]` is the tab root —
   * the Main timeline (`compositionId: null`) or a standalone sequence
   * (`compositionId: <seqId>`). Deeper entries are compound clips drilled into
   * from that root. So a sequence tab is a genuine root: Main never appears
   * above it.
   */
  breadcrumbs: CompositionBreadcrumb[]
  /** The compositionId currently being viewed (null = Main timeline). */
  activeCompositionId: string | null
  /** Stashed timeline states for drill-in within the active tab. */
  stashStack: StashedTimeline[]
  /**
   * Main timeline content, held aside while a sequence tab is active (Main is
   * not in `stashStack` then — a sequence is its own root). `null` when the Main
   * tab is active (Main is live, or stashed under a compound-clip drill-in).
   */
  mainHolder: StashedTimeline | null
}

interface CompositionNavigationActions {
  /** Enter a sub-composition for editing */
  enterComposition: (compositionId: string, label: string, entryItemId?: string) => void
  /** Exit the current sub-composition (go up one level) */
  exitComposition: () => void
  /** Navigate directly to a specific breadcrumb level */
  navigateTo: (index: number) => void
  /** Reset to root timeline */
  resetToRoot: () => void
  /**
   * Switch the active top-level tab (multi-timeline). `null` = the Main
   * timeline; a sequence id enters that sequence as the first level. Flushes
   * the outgoing tab (and any drill-in) back to the registry, then loads the
   * target, restoring its saved view. Undo history follows via the underlying
   * reset/enter transitions.
   */
  switchToSequence: (sequenceId: string | null) => void
}

import { useItemsStore } from './items-store'
import { useTransitionsStore } from './transitions-store'
import { useKeyframesStore } from './keyframes-store'
import { useCompositionsStore } from './compositions-store'
import { useMarkersStore } from './markers-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { useZoomStore } from './zoom-store'
import { useTimelineCommandStore, ROOT_HISTORY_CONTEXT } from './timeline-command-store'
import { useSequencesStore, type SequenceViewState } from './sequences-store'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { setActiveCompositionId } from './composition-navigation-active'

/**
 * The active top-level tab is the breadcrumb root. `null` = Main timeline; a
 * sequence tab is its own root, so its id sits at `breadcrumbs[0]`. Drilling
 * into a compound clip does not change the tab (only deeper breadcrumbs change).
 */
export function getActiveTabId(breadcrumbs: CompositionBreadcrumb[]): string | null {
  return breadcrumbs[0]?.compositionId ?? null
}

/** View-state map key for a tab (Main uses the shared root sentinel). */
function tabViewKey(tabId: string | null): string {
  return tabId ?? ROOT_HISTORY_CONTEXT
}

/**
 * Snapshot the active tab's *view* state (zoom/scroll/playhead/selection).
 * Markers + in/out are timeline data now, swapped via the stash, not here.
 */
function captureSequenceView(): SequenceViewState {
  return {
    currentFrame: usePlaybackStore.getState().currentFrame,
    zoomLevel: useZoomStore.getState().level,
    scrollPosition: useTimelineSettingsStore.getState().scrollPosition,
    selectedItemIds: useSelectionStore.getState().selectedItemIds,
  }
}

/**
 * Apply a saved per-tab view, or sensible fresh-tab defaults when none exists.
 * Playhead + selection for a fresh tab are left to load/reset, which already set
 * them; here we only restore the zoom/scroll those paths don't touch.
 */
function applySequenceView(view: SequenceViewState | undefined): void {
  if (view) {
    useZoomStore.getState().setZoomLevel(view.zoomLevel)
    useTimelineSettingsStore.getState().setScrollPosition(view.scrollPosition)
    usePlaybackStore.getState().setCurrentFrame(view.currentFrame)
    useSelectionStore.getState().selectItems(view.selectedItemIds)
  } else {
    // Fresh tab with no saved view: reset zoom + scroll to defaults so it never
    // inherits the previous tab's zoom level.
    useZoomStore.getState().setZoomLevel(1)
    useTimelineSettingsStore.getState().setScrollPosition(0)
  }
}

/** Save current timeline domain-store contents (incl. markers/in-out) into a stash entry. */
function captureCurrentTimeline(compositionId: string | null): StashedTimeline {
  const markersState = useMarkersStore.getState()
  return {
    compositionId,
    items: useItemsStore.getState().items,
    tracks: useItemsStore.getState().tracks,
    transitions: useTransitionsStore.getState().transitions,
    keyframes: useKeyframesStore.getState().keyframes,
    currentFrame: usePlaybackStore.getState().currentFrame,
    zoomLevel: useZoomStore.getState().level,
    scrollPosition: useTimelineSettingsStore.getState().scrollPosition,
    busAudioEq: usePlaybackStore.getState().busAudioEq,
    markers: markersState.markers,
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
  }
}

/** Restore a stashed timeline into the domain stores. */
function restoreTimeline(stash: StashedTimeline) {
  useItemsStore.getState().setItems(stash.items)
  useItemsStore.getState().setTracks(stash.tracks)
  useTransitionsStore.getState().setTransitions(stash.transitions)
  useKeyframesStore.getState().setKeyframes(stash.keyframes)
  useSelectionStore.getState().clearSelection()
  usePlaybackStore.getState().setCurrentFrame(stash.currentFrame)
  usePlaybackStore.getState().setBusAudioEq(stash.busAudioEq)
  useMarkersStore.getState().setMarkers(stash.markers)
  useMarkersStore.getState().setInOutPoints(stash.inPoint, stash.outPoint)
}

/** Save current timeline data back to the compositions store (for sub-comps only). */
function saveCurrentToComposition(compositionId: string) {
  const items = useItemsStore.getState().items
  const currentComposition = useCompositionsStore.getState().getComposition(compositionId)
  const contentEnd =
    items.length > 0 ? Math.max(...items.map((i) => i.from + i.durationInFrames)) : 0
  // A layer composition's canvas duration is authored (see setCompositionDuration)
  // and must survive an empty scene, short layers *and* layers that run past the
  // end — extending it to fit content here would undo any duration the user set in
  // the properties panel. Editorial compound clips stay content-derived.
  const durationInFrames =
    currentComposition?.editorKind === 'composite-2d'
      ? Math.max(1, currentComposition.durationInFrames)
      : contentEnd
  const markersState = useMarkersStore.getState()

  useCompositionsStore.getState().updateComposition(compositionId, {
    items,
    tracks: useItemsStore.getState().tracks,
    transitions: useTransitionsStore.getState().transitions,
    keyframes: useKeyframesStore.getState().keyframes,
    durationInFrames,
    busAudioEq: usePlaybackStore.getState().busAudioEq,
    markers: markersState.markers,
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
  })
}

/** Load a sub-composition's data into the domain stores. */
function loadComposition(compositionId: string): boolean {
  const subComp = useCompositionsStore.getState().getComposition(compositionId)
  if (!subComp) return false

  useItemsStore.getState().setItems(subComp.items)
  useItemsStore.getState().setTracks(subComp.tracks)
  useTransitionsStore.getState().setTransitions(subComp.transitions ?? [])
  useKeyframesStore.getState().setKeyframes(subComp.keyframes ?? [])
  useSelectionStore.getState().clearSelection()
  usePlaybackStore.getState().setBusAudioEq(subComp.busAudioEq)
  useMarkersStore.getState().setMarkers(subComp.markers ?? [])
  useMarkersStore.getState().setInOutPoints(subComp.inPoint ?? null, subComp.outPoint ?? null)
  return true
}

function findCompositionEntryItem(
  items: TimelineItem[],
  compositionId: string,
  entryItemId?: string,
): TimelineItem | null {
  if (entryItemId) {
    const exactMatch = items.find(
      (item) =>
        item.id === entryItemId &&
        item.compositionId === compositionId &&
        (item.type === 'composition' || item.type === 'audio'),
    )
    if (exactMatch) {
      return exactMatch
    }
  }

  const visualMatch = items.find(
    (item) => item.type === 'composition' && item.compositionId === compositionId,
  )
  if (visualMatch) {
    return visualMatch
  }

  return items.find((item) => item.type === 'audio' && item.compositionId === compositionId) ?? null
}

// Safety guard against corrupted circular data while still allowing deeply nested clips.
const MAX_DEPTH = 16

export const useCompositionNavigationStore = create<
  CompositionNavigationState & CompositionNavigationActions
>()((set, get) => ({
  breadcrumbs: [{ compositionId: null, label: 'Main Timeline' }],
  activeCompositionId: null,
  stashStack: [],
  mainHolder: null,

  enterComposition: (compositionId, label, entryItemId) => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause()

    const state = get()

    // Prevent infinite nesting
    if (state.breadcrumbs.length >= MAX_DEPTH) return

    // Prevent entering the same composition we're already in
    if (state.activeCompositionId === compositionId) return

    // Prevent entering a composition that's already in the breadcrumb stack (circular)
    if (state.breadcrumbs.some((b) => b.compositionId === compositionId)) return

    // If currently inside a sub-comp, save changes back before leaving
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId)
    }

    // Stash current timeline state
    const stash = captureCurrentTimeline(state.activeCompositionId)

    // Load the sub-composition data into domain stores
    if (!loadComposition(compositionId)) return

    // Map the global playhead to a local frame within the sub-composition.
    // Find a composition item on the current timeline that references this compositionId.
    const globalFrame = usePlaybackStore.getState().currentFrame
    const compItem = findCompositionEntryItem(stash.items, compositionId, entryItemId)
    let localFrame = 0
    if (compItem) {
      const relativeFrame = globalFrame - compItem.from
      if (relativeFrame >= 0 && relativeFrame < compItem.durationInFrames) {
        localFrame = relativeFrame
      }
    }
    usePlaybackStore.getState().setCurrentFrame(localFrame)

    setActiveCompositionId(compositionId)
    useTimelineCommandStore.getState().setActiveContext(compositionId)
    set({
      breadcrumbs: [
        ...state.breadcrumbs,
        { compositionId, label, ...(compItem?.id && { entryItemId: compItem.id }) },
      ],
      activeCompositionId: compositionId,
      stashStack: [...state.stashStack, stash],
    })
  },

  exitComposition: () => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause()

    const state = get()
    if (state.breadcrumbs.length <= 1) return
    if (state.stashStack.length === 0) return

    // Save current sub-comp changes back to compositions store
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId)
    }

    // Pop the stash and restore
    const stash = state.stashStack[state.stashStack.length - 1]!
    restoreTimeline(stash)

    const newBreadcrumbs = state.breadcrumbs.slice(0, -1)
    const lastEntry = newBreadcrumbs[newBreadcrumbs.length - 1]!

    setActiveCompositionId(lastEntry.compositionId)
    useTimelineCommandStore.getState().setActiveContext(lastEntry.compositionId)
    set({
      breadcrumbs: newBreadcrumbs,
      activeCompositionId: lastEntry.compositionId,
      stashStack: state.stashStack.slice(0, -1),
    })
  },

  navigateTo: (index) => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause()

    const state = get()
    if (index < 0 || index >= state.breadcrumbs.length) return

    // Already at this level
    if (index === state.breadcrumbs.length - 1) return

    // Save current sub-comp changes
    if (state.activeCompositionId !== null) {
      saveCurrentToComposition(state.activeCompositionId)
    }

    // Pop stash entries down to the target level
    const levelsToExit = state.breadcrumbs.length - 1 - index
    const targetStash = state.stashStack[state.stashStack.length - levelsToExit]

    if (targetStash) {
      restoreTimeline(targetStash)
    }

    const newBreadcrumbs = state.breadcrumbs.slice(0, index + 1)
    const lastEntry = newBreadcrumbs[newBreadcrumbs.length - 1]!

    setActiveCompositionId(lastEntry.compositionId)
    useTimelineCommandStore.getState().setActiveContext(lastEntry.compositionId)
    set({
      breadcrumbs: newBreadcrumbs,
      activeCompositionId: lastEntry.compositionId,
      stashStack: state.stashStack.slice(0, state.stashStack.length - levelsToExit),
    })
  },

  resetToRoot: () => {
    // Pause playback before switching timeline context
    usePlaybackStore.getState().pause()

    // Unwind any drill-in within the current tab, restoring each parent level.
    while (get().breadcrumbs.length > 1) {
      get().exitComposition()
    }

    // If on a sequence tab, flush it to the registry and bring Main back live.
    const state = get()
    if (state.mainHolder) {
      if (state.activeCompositionId !== null) {
        saveCurrentToComposition(state.activeCompositionId)
      }
      restoreTimeline(state.mainHolder)
    }

    setActiveCompositionId(null)
    useTimelineCommandStore.getState().setActiveContext(null)
    set({
      breadcrumbs: [{ compositionId: null, label: 'Main Timeline' }],
      activeCompositionId: null,
      stashStack: [],
      mainHolder: null,
    })
  },

  switchToSequence: (sequenceId) => {
    usePlaybackStore.getState().pause()

    const state = get()
    const currentTabId = getActiveTabId(state.breadcrumbs)

    if (currentTabId === sequenceId) {
      // A refresh/HMR can preserve the selected sequence id after its isolated
      // runtime holder has been lost. In that state the UI says Motion is open
      // while the live domain stores still contain Main. Rebuild the sequence
      // root from the registry instead of accepting the id as sufficient proof
      // that the correct timeline is loaded.
      if (sequenceId !== null && state.mainHolder === null) {
        const comp = useCompositionsStore.getState().getComposition(sequenceId)
        if (!comp) return
        const mainStash = captureCurrentTimeline(null)
        loadComposition(sequenceId)
        usePlaybackStore.getState().setCurrentFrame(0)
        setActiveCompositionId(sequenceId)
        useTimelineCommandStore.getState().setActiveContext(sequenceId)
        set({
          breadcrumbs: [{ compositionId: sequenceId, label: comp.name }],
          activeCompositionId: sequenceId,
          stashStack: [],
          mainHolder: mainStash,
        })
        applySequenceView(useSequencesStore.getState().getSequenceView(tabViewKey(sequenceId)))
        return
      }
      // Already on this tab; collapse any drill-in back to its root.
      if (state.breadcrumbs.length > 1) {
        get().navigateTo(0)
      }
      return
    }

    // Save the outgoing tab's view before tearing down its context.
    useSequencesStore.getState().saveSequenceView(tabViewKey(currentTabId), captureSequenceView())

    // Return to Main: flushes drill-in + the outgoing sequence back to the
    // registry, restores Main to the live stores, and swaps undo history to the
    // Main context.
    get().resetToRoot()

    if (sequenceId !== null) {
      const comp = useCompositionsStore.getState().getComposition(sequenceId)
      if (!comp) {
        // Target was deleted out from under us — stay on Main.
        applySequenceView(useSequencesStore.getState().getSequenceView(tabViewKey(null)))
        return
      }
      // Make the sequence a genuine root: hold Main aside, load the sequence
      // into the live stores as breadcrumbs[0]. Main never sits above it.
      const mainStash = captureCurrentTimeline(null)
      loadComposition(sequenceId)
      usePlaybackStore.getState().setCurrentFrame(0)
      setActiveCompositionId(sequenceId)
      useTimelineCommandStore.getState().setActiveContext(sequenceId)
      set({
        breadcrumbs: [{ compositionId: sequenceId, label: comp.name }],
        activeCompositionId: sequenceId,
        stashStack: [],
        mainHolder: mainStash,
      })
    }

    // Restore the target tab's saved view (or fresh-tab defaults).
    applySequenceView(useSequencesStore.getState().getSequenceView(tabViewKey(sequenceId)))
  },
}))
