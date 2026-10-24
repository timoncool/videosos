import { create } from 'zustand'

/** A clip's part to make again: the timeline asks for it, the generation panel cuts it and takes it. */
export interface SegmentRequest {
  mediaId: string
  label: string
  /** The part of the source file the clip shows, in seconds of that file. */
  start: number
  end: number
  /** Where the clip starts on the timeline, in seconds. */
  at: number
}

interface SegmentRequestState {
  request: SegmentRequest | null
  ask: (request: SegmentRequest) => void
  clear: () => void
}

export const useSegmentRequestStore = create<SegmentRequestState>((set) => ({
  request: null,
  ask: (request) => set({ request }),
  clear: () => set({ request: null }),
}))
