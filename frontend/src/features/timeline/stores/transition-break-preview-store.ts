import { create } from 'zustand'

interface TransitionBreakPreviewState {
  itemId: string | null
  handle: 'start' | 'end' | null
  delta: number
}

interface TransitionBreakPreviewActions {
  setPreview: (params: { itemId: string; handle: 'start' | 'end'; delta: number }) => void
  setDelta: (delta: number) => void
  clearPreview: () => void
}

export const useTransitionBreakPreviewStore = create<
  TransitionBreakPreviewState & TransitionBreakPreviewActions
>()((set) => ({
  itemId: null,
  handle: null,
  delta: 0,
  setPreview: (params) => set(params),
  setDelta: (delta) => set((state) => (state.delta === delta ? state : { delta })),
  clearPreview: () =>
    set((state) =>
      state.itemId === null && state.handle === null && state.delta === 0
        ? state
        : {
            itemId: null,
            handle: null,
            delta: 0,
          },
    ),
}))
