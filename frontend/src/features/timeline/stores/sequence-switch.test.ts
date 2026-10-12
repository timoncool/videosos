// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineTrack as makeTrack,
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useCompositionsStore } from './compositions-store'
import { useSequencesStore } from './sequences-store'
import { useCompositionNavigationStore, getActiveTabId } from './composition-navigation-store'
import { getActiveCompositionId } from './composition-navigation-active'

function seedSequence(id: string, itemId: string): void {
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
  useSequencesStore.getState().addTopLevelSequence(id)
}

describe('switchToSequence (multi-timeline tabs)', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([makeVideoItem({ id: 'main-clip', trackId: 'track-v1' })])
    useSequencesStore.getState().reset()
  })

  // Leave clean state so sequence context never leaks into other files.
  afterEach(() => resetTimelineCompositionTestState())

  it('loads a sequence into the live stores and marks it the active tab', () => {
    seedSequence('seq-a', 'a-clip')

    useCompositionNavigationStore.getState().switchToSequence('seq-a')

    const nav = useCompositionNavigationStore.getState()
    expect(nav.activeCompositionId).toBe('seq-a')
    expect(getActiveCompositionId()).toBe('seq-a')
    expect(getActiveTabId(nav.breadcrumbs)).toBe('seq-a')
    // A sequence tab is its own root — no Main above it.
    expect(nav.breadcrumbs).toHaveLength(1)
    expect(nav.breadcrumbs[0]?.compositionId).toBe('seq-a')
    // Live domain store now shows the sequence's content, not Main's.
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['a-clip'])
  })

  it('returns to Main, restoring the main timeline content', () => {
    seedSequence('seq-a', 'a-clip')
    useCompositionNavigationStore.getState().switchToSequence('seq-a')

    useCompositionNavigationStore.getState().switchToSequence(null)

    const nav = useCompositionNavigationStore.getState()
    expect(nav.activeCompositionId).toBeNull()
    expect(getActiveTabId(nav.breadcrumbs)).toBeNull()
    expect(nav.breadcrumbs).toHaveLength(1)
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['main-clip'])
  })

  it('switches directly between two sequence tabs', () => {
    seedSequence('seq-a', 'a-clip')
    seedSequence('seq-b', 'b-clip')

    useCompositionNavigationStore.getState().switchToSequence('seq-a')
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['a-clip'])

    useCompositionNavigationStore.getState().switchToSequence('seq-b')

    const nav = useCompositionNavigationStore.getState()
    expect(nav.activeCompositionId).toBe('seq-b')
    expect(getActiveTabId(nav.breadcrumbs)).toBe('seq-b')
    expect(nav.breadcrumbs).toHaveLength(1)
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['b-clip'])
  })

  it('persists edits made in a sequence tab back to the registry on switch away', () => {
    seedSequence('seq-a', 'a-clip')
    useCompositionNavigationStore.getState().switchToSequence('seq-a')

    // Edit the sequence's live content.
    useItemsStore
      .getState()
      .setItems([
        ...useItemsStore.getState().items,
        makeVideoItem({ id: 'a-clip-2', trackId: 'seq-a-v1', from: 40 }),
      ])

    useCompositionNavigationStore.getState().switchToSequence(null)

    const stored = useCompositionsStore.getState().getComposition('seq-a')
    expect(stored?.items.map((i) => i.id)).toEqual(['a-clip', 'a-clip-2'])
  })
})
