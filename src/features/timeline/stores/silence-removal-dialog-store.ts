import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_SILENCE_REMOVAL_SETTINGS,
  normalizeSilenceRemovalSettings,
  type SilenceRangesByMediaId,
  type SilenceRemovalSettings,
  type SilencePreviewSummary,
} from '../utils/silence-removal-preview'

interface SilenceRemovalDialogState {
  isOpen: boolean
  itemIds: string[]
  settings: SilenceRemovalSettings
  rangesByMediaId: SilenceRangesByMediaId
  summary: SilencePreviewSummary
  analyzedMediaCount: number
  failedMediaCount: number
}

interface SilenceRemovalDialogActions {
  open: (request: {
    itemIds: string[]
    settings?: SilenceRemovalSettings
    rangesByMediaId?: SilenceRangesByMediaId
    summary?: SilencePreviewSummary
  }) => void
  updatePreview: (request: {
    settings: SilenceRemovalSettings
    rangesByMediaId: SilenceRangesByMediaId
    summary: SilencePreviewSummary
    analyzedMediaCount: number
    failedMediaCount: number
  }) => void
  close: () => void
}

type SilenceRemovalDialogStore = SilenceRemovalDialogState & SilenceRemovalDialogActions

export const useSilenceRemovalDialogStore = create<SilenceRemovalDialogStore>()(
  persist(
    (set, get) => ({
      isOpen: false,
      itemIds: [],
      settings: DEFAULT_SILENCE_REMOVAL_SETTINGS,
      rangesByMediaId: {},
      summary: { rangeCount: 0, totalSeconds: 0 },
      analyzedMediaCount: 0,
      failedMediaCount: 0,

      open: (request) =>
        set({
          isOpen: true,
          itemIds: request.itemIds,
          settings: normalizeSilenceRemovalSettings(request.settings ?? get().settings),
          rangesByMediaId: request.rangesByMediaId ?? {},
          summary: request.summary ?? { rangeCount: 0, totalSeconds: 0 },
          analyzedMediaCount: 0,
          failedMediaCount: 0,
        }),

      updatePreview: (request) =>
        set({
          settings: normalizeSilenceRemovalSettings(request.settings),
          rangesByMediaId: request.rangesByMediaId,
          summary: request.summary,
          analyzedMediaCount: request.analyzedMediaCount,
          failedMediaCount: request.failedMediaCount,
        }),

      close: () =>
        set({
          isOpen: false,
          itemIds: [],
          rangesByMediaId: {},
          summary: { rangeCount: 0, totalSeconds: 0 },
          analyzedMediaCount: 0,
          failedMediaCount: 0,
        }),
    }),
    {
      name: 'freecut-silence-removal-settings',
      partialize: (state) => ({ settings: state.settings }) as SilenceRemovalDialogStore,
    },
  ),
)
