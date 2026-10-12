import { create } from 'zustand'
import type { VisualEffect } from '@/types/effects'

export interface GradeClipboardEntry {
  effect: VisualEffect
  enabled: boolean
}

interface GradeClipboardState {
  /** Color-grade effects copied from a clip, or null when nothing was copied. */
  grade: GradeClipboardEntry[] | null
}

interface GradeClipboardActions {
  setGrade: (grade: GradeClipboardEntry[]) => void
}

/**
 * Session-scoped clipboard for copying a clip's color grade (its
 * color-category effects) onto other clips. Separate from the item
 * clipboard so copying clips and copying grades don't clobber each other.
 */
export const useGradeClipboardStore = create<GradeClipboardState & GradeClipboardActions>(
  (set) => ({
    grade: null,
    setGrade: (grade) => set({ grade }),
  }),
)
