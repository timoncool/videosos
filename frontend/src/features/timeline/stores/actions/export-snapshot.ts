/**
 * Read-only snapshots of any timeline "sequence" (Main or a standalone
 * sequence tab) for the export dialog's sequence picker. Sourcing is done from
 * the registry + held-aside Main so the user can export a sequence *without*
 * switching the editor to it. Active live edits are reflected via the same
 * getEffectiveCompositions / getRootTimelineSnapshot helpers the persistence
 * paths use.
 */

import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { AudioEqSettings } from '@/types/audio'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { DEFAULT_FPS } from '@/shared/timeline/defaults'
import { useMarkersStore } from '../markers-store'
import { useCompositionsStore } from '../compositions-store'
import { useSequencesStore } from '../sequences-store'
import { useCompositionNavigationStore, getActiveTabId } from '../composition-navigation-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '@/features/timeline/deps/projects'
import {
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  getRootTimelineSnapshot,
} from './shared'

export interface ExportableSequence {
  /** null = the Main timeline. */
  id: string | null
  name: string
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  width: number
  height: number
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  masterBusDb: number
  durationFrames: number
  inPoint: number | null
  outPoint: number | null
  markers: ProjectMarker[]
}

const MAIN_LABEL = 'Main Timeline'

function furthestItemEnd(items: TimelineItem[]): number {
  if (items.length === 0) return 0
  return Math.max(...items.map((item) => item.from + item.durationInFrames))
}

/** The active top-level tab (null = Main) — the picker's default selection. */
export function getActiveExportSequenceId(): string | null {
  return getActiveTabId(useCompositionNavigationStore.getState().breadcrumbs)
}

/** Main + classic sequence tabs + layer compositions for the export picker. */
export function listExportableSequences(): Array<{ id: string | null; name: string }> {
  const compositionsState = useCompositionsStore.getState()
  const compositionById = compositionsState.compositionById
  const topLevelSequenceIds = useSequencesStore.getState().topLevelSequenceIds
  const listedIds = new Set(topLevelSequenceIds)
  return [
    { id: null, name: MAIN_LABEL },
    ...topLevelSequenceIds.flatMap((id) => {
      const comp = compositionById[id]
      return comp ? [{ id, name: comp.name }] : []
    }),
    ...compositionsState.compositions.flatMap((composition) =>
      composition.editorKind === 'composite-2d' && !listedIds.has(composition.id)
        ? [{ id: composition.id, name: composition.name }]
        : [],
    ),
  ]
}

/**
 * Build an export snapshot for a sequence (null = Main) reflecting the current
 * editor state, without navigating to it.
 */
export function getExportableSequence(sequenceId: string | null): ExportableSequence {
  const current = getCurrentTimelineSnapshot()
  const nav = useCompositionNavigationStore.getState()
  const activeTabId = getActiveTabId(nav.breadcrumbs)
  const playback = usePlaybackStore.getState()
  const markersState = useMarkersStore.getState()
  const isActiveTab = sequenceId === activeTabId
  // The markers store holds the range of whatever timeline is *loaded* — the
  // deepest drill level, which is not the tab root once you drill into a comp.
  // Keying this on the tab id reported a drilled-into comp's range as Main's,
  // and read a stale registry range for the comp actually being edited (the one
  // the Motion IO lane writes to). Ancestors are safe to read from the registry:
  // `enterComposition` flushes the parent before loading a child.
  const holdsLiveRange = sequenceId === nav.activeCompositionId

  // Markers + in/out are per-sequence timeline data now, swapped like clips: the
  // live markers store holds the loaded timeline's; the rest live in mainHolder
  // (Main held aside) or the composition registry.
  const range = (
    held:
      | {
          markers?: ProjectMarker[]
          inPoint?: number | null
          outPoint?: number | null
        }
      | null
      | undefined,
  ) =>
    holdsLiveRange
      ? {
          markers: markersState.markers,
          inPoint: markersState.inPoint,
          outPoint: markersState.outPoint,
        }
      : {
          markers: held?.markers ?? [],
          inPoint: held?.inPoint ?? null,
          outPoint: held?.outPoint ?? null,
        }

  if (sequenceId === null) {
    const root = getRootTimelineSnapshot(current)
    const metadata = useProjectStore.getState().currentProject?.metadata
    // Main's audio bus / range are live when Main is active, else held aside.
    const busAudioEq = activeTabId === null ? playback.busAudioEq : nav.mainHolder?.busAudioEq
    return {
      id: null,
      name: MAIN_LABEL,
      tracks: root.tracks,
      items: root.items,
      transitions: root.transitions,
      keyframes: root.keyframes,
      fps: metadata?.fps ?? DEFAULT_FPS,
      width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
      height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
      backgroundColor: metadata?.backgroundColor,
      busAudioEq,
      masterBusDb: playback.masterBusDb,
      durationFrames: furthestItemEnd(root.items),
      ...range(nav.mainHolder),
    }
  }

  const comp = getEffectiveCompositions(current).find((c) => c.id === sequenceId)
  if (!comp) {
    // Sequence vanished (e.g. deleted mid-dialog) — fall back to Main.
    return getExportableSequence(null)
  }
  return {
    id: sequenceId,
    name: comp.name,
    tracks: comp.tracks,
    items: comp.items,
    transitions: comp.transitions ?? [],
    keyframes: comp.keyframes ?? [],
    fps: comp.fps,
    width: comp.width,
    height: comp.height,
    backgroundColor: comp.backgroundColor,
    // Live mixer edits live in the playback store for the active sequence; the
    // registry entry is only up to date once we've switched away from it.
    busAudioEq: isActiveTab ? playback.busAudioEq : comp.busAudioEq,
    masterBusDb: playback.masterBusDb,
    durationFrames: comp.durationInFrames || furthestItemEnd(comp.items),
    ...range(comp),
  }
}
