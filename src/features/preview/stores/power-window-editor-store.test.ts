import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { usePowerWindowEditorStore } from './power-window-editor-store'

describe('power window editor store', () => {
  beforeEach(() => {
    usePowerWindowEditorStore.getState().stopEditing()
  })

  it('tracks one exclusive item and effect target', () => {
    usePowerWindowEditorStore.getState().startEditing('clip-1', 'effect-1')

    expect(usePowerWindowEditorStore.getState()).toMatchObject({
      isEditing: true,
      editingItemId: 'clip-1',
      editingEffectId: 'effect-1',
    })

    usePowerWindowEditorStore.getState().startEditing('clip-2', 'effect-2')
    expect(usePowerWindowEditorStore.getState()).toMatchObject({
      isEditing: true,
      editingItemId: 'clip-2',
      editingEffectId: 'effect-2',
    })
  })
})
