/**
 * Pre-resolves sub-composition media URLs so segment extraction can read them
 * synchronously.
 */

import type { CompositionInputProps } from '@/types/export'
import { createLogger } from '@/shared/logging/logger'
import {
  useCompositionsStore,
  collectReachableCompositionIdsFromTracks,
} from '@/runtime/renderer/deps/timeline-compositions-contract'
import { resolveMediaUrl } from '@/runtime/renderer/deps/media-library-contract'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'

const log = createLogger('CanvasAudio/media-urls')

/**
 * Pre-resolve sub-composition media URLs so extractAudioSegments can access them.
 * blobUrlManager.get() is synchronous but may not have URLs for sub-comp items
 * until they're acquired via resolveMediaUrl (async OPFS read).
 */
export async function resolveSubCompMediaUrls(composition: CompositionInputProps): Promise<void> {
  const tracks = composition.tracks ?? []
  const urlResolutions: Promise<void>[] = []
  const compositionById = useCompositionsStore.getState().compositionById
  const reachableCompositionIds = collectReachableCompositionIdsFromTracks(tracks, compositionById)
  for (const compositionId of reachableCompositionIds) {
    const subComp = compositionById[compositionId]
    if (!subComp) continue
    for (const subItem of subComp.items) {
      if (subItem.type !== 'video' && subItem.type !== 'audio') continue
      if (subItem.mediaId && !blobUrlManager.get(subItem.mediaId)) {
        urlResolutions.push(resolveMediaUrl(subItem.mediaId).then(() => {}))
      }
    }
  }
  if (urlResolutions.length > 0) {
    log.debug('Pre-resolving sub-comp audio URLs', { count: urlResolutions.length })
    await Promise.all(urlResolutions)
  }
}
