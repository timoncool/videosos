// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { CompositionItem } from '@/types/timeline'
import {
  makeTimelineTrack as makeTrack,
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useMarkersStore } from './markers-store'
import { useCompositionsStore } from './compositions-store'
import { useSequencesStore } from './sequences-store'
import { useCompositionNavigationStore, getActiveTabId } from './composition-navigation-store'
import { deleteCompoundClips, openComposition } from './actions/composition-actions'

function compItem(id: string, compositionId: string, from = 0): CompositionItem {
  return {
    id,
    type: 'composition',
    trackId: 'track-v1',
    from,
    durationInFrames: 40,
    label: compositionId,
    compositionId,
    compositionWidth: 1920,
    compositionHeight: 1080,
    transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
  }
}

function seedComposition(id: string, itemId: string): void {
  useCompositionsStore.getState().addComposition({
    id,
    name: id,
    tracks: [makeTrack({ id: `${id}-v1`, name: 'V1', kind: 'video', order: 0 })],
    items: [makeVideoItem({ id: itemId, trackId: `${id}-v1` })],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 40,
  })
}

describe('sequence as a true navigation root', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useSequencesStore.getState().reset()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('drills into a compound clip inside a sequence without Main in the trail', () => {
    seedComposition('inner', 'inner-clip')
    // seq-a contains a wrapper referencing the inner composition.
    useCompositionsStore.getState().addComposition({
      id: 'seq-a',
      name: 'Sequence 1',
      tracks: [makeTrack({ id: 'seq-a-v1', name: 'V1', kind: 'video', order: 0 })],
      items: [compItem('seq-a-wrapper', 'inner')],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 40,
    })
    useSequencesStore.getState().addTopLevelSequence('seq-a')

    const nav = useCompositionNavigationStore.getState()
    nav.switchToSequence('seq-a')
    // Sequence is its own root — no Main above it.
    expect(useCompositionNavigationStore.getState().breadcrumbs).toHaveLength(1)
    expect(useCompositionNavigationStore.getState().mainHolder).not.toBeNull()

    nav.enterComposition('inner', 'inner')
    const drilled = useCompositionNavigationStore.getState()
    // Trail is [Sequence 1 > inner] — the tab, not Main, is the root.
    expect(drilled.breadcrumbs.map((b) => b.compositionId)).toEqual(['seq-a', 'inner'])
    expect(getActiveTabId(drilled.breadcrumbs)).toBe('seq-a')
    expect(drilled.activeCompositionId).toBe('inner')
    expect(drilled.mainHolder).not.toBeNull()
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['inner-clip'])

    nav.exitComposition()
    const back = useCompositionNavigationStore.getState()
    expect(back.breadcrumbs.map((b) => b.compositionId)).toEqual(['seq-a'])
    expect(back.activeCompositionId).toBe('seq-a')
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['seq-a-wrapper'])
  })

  it('openComposition switches to the tab for a sequence, but drills into a plain compound clip', () => {
    seedComposition('seq-a', 'a-clip')
    useSequencesStore.getState().addTopLevelSequence('seq-a')
    seedComposition('plain-cc', 'cc-clip') // NOT a top-level tab

    // A top-level sequence opens as its own root tab (no Main above it).
    openComposition('seq-a', 'Sequence 1')
    let nav = useCompositionNavigationStore.getState()
    expect(nav.breadcrumbs.map((b) => b.compositionId)).toEqual(['seq-a'])
    expect(getActiveTabId(nav.breadcrumbs)).toBe('seq-a')

    // Back to Main, then a plain compound clip drills in from Main.
    useCompositionNavigationStore.getState().switchToSequence(null)
    openComposition('plain-cc', 'Compound Clip')
    nav = useCompositionNavigationStore.getState()
    expect(nav.breadcrumbs.map((b) => b.compositionId)).toEqual([null, 'plain-cc'])
    expect(getActiveTabId(nav.breadcrumbs)).toBeNull()
  })

  it('keeps markers + in/out per-sequence, never bleeding across tabs', () => {
    seedComposition('seq-a', 'a-clip')
    useSequencesStore.getState().addTopLevelSequence('seq-a')
    // Main has a marker and an in/out range.
    useMarkersStore.getState().setMarkers([{ id: 'm-main', frame: 30, color: '#ffffff' }])
    useMarkersStore.getState().setInOutPoints(10, 50)

    const nav = useCompositionNavigationStore.getState()
    nav.switchToSequence('seq-a')
    // The sequence starts clean — Main's markers/range don't show through.
    expect(useMarkersStore.getState().markers).toEqual([])
    expect(useMarkersStore.getState().inPoint).toBeNull()

    // Annotate the sequence.
    useMarkersStore.getState().setMarkers([{ id: 'm-seq', frame: 5, color: '#000000' }])
    useMarkersStore.getState().setInOutPoints(2, 8)

    nav.switchToSequence(null)
    // Back on Main: Main's own markers/range are restored, not the sequence's.
    expect(useMarkersStore.getState().markers.map((m) => m.id)).toEqual(['m-main'])
    expect(useMarkersStore.getState().inPoint).toBe(10)
    expect(useMarkersStore.getState().outPoint).toBe(50)

    // The sequence's markers persisted into its registry entry.
    const stored = useCompositionsStore.getState().getComposition('seq-a')
    expect(stored?.markers?.map((m) => m.id)).toEqual(['m-seq'])
    expect(stored?.inPoint).toBe(2)
    expect(stored?.outPoint).toBe(8)
  })

  it('deleting a compound clip referenced on Main sanitizes Main while on a sequence tab', () => {
    // Main references compound clip 'cc'; a separate sequence tab is open.
    seedComposition('cc', 'cc-clip')
    seedComposition('seq-a', 'a-clip')
    useSequencesStore.getState().addTopLevelSequence('seq-a')
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'main-clip', trackId: 'track-v1' }),
        compItem('main-cc', 'cc', 60),
      ])

    const nav = useCompositionNavigationStore.getState()
    nav.switchToSequence('seq-a')
    // Main is now held aside; its 'cc' wrapper must still be reachable/sanitizable.
    expect(useCompositionNavigationStore.getState().mainHolder?.items.map((i) => i.id)).toEqual([
      'main-clip',
      'main-cc',
    ])

    deleteCompoundClips(['cc'])

    // Back on Main, the orphaned wrapper is gone (not left dangling).
    nav.switchToSequence(null)
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['main-clip'])
    expect(useCompositionsStore.getState().compositionById['cc']).toBeUndefined()
  })
})
