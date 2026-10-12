import { create } from 'zustand'

interface SpatialEffectEditorState {
  isEditing: boolean
  editingItemId: string | null
  editingEffectId: string | null
}

interface SpatialEffectEditorActions {
  startEditing: (itemId: string, effectId: string) => void
  stopEditing: () => void
}

export const useSpatialEffectEditorStore = create<
  SpatialEffectEditorState & SpatialEffectEditorActions
>()((set) => ({
  isEditing: false,
  editingItemId: null,
  editingEffectId: null,

  startEditing: (itemId, effectId) =>
    set({ isEditing: true, editingItemId: itemId, editingEffectId: effectId }),

  stopEditing: () => set({ isEditing: false, editingItemId: null, editingEffectId: null }),
}))
