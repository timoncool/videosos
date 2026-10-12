// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TextItem } from '@/types/timeline'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useCompositionsStore } from '../compositions-store'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  addCompositionControl,
  removeCompositionControl,
  renameCompositionControl,
} from './composition-control-actions'

const textItem: TextItem = {
  id: 'title',
  trackId: 'track',
  type: 'text',
  label: 'Headline',
  text: 'Original',
  color: '#ffffff',
  from: 0,
  durationInFrames: 30,
}

describe('composition control actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ isDirty: false })
    useCompositionsStore.getState().setCompositions([
      {
        id: 'card',
        name: 'Card',
        editorKind: 'composite-2d',
        items: [textItem],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
      },
    ])
    useCompositionNavigationStore.setState({ activeCompositionId: 'card' })
    useItemsStore.getState().setItems([textItem])
  })

  it('adds a versioned control as one undoable edit', () => {
    const id = addCompositionControl('card', {
      name: 'Headline',
      targetItemId: 'title',
      property: 'text.text',
      kind: 'text',
      defaultValue: 'Original',
    })

    expect(id).toEqual(expect.any(String))
    expect(useCompositionsStore.getState().compositionById.card?.compositionControls).toEqual({
      version: 1,
      controls: [expect.objectContaining({ id, name: 'Headline', targetItemId: 'title' })],
    })
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)

    useTimelineCommandStore.getState().undo()
    expect(
      useCompositionsStore.getState().compositionById.card?.compositionControls,
    ).toBeUndefined()
  })

  it('renames and removes exposed controls while rejecting duplicates', () => {
    const id = addCompositionControl('card', {
      name: 'Headline',
      targetItemId: 'title',
      property: 'text.text',
      kind: 'text',
      defaultValue: 'Original',
    })!
    expect(
      addCompositionControl('card', {
        name: 'Duplicate',
        targetItemId: 'title',
        property: 'text.text',
        kind: 'text',
        defaultValue: 'Original',
      }),
    ).toBeNull()

    expect(renameCompositionControl('card', id, 'Title copy')).toBe(true)
    expect(
      useCompositionsStore.getState().compositionById.card?.compositionControls?.controls[0]?.name,
    ).toBe('Title copy')
    expect(removeCompositionControl('card', id)).toBe(true)
    expect(
      useCompositionsStore.getState().compositionById.card?.compositionControls,
    ).toBeUndefined()
  })
})
