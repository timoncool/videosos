import { create } from 'zustand'

interface PowerWindowEditorState {
  isEditing: boolean
  editingItemId: string | null
  editingEffectId: string | null
}

interface PowerWindowEditorActions {
  startEditing: (itemId: string, effectId: string) => void
  stopEditing: () => void
}

export const usePowerWindowEditorStore = create<
  PowerWindowEditorState & PowerWindowEditorActions
>()((set) => ({
  isEditing: false,
  editingItemId: null,
  editingEffectId: null,

  startEditing: (itemId, effectId) =>
    set({
      isEditing: true,
      editingItemId: itemId,
      editingEffectId: effectId,
    }),

  stopEditing: () =>
    set({
      isEditing: false,
      editingItemId: null,
      editingEffectId: null,
    }),
}))
