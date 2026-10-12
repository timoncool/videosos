/**
 * Adapter exports for media-library dependencies.
 * Renderer modules should import media resolution helpers from here.
 */

import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'

export { resolveMediaUrl, resolveProxyUrl } from '@/features/media-library/utils/media-resolver'

export function getMediaAudioCodecById(mediaId: string | undefined): string | undefined {
  if (!mediaId) return undefined

  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) return undefined

  if (media.mimeType.startsWith('video/')) {
    return media.audioCodec
  }
  if (media.mimeType.startsWith('audio/')) {
    return media.codec
  }
  return undefined
}
