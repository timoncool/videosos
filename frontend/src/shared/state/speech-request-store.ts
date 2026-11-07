import { create } from 'zustand'

/** A text clip to voice: the timeline asks for it, the generation panel opens "Speech" with its text. */
export interface SpeechRequest {
  text: string
  /** Where the clip starts on the timeline, in seconds. */
  at: number
}

interface SpeechRequestState {
  request: SpeechRequest | null
  ask: (request: SpeechRequest) => void
  clear: () => void
}

export const useSpeechRequestStore = create<SpeechRequestState>((set) => ({
  request: null,
  ask: (request) => set({ request }),
  clear: () => set({ request: null }),
}))
