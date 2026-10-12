import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useSpatialEffectEditorStore } from './spatial-effect-editor-store'

describe('spatial effect editor store', () => {
  beforeEach(() => useSpatialEffectEditorStore.getState().stopEditing())

  it('tracks and clears the active item and effect', () => {
    useSpatialEffectEditorStore.getState().startEditing('clip-1', 'effect-1')
    expect(useSpatialEffectEditorStore.getState()).toMatchObject({
      isEditing: true,
      editingItemId: 'clip-1',
      editingEffectId: 'effect-1',
    })

    useSpatialEffectEditorStore.getState().stopEditing()
    expect(useSpatialEffectEditorStore.getState()).toMatchObject({
      isEditing: false,
      editingItemId: null,
      editingEffectId: null,
    })
  })
})
