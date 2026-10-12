/**
 * Staging buffer for non-destructive transcript editing ("ignore"/strikethrough).
 *
 * Descript-style flow: striking words marks them as ignored (visible, struck,
 * restorable) WITHOUT touching the timeline. The user reviews, then commits —
 * at which point the ignored spans are funnelled through the proven
 * `removeTranscriptRangesFromItems` action as a single undoable edit.
 *
 * Ranges are stored in **source-native seconds keyed by mediaId**, which is
 * stable across timeline splits/trims (source time doesn't change), so staged
 * ignores survive other edits made before the commit. This buffer is in-memory
 * only — it is a short-lived review state, not persisted project data.
 */

import { create } from 'zustand'
import { useItemsStore } from './items-store'
import { removeTranscriptRangesFromItems } from './timeline-actions'
import {
  normalizeRanges,
  subtractRanges,
  totalRangeSeconds,
  unionRanges,
  type SourceRange,
} from '../utils/source-range-intervals'
import { isTranscriptableItem } from '../utils/transcript-edit-model'
import type { RemoveSilenceResult } from './actions/edit/range-removal-actions'

export type RangesByMediaId = Record<string, SourceRange[]>

interface TranscriptIgnoreState {
  /** mediaId → normalized ignored source-second ranges. */
  ranges: RangesByMediaId
  /** Add ranges to the ignore buffer (merged per media). */
  ignore: (rangesByMediaId: RangesByMediaId) => void
  /** Remove ranges from the ignore buffer (subtracted per media). */
  restore: (rangesByMediaId: RangesByMediaId) => void
  /** Drop the entire buffer without committing. */
  clear: () => void
  /** Commit all ignored ranges to the timeline as one undoable removal. */
  commit: () => RemoveSilenceResult | null
}

function mergeIn(base: RangesByMediaId, add: RangesByMediaId): RangesByMediaId {
  const next: RangesByMediaId = { ...base }
  for (const [mediaId, ranges] of Object.entries(add)) {
    next[mediaId] = unionRanges(next[mediaId] ?? [], ranges)
  }
  return next
}

function subtractFrom(base: RangesByMediaId, remove: RangesByMediaId): RangesByMediaId {
  const next: RangesByMediaId = { ...base }
  for (const [mediaId, ranges] of Object.entries(remove)) {
    const remaining = subtractRanges(next[mediaId] ?? [], ranges)
    if (remaining.length === 0) delete next[mediaId]
    else next[mediaId] = remaining
  }
  return next
}

export const useTranscriptIgnoreStore = create<TranscriptIgnoreState>((set, get) => ({
  ranges: {},

  ignore: (rangesByMediaId) => set((state) => ({ ranges: mergeIn(state.ranges, rangesByMediaId) })),

  restore: (rangesByMediaId) =>
    set((state) => ({ ranges: subtractFrom(state.ranges, rangesByMediaId) })),

  clear: () => set({ ranges: {} }),

  commit: () => {
    const { ranges } = get()
    const mediaIds = Object.keys(ranges)
    if (mediaIds.length === 0) return null

    // Resolve every current timeline item that references an ignored media, so a
    // staged ignore commits across all clips of that source (including any made
    // after the words were struck).
    const targetMediaIds = new Set(mediaIds)
    const itemIds = useItemsStore
      .getState()
      .items.filter((item) => isTranscriptableItem(item) && targetMediaIds.has(item.mediaId))
      .map((item) => item.id)

    if (itemIds.length === 0) {
      set({ ranges: {} })
      return null
    }

    const rangesByMediaId: RangesByMediaId = {}
    for (const mediaId of mediaIds) {
      rangesByMediaId[mediaId] = normalizeRanges(ranges[mediaId] ?? [])
    }

    const result = removeTranscriptRangesFromItems(itemIds, rangesByMediaId)
    set({ ranges: {} })
    return result
  },
}))

/** Count of distinct ignored spans across all media (for UI summaries). */
export function countIgnoredSpans(ranges: RangesByMediaId): number {
  return Object.values(ranges).reduce((sum, list) => sum + list.length, 0)
}

/** Total ignored duration in seconds across all media. */
export function totalIgnoredSeconds(ranges: RangesByMediaId): number {
  return Object.values(ranges).reduce((sum, list) => sum + totalRangeSeconds(list), 0)
}
