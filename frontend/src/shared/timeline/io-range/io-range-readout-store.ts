import { create } from 'zustand'

/** A floating readout shown at the cursor during an IO drag (viewport coords). */
export interface IoDragReadout {
  label: string
  x: number
  y: number
}

interface IoRangeReadoutState {
  readout: IoDragReadout | null
  setReadout: (readout: IoDragReadout | null) => void
}

/**
 * Cursor-following readout for IO (in/out) drag operations — the analogue of the
 * clip trim readout. Written by {@link beginIoPointerDrag} (when the drag's
 * `onMove` returns a label) and read by a single mounted {@link IoDragReadout}.
 */
export const useIoRangeReadoutStore = create<IoRangeReadoutState>((set) => ({
  readout: null,
  setReadout: (readout) => set({ readout }),
}))
