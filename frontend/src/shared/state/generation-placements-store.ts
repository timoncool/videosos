import { create } from 'zustand'

/**
 * Generations of the open project that will land on its timeline, while they run: the generation panel keeps
 * the list, the timeline draws each as a placeholder where its result will go.
 */
export interface GenerationPlacement {
  id: string
  /** Where it lands, in seconds; null when it lands at the playhead on arrival. */
  at: number | null
  /** How long the result is asked to be; null when the model's form does not say. */
  seconds: number | null
  lane: 'picture' | 'sound'
  model: string
  status: 'queued' | 'sending' | 'running'
  progress: number | null
}

interface GenerationPlacementsState {
  placements: GenerationPlacement[]
  setPlacements: (placements: GenerationPlacement[]) => void
}

export const useGenerationPlacementsStore = create<GenerationPlacementsState>((set) => ({
  placements: [],
  setPlacements: (placements) => set({ placements }),
}))
