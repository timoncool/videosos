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
import { useCompositionNavigationStore } from './composition-navigation-store'
import {
  getActiveExportSequenceId,
  getExportableSequence,
  listExportableSequences,
} from './actions/export-snapshot'

function seedSequence(id: string, itemId: string, width = 1280, height = 720): void {
  useCompositionsStore.getState().addComposition({
    id,
    name: id,
    tracks: [makeTrack({ id: `${id}-v1`, name: 'V1', kind: 'video', order: 0 })],
    items: [makeVideoItem({ id: itemId, trackId: `${id}-v1`, from: 0, durationInFrames: 50 })],
    transitions: [],
    keyframes: [],
    fps: 24,
    width,
    height,
    durationInFrames: 50,
  })
  useSequencesStore.getState().addTopLevelSequence(id)
}

describe('export-snapshot sourcing', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'main-clip', trackId: 'track-v1', from: 0, durationInFrames: 90 }),
      ])
    useSequencesStore.getState().reset()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('lists Main plus every top-level sequence', () => {
    seedSequence('seq-a', 'a-clip')
    seedSequence('seq-b', 'b-clip')
    expect(listExportableSequences()).toEqual([
      { id: null, name: 'Main Timeline' },
      { id: 'seq-a', name: 'seq-a' },
      { id: 'seq-b', name: 'seq-b' },
    ])
  })

  it('lists composite-2d compositions without promoting them to classic tabs', () => {
    useCompositionsStore.getState().addComposition({
      id: 'motion-title',
      name: 'Motion title',
      editorKind: 'composite-2d',
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1080,
      height: 1080,
      durationInFrames: 150,
    })

    expect(listExportableSequences()).toContainEqual({
      id: 'motion-title',
      name: 'Motion title',
    })
    expect(useSequencesStore.getState().topLevelSequenceIds).not.toContain('motion-title')
  })

  it('reads a non-active sequence from the registry without switching to it', () => {
    seedSequence('seq-a', 'a-clip', 1280, 720)
    // We stay on Main; exporting seq-a must still see its own content/canvas.
    expect(getActiveExportSequenceId()).toBeNull()

    const seq = getExportableSequence('seq-a')
    expect(seq.id).toBe('seq-a')
    expect(seq.items.map((i) => i.id)).toEqual(['a-clip'])
    expect(seq.width).toBe(1280)
    expect(seq.height).toBe(720)
    expect(seq.fps).toBe(24)
    expect(seq.durationFrames).toBe(50)

    // The editor is untouched — still on Main, live stores unchanged.
    expect(getActiveExportSequenceId()).toBeNull()
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['main-clip'])
  })

  it('sources Main from the live root even while a sequence tab is active', () => {
    seedSequence('seq-a', 'a-clip')
    useCompositionNavigationStore.getState().switchToSequence('seq-a')
    expect(getActiveExportSequenceId()).toBe('seq-a')

    // Main is held aside; exporting it must still yield the Main content.
    const main = getExportableSequence(null)
    expect(main.id).toBeNull()
    expect(main.items.map((i) => i.id)).toEqual(['main-clip'])
    expect(main.durationFrames).toBe(90)

    // And the active sequence exports its own content.
    const seq = getExportableSequence('seq-a')
    expect(seq.items.map((i) => i.id)).toEqual(['a-clip'])
  })
})
