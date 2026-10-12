import { create } from 'zustand'
import { createLogger } from '@/shared/logging/logger'
import {
  buildLottieAttribution,
  fetchLottieAnimations,
  offsetToCursor,
  type LottieBrowseCategory,
  type LottieFilesAnimation,
} from '../services/lottiefiles-api'
import { useMediaLibraryStore } from '../deps/media-library'

const logger = createLogger('LottieBrowserStore')

export const LOTTIE_PAGE_SIZE = 24

// Cancels the previous page fetch when a newer one starts, so superseded
// requests don't linger on the network.
let inFlightController: AbortController | null = null

type LottieBrowserStatus = 'idle' | 'loading' | 'error'

interface LottieBrowserState {
  category: LottieBrowseCategory
  /** The committed (debounced) search query driving results. */
  query: string
  /** Current 0-based page index. */
  page: number
  /** Animations on the current page only. */
  items: LottieFilesAnimation[]
  status: LottieBrowserStatus
  error: string | null
  /** True once the first fetch has resolved (avoids an initial empty-state flash). */
  hasFetched: boolean
  /** Total matches across all pages, for the page counter. */
  totalCount: number
  /** Animations with an import in flight. */
  importingIds: Set<string>
  /** Animations already added to the media library this session. */
  importedIds: Set<string>
  /** Animations whose last import attempt failed (click again to retry). */
  failedIds: Set<string>
  /** Bumped on every fetch so late responses can be discarded. */
  requestId: number

  setCategory: (category: LottieBrowseCategory) => void
  setQuery: (query: string) => void
  /** Fetch a specific page for the current feed/query. */
  goToPage: (page: number) => Promise<void>
  /** Reload from the first page (used on feed/query change). */
  refresh: () => Promise<void>
  importAnimation: (animation: LottieFilesAnimation) => Promise<void>
}

function withoutId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  next.delete(id)
  return next
}

export const useLottieBrowserStore = create<LottieBrowserState>()((set, get) => ({
  category: 'featured',
  query: '',
  page: 0,
  items: [],
  status: 'idle',
  error: null,
  hasFetched: false,
  totalCount: 0,
  importingIds: new Set(),
  importedIds: new Set(),
  failedIds: new Set(),
  requestId: 0,

  setCategory: (category) => {
    if (category === get().category) return
    set({ category })
  },

  setQuery: (query) => {
    if (query === get().query) return
    set({ query })
  },

  refresh: async () => {
    await get().goToPage(0)
  },

  goToPage: async (page) => {
    const target = Math.max(0, page)

    // Cancel any in-flight fetch so a superseded page load doesn't linger.
    inFlightController?.abort()
    const controller = new AbortController()
    inFlightController = controller

    const requestId = get().requestId + 1
    // Keep the existing grid visible during the fetch to avoid a flash; the
    // pager is disabled via `status` while loading.
    set({ requestId, status: 'loading', error: null })

    const { category, query } = get()
    try {
      const after = target === 0 ? null : offsetToCursor(target * LOTTIE_PAGE_SIZE - 1)
      const result = await fetchLottieAnimations({
        category,
        query,
        after,
        first: LOTTIE_PAGE_SIZE,
        signal: controller.signal,
      })
      if (get().requestId !== requestId) return
      set({
        items: result.items,
        totalCount: result.totalCount,
        page: target,
        status: 'idle',
        hasFetched: true,
      })
    } catch (error) {
      // A newer request aborted this one — it owns the loading/error state now.
      if (controller.signal.aborted) return
      if (get().requestId !== requestId) return
      logger.warn('Failed to load animations', error)
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to load animations',
        hasFetched: true,
      })
    }
  },

  importAnimation: async (animation) => {
    const state = get()
    if (state.importingIds.has(animation.id) || state.importedIds.has(animation.id)) return

    // Mark in-flight and clear any prior failure (this may be a retry).
    set({
      importingIds: new Set(state.importingIds).add(animation.id),
      failedIds: withoutId(state.failedIds, animation.id),
    })

    const markFailed = () =>
      set((current) => ({
        importingIds: withoutId(current.importingIds, animation.id),
        failedIds: new Set(current.failedIds).add(animation.id),
      }))

    try {
      const result = await useMediaLibraryStore.getState().importRemoteLottie({
        url: animation.lottieUrl,
        fileName: animation.name,
        attribution: buildLottieAttribution(animation),
      })
      if (!result) {
        // The action reports failures as null (it surfaces them via its own
        // notifications, which aren't visible from this tab) — flag the card.
        logger.warn('Import returned no media for animation', animation.id)
        markFailed()
        return
      }
      // Imported, or already present in the library — either way it's available.
      set((current) => ({
        importingIds: withoutId(current.importingIds, animation.id),
        importedIds: new Set(current.importedIds).add(animation.id),
      }))
    } catch (error) {
      logger.warn('Failed to import animation', error)
      markFailed()
    }
  },
}))
