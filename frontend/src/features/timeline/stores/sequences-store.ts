import { create } from 'zustand'

/**
 * Multi-timeline (sequence) state.
 *
 * A "sequence" is the unified primitive behind both compound clips and
 * standalone timelines: it is a {@link import('./compositions-store').SubComposition}.
 * The only thing that makes a composition a *standalone timeline tab* rather
 * than an embed-only compound clip is membership in {@link topLevelSequenceIds}.
 *
 * The Main timeline is implicit — it is always the first tab and is NOT listed
 * here (its data lives in the flat `project.timeline.{items,tracks,...}` fields
 * and the global domain stores, not in the compositions registry).
 *
 * Phase 1 owns only the data model. Navigation between tabs (the sibling-switch
 * that swaps the active sequence into the domain stores) and the tab-bar UI are
 * later phases; they consume this store.
 */

/**
 * A per-sequence snapshot of view/playback state, so switching tabs can restore
 * where the user left off. Runtime-only in Phase 1 (not persisted): reopening a
 * project starts each non-active sequence at frame 0 until later phases persist
 * these. Main's view is not stored here — it round-trips via the flat timeline
 * fields.
 */
export interface SequenceViewState {
  currentFrame: number
  zoomLevel: number
  scrollPosition: number
  selectedItemIds: string[]
}

interface SequencesState {
  /** Ordered sub-composition ids promoted to top-level tabs (tab order). */
  topLevelSequenceIds: string[]
  /** Per-sequence view snapshots, keyed by sequence (composition) id. */
  sequenceViewById: Record<string, SequenceViewState>
}

interface SequencesActions {
  /** Replace the whole tab set (used on project load). Dedupes, preserves order. */
  setTopLevelSequenceIds: (ids: string[]) => void
  /** Promote a composition to a top-level tab. No-op if already present. */
  addTopLevelSequence: (id: string) => void
  /** Demote a composition from the tab set and drop its saved view. */
  removeTopLevelSequence: (id: string) => void
  /** Move a tab from one index to another. Out-of-range indices are ignored. */
  reorderTopLevelSequences: (fromIndex: number, toIndex: number) => void
  isTopLevelSequence: (id: string) => boolean
  /**
   * Drop any tab ids (and their views) not present in `validIds`. Called when
   * compositions are deleted so tabs never dangle.
   */
  pruneToValidSequenceIds: (validIds: Iterable<string>) => void

  saveSequenceView: (id: string, view: SequenceViewState) => void
  getSequenceView: (id: string) => SequenceViewState | undefined
  removeSequenceView: (id: string) => void

  /** Clear all multi-sequence state (used on project close / load). */
  reset: () => void
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)]
}

export const useSequencesStore = create<SequencesState & SequencesActions>()((set, get) => ({
  topLevelSequenceIds: [],
  sequenceViewById: {},

  setTopLevelSequenceIds: (ids) => set({ topLevelSequenceIds: dedupe(ids) }),

  addTopLevelSequence: (id) =>
    set((state) =>
      state.topLevelSequenceIds.includes(id)
        ? state
        : { topLevelSequenceIds: [...state.topLevelSequenceIds, id] },
    ),

  removeTopLevelSequence: (id) =>
    set((state) => {
      if (!state.topLevelSequenceIds.includes(id)) return state
      const { [id]: _removed, ...restViews } = state.sequenceViewById
      return {
        topLevelSequenceIds: state.topLevelSequenceIds.filter((existing) => existing !== id),
        sequenceViewById: restViews,
      }
    }),

  reorderTopLevelSequences: (fromIndex, toIndex) =>
    set((state) => {
      const ids = state.topLevelSequenceIds
      if (
        fromIndex < 0 ||
        fromIndex >= ids.length ||
        toIndex < 0 ||
        toIndex >= ids.length ||
        fromIndex === toIndex
      ) {
        return state
      }
      const next = [...ids]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved!)
      return { topLevelSequenceIds: next }
    }),

  isTopLevelSequence: (id) => get().topLevelSequenceIds.includes(id),

  pruneToValidSequenceIds: (validIds) =>
    set((state) => {
      const valid = new Set(validIds)
      const nextIds = state.topLevelSequenceIds.filter((id) => valid.has(id))
      if (nextIds.length === state.topLevelSequenceIds.length) {
        // Nothing pruned from tabs; still prune stale views for symmetry.
        const nextViews = pruneViews(state.sequenceViewById, valid)
        return nextViews === state.sequenceViewById ? state : { sequenceViewById: nextViews }
      }
      return {
        topLevelSequenceIds: nextIds,
        sequenceViewById: pruneViews(state.sequenceViewById, valid),
      }
    }),

  saveSequenceView: (id, view) =>
    set((state) => ({ sequenceViewById: { ...state.sequenceViewById, [id]: view } })),

  getSequenceView: (id) => get().sequenceViewById[id],

  removeSequenceView: (id) =>
    set((state) => {
      if (!(id in state.sequenceViewById)) return state
      const { [id]: _removed, ...rest } = state.sequenceViewById
      return { sequenceViewById: rest }
    }),

  reset: () => set({ topLevelSequenceIds: [], sequenceViewById: {} }),
}))

function pruneViews(
  views: Record<string, SequenceViewState>,
  valid: Set<string>,
): Record<string, SequenceViewState> {
  const entries = Object.entries(views).filter(([id]) => valid.has(id))
  if (entries.length === Object.keys(views).length) return views
  return Object.fromEntries(entries)
}
