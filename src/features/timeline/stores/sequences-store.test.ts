// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useSequencesStore, type SequenceViewState } from './sequences-store'

const view = (currentFrame: number): SequenceViewState => ({
  currentFrame,
  zoomLevel: 1,
  scrollPosition: 0,
  selectedItemIds: [],
})

describe('sequences-store', () => {
  beforeEach(() => {
    useSequencesStore.getState().reset()
  })

  it('dedupes ids when replacing the tab set', () => {
    useSequencesStore.getState().setTopLevelSequenceIds(['a', 'b', 'a', 'c', 'b'])
    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual(['a', 'b', 'c'])
  })

  it('addTopLevelSequence appends once and is a no-op for duplicates', () => {
    const { addTopLevelSequence } = useSequencesStore.getState()
    addTopLevelSequence('a')
    addTopLevelSequence('b')
    addTopLevelSequence('a')
    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual(['a', 'b'])
  })

  it('removeTopLevelSequence drops the id and its saved view', () => {
    const s = useSequencesStore.getState()
    s.setTopLevelSequenceIds(['a', 'b'])
    s.saveSequenceView('a', view(10))
    s.saveSequenceView('b', view(20))

    s.removeTopLevelSequence('a')

    const next = useSequencesStore.getState()
    expect(next.topLevelSequenceIds).toEqual(['b'])
    expect(next.getSequenceView('a')).toBeUndefined()
    expect(next.getSequenceView('b')).toEqual(view(20))
  })

  it('reorderTopLevelSequences moves a tab and ignores out-of-range indices', () => {
    const s = useSequencesStore.getState()
    s.setTopLevelSequenceIds(['a', 'b', 'c'])

    s.reorderTopLevelSequences(0, 2)
    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual(['b', 'c', 'a'])

    // Out-of-range and no-op moves leave the order untouched.
    s.reorderTopLevelSequences(5, 0)
    s.reorderTopLevelSequences(1, 1)
    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual(['b', 'c', 'a'])
  })

  it('pruneToValidSequenceIds drops tabs and views whose composition is gone', () => {
    const s = useSequencesStore.getState()
    s.setTopLevelSequenceIds(['a', 'b', 'c'])
    s.saveSequenceView('a', view(1))
    s.saveSequenceView('c', view(3))

    s.pruneToValidSequenceIds(['b', 'c'])

    const next = useSequencesStore.getState()
    expect(next.topLevelSequenceIds).toEqual(['b', 'c'])
    expect(next.getSequenceView('a')).toBeUndefined()
    expect(next.getSequenceView('c')).toEqual(view(3))
  })
})
