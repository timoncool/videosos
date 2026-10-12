import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { getMedia, updateMedia } from '@/infrastructure/storage'
import { opfsService } from '@/runtime/composition-runtime/deps/media-library-opfs'
import { createLogger } from '@/shared/logging/logger'
import type { MediaMetadata } from '@/types/storage'
import {
  readWorkspaceBlob,
  removeWorkspaceCacheEntry,
} from '@/infrastructure/storage/workspace-fs/cache-mirror'
import { previewAudioPath } from '@/infrastructure/storage/workspace-fs/paths'
import { requireWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { exists, writeBlob } from '@/infrastructure/storage/workspace-fs/fs-primitives'
import { audioBufferToWavBlob, int16StereoToWavBlob } from './audio-buffer-wav'

const log = createLogger('PreviewAudioConform')

const PREVIEW_AUDIO_CONFORM_MIME_TYPE = 'audio/wav'

const pendingPreviewAudioConformLoads = new Map<string, Promise<string | null>>()
const pendingPreviewAudioConformPersists = new Map<string, Promise<void>>()

function getPreviewAudioConformCacheKey(mediaId: string): string {
  return `preview-audio:${mediaId}`
}

/**
 * True when the conform WAV has already been persisted for this media and the
 * file is still present. Callers use this to skip the (expensive) decode +
 * AudioBuffer rebuild that would otherwise run purely to feed a conform that is
 * already on disk — the dominant source of jank when audio clips scroll back
 * into view.
 */
export async function isPreviewAudioConformed(mediaId: string): Promise<boolean> {
  const media = await getMedia(mediaId)
  if (!media?.previewAudioConformedAt) {
    return false
  }
  try {
    return await exists(requireWorkspaceRoot(), previewAudioPath(mediaId))
  } catch {
    return false
  }
}

export async function resolvePreviewAudioConformUrl(mediaId: string): Promise<string | null> {
  const cacheKey = getPreviewAudioConformCacheKey(mediaId)
  const cached = blobUrlManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const pending = pendingPreviewAudioConformLoads.get(mediaId)
  if (pending) {
    return pending
  }

  const promise = (async () => {
    try {
      const media = await getMedia(mediaId)
      if (!media?.previewAudioConformedAt && !media?.previewAudioOpfsPath) {
        return null
      }
      const mimeType = media.previewAudioMimeType || PREVIEW_AUDIO_CONFORM_MIME_TYPE

      const workspaceBlob = await readWorkspaceBlob(previewAudioPath(mediaId))
      if (workspaceBlob) {
        return blobUrlManager.acquire(
          cacheKey,
          new Blob([await workspaceBlob.arrayBuffer()], { type: mimeType }),
        )
      }

      // Legacy fallback: older sessions wrote only to OPFS under a sharded
      // path recorded in `previewAudioOpfsPath`. If found there, hydrate the
      // workspace v2 copy so subsequent reads stay workspace-first.
      const legacyPath = media.previewAudioOpfsPath
      if (!legacyPath) {
        return null
      }
      try {
        const bytes = await opfsService.getFile(legacyPath)
        await writeBlob(requireWorkspaceRoot(), previewAudioPath(mediaId), new Uint8Array(bytes))
        return blobUrlManager.acquire(cacheKey, new Blob([bytes], { type: mimeType }))
      } catch (err) {
        log.warn('Failed to resolve preview audio conform asset from legacy OPFS', {
          mediaId,
          path: legacyPath,
          err,
        })
        return null
      }
    } catch (err) {
      log.warn('Failed to resolve preview audio conform asset', { mediaId, err })
      return null
    } finally {
      pendingPreviewAudioConformLoads.delete(mediaId)
    }
  })()

  pendingPreviewAudioConformLoads.set(mediaId, promise)
  return promise
}

/**
 * Encode and persist the conform WAV. `buildBlob` is a lazy factory so the
 * (potentially expensive) encode only runs once the in-flight guard and the
 * already-conformed check have cleared — never speculatively per call.
 */
function persistConform(mediaId: string, buildBlob: () => Blob): Promise<void> {
  const pending = pendingPreviewAudioConformPersists.get(mediaId)
  if (pending) {
    return pending
  }

  const promise = (async () => {
    const media = await getMedia(mediaId)
    if (!media) {
      return
    }

    // Already conformed in a prior visit/session — the WAV is on disk. Clips
    // re-enter the viewport constantly while scrolling and each remount retries
    // the conform; re-encoding the whole WAV every time is pure main-thread
    // waste, so bail when the persisted asset is still present.
    if (media.previewAudioConformedAt) {
      try {
        if (await exists(requireWorkspaceRoot(), previewAudioPath(mediaId))) {
          return
        }
      } catch {
        // Existence check failed — fall through and re-persist defensively.
      }
    }

    const cacheKey = getPreviewAudioConformCacheKey(mediaId)
    const wavBlob = buildBlob()
    if (!blobUrlManager.get(cacheKey)) {
      blobUrlManager.acquire(cacheKey, wavBlob)
    }

    const bytes = await wavBlob.arrayBuffer()
    await writeBlob(requireWorkspaceRoot(), previewAudioPath(mediaId), new Uint8Array(bytes))

    await updateMedia(mediaId, {
      previewAudioMimeType: PREVIEW_AUDIO_CONFORM_MIME_TYPE,
      previewAudioConformedAt: Date.now(),
    })
  })()
    .catch((err) => {
      log.warn('Failed to persist preview audio conform asset', { mediaId, err })
    })
    .finally(() => {
      pendingPreviewAudioConformPersists.delete(mediaId)
    })

  pendingPreviewAudioConformPersists.set(mediaId, promise)
  return promise
}

export function persistPreviewAudioConform(mediaId: string, buffer: AudioBuffer): Promise<void> {
  return persistConform(mediaId, () => audioBufferToWavBlob(buffer))
}

/**
 * Conform straight from persisted Int16 bins, avoiding the AudioBuffer
 * Int16→Float32→Int16 round-trip. Preferred on the fresh-decode path where the
 * raw Int16 samples are already in hand.
 */
export function persistPreviewAudioConformFromInt16(
  mediaId: string,
  left: Int16Array,
  right: Int16Array,
  sampleRate: number,
): Promise<void> {
  return persistConform(mediaId, () => int16StereoToWavBlob(left, right, sampleRate))
}

export async function deletePreviewAudioConform(
  mediaOrId: MediaMetadata | string,
  options?: { clearMetadata?: boolean },
): Promise<void> {
  const mediaId = typeof mediaOrId === 'string' ? mediaOrId : mediaOrId.id
  const media = typeof mediaOrId === 'string' ? await getMedia(mediaOrId) : mediaOrId

  pendingPreviewAudioConformLoads.delete(mediaId)
  pendingPreviewAudioConformPersists.delete(mediaId)
  blobUrlManager.invalidate(getPreviewAudioConformCacheKey(mediaId))

  await removeWorkspaceCacheEntry(previewAudioPath(mediaId))

  if (media?.previewAudioOpfsPath) {
    const legacyPath = media.previewAudioOpfsPath
    try {
      await opfsService.deleteFile(legacyPath)
    } catch (err) {
      log.debug('Legacy OPFS preview audio conform asset was already absent or unreadable', {
        mediaId,
        path: legacyPath,
        err,
      })
    }
  }

  if (options?.clearMetadata && media) {
    try {
      await updateMedia(mediaId, {
        previewAudioOpfsPath: undefined,
        previewAudioMimeType: undefined,
        previewAudioConformedAt: undefined,
      })
    } catch (err) {
      log.warn('Failed to clear preview audio conform metadata', { mediaId, err })
    }
  }
}
