import type { MediaLibraryState, MediaLibraryActions } from '../types'
import type { MediaMetadata } from '@/types/storage'
import { loadMediaLibraryService } from './media-library-service-access'
import { proxyService } from '../services/proxy-service'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { invalidateMediaCaptionCaches } from '../services/media-caption-cache-events'
import { useMediaPreparationStore } from './media-preparation-store'

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>),
) => void
type Get = () => MediaLibraryState & MediaLibraryActions

function applyOptimisticDelete(set: Set, ids: string[]): void {
  set((state) => ({
    mediaItems: state.mediaItems.filter((item) => !ids.includes(item.id)),
    selectedMediaIds: state.selectedMediaIds.filter((selectedId) => !ids.includes(selectedId)),
  }))
}

function getCaptionThumbRelPaths(media: MediaMetadata | undefined): Array<string | undefined> {
  return media?.aiCaptions?.map((caption) => caption.thumbRelPath) ?? []
}

function releaseDeletedMediaResources(
  ids: string[],
  previousItems: readonly MediaMetadata[],
): void {
  const previousMediaById = new Map(previousItems.map((item) => [item.id, item]))

  for (const id of ids) {
    blobUrlManager.release(id)
    proxyService.clearProxyKey(id)
    // Drop every Scene Browser cache tied to this media — thumbnail blob
    // URLs (which otherwise pin the JPEG in memory forever), lazy-thumb
    // result memos, and both text + image embedding maps. Disk-side
    // cleanup is already handled by the recursive `media/{id}/` removal.
    invalidateMediaCaptionCaches(id, getCaptionThumbRelPaths(previousMediaById.get(id)))
    useMediaPreparationStore.getState().clearMedia(id)
  }
}

export function createDeleteActions(
  set: Set,
  get: Get,
): Pick<MediaLibraryActions, 'deleteMedia' | 'deleteMediaBatch'> {
  const deleteMediaInternal = async (
    ids: string[],
    deleteOperation: () => Promise<void>,
    fallbackError: string,
  ): Promise<void> => {
    set({ error: null })

    const previousItems = get().mediaItems
    const previousSelected = get().selectedMediaIds
    applyOptimisticDelete(set, ids)

    try {
      await deleteOperation()
      releaseDeletedMediaResources(ids, previousItems)
    } catch (error) {
      set({
        mediaItems: previousItems,
        selectedMediaIds: previousSelected,
        error: error instanceof Error ? error.message : fallbackError,
      })
      throw error
    }
  }

  return {
    // Delete a media item (v3: project-scoped with reference counting)
    deleteMedia: async (id: string) => {
      const { currentProjectId } = get()
      await deleteMediaInternal(
        [id],
        async () => {
          const { mediaLibraryService } = await loadMediaLibraryService()
          return currentProjectId
            ? mediaLibraryService.deleteMediaFromProject(currentProjectId, id)
            : mediaLibraryService.deleteMedia(id)
        },
        'Delete failed',
      )
    },

    // Delete multiple media items in batch (v3: project-scoped)
    deleteMediaBatch: async (ids: string[]) => {
      const { currentProjectId } = get()
      await deleteMediaInternal(
        ids,
        async () => {
          const { mediaLibraryService } = await loadMediaLibraryService()
          return currentProjectId
            ? mediaLibraryService.deleteMediaBatchFromProject(currentProjectId, ids)
            : mediaLibraryService.deleteMediaBatch(ids)
        },
        'Batch delete failed',
      )
    },
  }
}
