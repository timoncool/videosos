import { create } from 'zustand'
import type { PreviewItemUpdate } from '../utils/item-edit-preview'

interface LinkedEditPreviewState {
  updatesById: Record<string, PreviewItemUpdate>
}

interface LinkedEditPreviewActions {
  setUpdates: (updates: PreviewItemUpdate[]) => void
  clear: () => void
}

const PREVIEW_UPDATE_KEYS = [
  'from',
  'durationInFrames',
  'sourceStart',
  'sourceEnd',
  'speed',
  'hidden',
] as const satisfies ReadonlyArray<keyof PreviewItemUpdate>

/**
 * Gestures call setUpdates on every pointer frame with freshly built objects.
 * Comparing values (not identity) lets unchanged frames skip the store write,
 * so subscribed clips only re-run their selectors when an update actually moved.
 */
function areUpdatesEqual(
  previous: Record<string, PreviewItemUpdate>,
  next: Record<string, PreviewItemUpdate>,
): boolean {
  const previousIds = Object.keys(previous)
  if (previousIds.length !== Object.keys(next).length) return false

  for (const id of previousIds) {
    const previousUpdate = previous[id]
    const nextUpdate = next[id]
    if (!previousUpdate || !nextUpdate) return false
    if (previousUpdate === nextUpdate) continue
    for (const key of PREVIEW_UPDATE_KEYS) {
      if (previousUpdate[key] !== nextUpdate[key]) return false
    }
  }

  return true
}

export const useLinkedEditPreviewStore = create<
  LinkedEditPreviewState & LinkedEditPreviewActions
>()((set, get) => ({
  updatesById: {},
  setUpdates: (updates) => {
    const updatesById = Object.fromEntries(updates.map((update) => [update.id, update]))
    if (areUpdatesEqual(get().updatesById, updatesById)) {
      return
    }
    set({ updatesById })
  },
  clear: () => {
    if (Object.keys(get().updatesById).length === 0) {
      return
    }
    set({ updatesById: {} })
  },
}))
