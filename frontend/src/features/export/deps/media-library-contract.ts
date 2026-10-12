/**
 * Adapter exports for media-library dependencies.
 * Export modules should import media resolution helpers from here.
 */

import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { importMediaLibraryService } from '@/features/media-library/services/media-library-service-loader'
import type { MediaMetadata } from '@/types/storage'

export { resolveMediaUrls } from '@/features/media-library/utils/media-resolver'

export function getMediaMetadataById(mediaId: string | undefined): MediaMetadata | undefined {
  if (!mediaId) return undefined
  return useMediaLibraryStore.getState().mediaById[mediaId]
}

export function useMediaMetadataById(mediaId: string | undefined): MediaMetadata | undefined {
  return useMediaLibraryStore((state) => (mediaId ? state.mediaById[mediaId] : undefined))
}

export async function getMediaFileById(mediaId: string): Promise<Blob | null> {
  const { mediaLibraryService } = await importMediaLibraryService()
  return mediaLibraryService.getMediaFile(mediaId)
}

export function useBrokenMediaIds(): string[] {
  return useMediaLibraryStore((state) => state.brokenMediaIds)
}
