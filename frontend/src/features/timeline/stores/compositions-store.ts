import { create } from 'zustand'
import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline'
import type { AudioEqSettings } from '@/types/audio'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { CompositionEditorKind } from '@/types/project'
import type { CompositionControlSchema } from '@/types/composition-controls'
import { normalizeSubComposition } from '../utils/sub-composition-normalizer'

/**
 * Sub-composition data — a self-contained mini-timeline stored independently.
 * Multiple CompositionItem instances can reference the same compositionId,
 * enabling reuse of pre-comp contents across the project.
 */
export interface SubComposition {
  id: string
  name: string
  /** Missing only in legacy/test inputs; the store normalizer writes sequence. */
  editorKind?: CompositionEditorKind
  items: TimelineItem[]
  tracks: TimelineTrack[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  width: number
  height: number
  durationInFrames: number
  backgroundColor?: string
  /** Authored parameters shown on every CompositionItem instance. */
  compositionControls?: CompositionControlSchema
  busAudioEq?: AudioEqSettings
  /** Per-sequence timeline markers (independent of Main's). */
  markers?: ProjectMarker[]
  /** Per-sequence in/out playback range. */
  inPoint?: number | null
  outPoint?: number | null
}

function buildCompositionsMediaDependencyIds(compositions: SubComposition[]): string[] {
  const mediaIds = new Set<string>()
  for (const composition of compositions) {
    for (const item of composition.items) {
      if (item.mediaId) {
        mediaIds.add(item.mediaId)
      }
    }
  }
  return [...mediaIds].sort()
}

function buildMediaDependencyKey(mediaDependencyIds: string[]): string {
  return mediaDependencyIds.join('|')
}

interface CompositionsState {
  compositions: SubComposition[]
  compositionById: Record<string, SubComposition>
  mediaDependencyIds: string[]
  mediaDependencyVersion: number
}

interface CompositionsActions {
  addComposition: (composition: SubComposition) => void
  updateComposition: (id: string, updates: Partial<Omit<SubComposition, 'id'>>) => void
  removeComposition: (id: string) => void
  getComposition: (id: string) => SubComposition | undefined
  setCompositions: (compositions: SubComposition[]) => void
}

export const useCompositionsStore = create<CompositionsState & CompositionsActions>()(
  (set, get) => ({
    compositions: [],
    compositionById: {},
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,

    addComposition: (composition) =>
      set((state) => ({
        compositions: [...state.compositions, normalizeSubComposition(composition)],
      })),

    updateComposition: (id, updates) =>
      set((state) => ({
        compositions: state.compositions.map((c) =>
          c.id === id ? normalizeSubComposition({ ...c, ...updates }) : c,
        ),
      })),

    removeComposition: (id) =>
      set((state) => ({
        compositions: state.compositions.filter((c) => c.id !== id),
      })),

    getComposition: (id) => get().compositionById[id],

    setCompositions: (compositions) =>
      set({
        compositions: compositions.map((composition) => normalizeSubComposition(composition)),
      }),
  }),
)

let prevCompositionsRef = useCompositionsStore.getState().compositions
let prevCompositionsMediaDependencyIds = useCompositionsStore.getState().mediaDependencyIds
let prevCompositionsMediaDependencyKey = buildMediaDependencyKey(prevCompositionsMediaDependencyIds)
useCompositionsStore.subscribe((state) => {
  if (state.compositions === prevCompositionsRef) {
    return
  }
  prevCompositionsRef = state.compositions
  const compositionById: Record<string, SubComposition> = {}
  for (const composition of state.compositions) {
    compositionById[composition.id] = composition
  }
  const nextMediaDependencyIds = buildCompositionsMediaDependencyIds(state.compositions)
  const nextMediaDependencyKey = buildMediaDependencyKey(nextMediaDependencyIds)
  const mediaDependencyIds =
    nextMediaDependencyKey === prevCompositionsMediaDependencyKey
      ? state.mediaDependencyIds
      : nextMediaDependencyIds
  const mediaDependencyVersion =
    nextMediaDependencyKey === prevCompositionsMediaDependencyKey
      ? state.mediaDependencyVersion
      : state.mediaDependencyVersion + 1
  prevCompositionsMediaDependencyIds = mediaDependencyIds
  prevCompositionsMediaDependencyKey = nextMediaDependencyKey
  useCompositionsStore.setState({
    compositionById,
    mediaDependencyIds: prevCompositionsMediaDependencyIds,
    mediaDependencyVersion,
  })
})
