import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { getObjectUrlBlob } from '@/infrastructure/browser/object-url-registry'
import { proxyService, useMediaLibraryStore } from '../deps/media-library-contract'
import { importFilmstripCache } from '../deps/timeline-filmstrip'
import {
  cacheActivePreviewFallbackBitmap,
  getCachedActivePreviewFallbackBitmap,
  isActivePreviewTargetSuperseded,
} from './decoder-prewarm'

const MAX_FALLBACK_DRIFT_SECONDS = 0.75
const fallbackGenerationBySource = new Map<string, number>()
const fallbackInflight = new Map<string, Promise<void>>()
let filmstripModulePromise: ReturnType<typeof importFilmstripCache> | null = null

function loadFilmstripModule() {
  filmstripModulePromise ??= importFilmstripCache()
  return filmstripModulePromise
}

export function warmScrubProxyFallback(): void {
  void loadFilmstripModule().then(({ filmstripCache }) => filmstripCache.prewarm())
}

async function bitmapFromFrame(frame: { url: string; bitmap?: ImageBitmap }): Promise<ImageBitmap> {
  if (frame.bitmap) return createImageBitmap(frame.bitmap)
  const registeredBlob = getObjectUrlBlob(frame.url)
  if (registeredBlob) return createImageBitmap(registeredBlob)
  const response = await fetch(frame.url)
  if (!response.ok) throw new Error(`Scrub proxy frame unavailable (${response.status})`)
  return createImageBitmap(await response.blob())
}

export function scheduleScrubProxyFallback(src: string, timestamp: number): void {
  if (getCachedActivePreviewFallbackBitmap(src, timestamp)) return
  const mediaId = blobUrlManager.getMediaIdByUrl(src) ?? proxyService.getMediaIdByProxyUrl(src)
  if (!mediaId) return

  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media || media.duration <= 0) return

  const generation = (fallbackGenerationBySource.get(src) ?? 0) + 1
  fallbackGenerationBySource.set(src, generation)
  const key = `${src}:${timestamp.toFixed(6)}`
  if (fallbackInflight.has(key)) return

  const request = (async () => {
    const { filmstripCache } = await loadFilmstripModule()
    const filmstrip =
      filmstripCache.getFromCacheSync(mediaId) ??
      (await filmstripCache.loadFromDisk(mediaId, media.duration))
    if (!filmstrip || filmstrip.frames.length === 0) return

    let nearest = filmstrip.frames[0]!
    let nearestDistance = Math.abs(nearest.timestamp - timestamp)
    for (let index = 1; index < filmstrip.frames.length; index += 1) {
      const candidate = filmstrip.frames[index]!
      const distance = Math.abs(candidate.timestamp - timestamp)
      if (distance < nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    if (nearestDistance > MAX_FALLBACK_DRIFT_SECONDS) return

    const bitmap = await bitmapFromFrame(nearest)
    if (
      fallbackGenerationBySource.get(src) !== generation ||
      isActivePreviewTargetSuperseded(src, timestamp)
    ) {
      bitmap.close()
      return
    }
    cacheActivePreviewFallbackBitmap(src, timestamp, nearest.timestamp, bitmap)
  })()
    .catch(() => undefined)
    .finally(() => fallbackInflight.delete(key))
  fallbackInflight.set(key, request)
}

export function disposeScrubProxyFallback(): void {
  fallbackGenerationBySource.clear()
  fallbackInflight.clear()
}
