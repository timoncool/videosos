/**
 * A link download that finished goes into its project's media library, as a generation's results do: the file
 * is fetched from the server, imported through the library's own path for generated media, and the server is
 * told, which removes its copy. A second window or a restart does not import it again.
 */

import { createLogger } from '@/shared/logging/logger'
import { i18n } from '@/i18n'
import { toast } from 'sonner'
import { importMediaLibraryService } from './media-library-service-loader'
import { urlApi, type UrlFetch } from './url-api'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useUrlFetchStore } from '../stores/url-fetch-store'

const logger = createLogger('UrlImport')
const inFlight = new Set<string>()

async function importFetch(fetch: UrlFetch, projectId: string): Promise<void> {
  const response = await window.fetch(urlApi.fileUrl(fetch.id), { cache: 'no-store' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const blob = await response.blob()
  const file = new File([blob], fetch.file ?? `${fetch.title ?? 'video'}.mp4`, { type: fetch.mime ?? blob.type })
  const tags = ['link']
  const { mediaLibraryService: service } = await importMediaLibraryService()
  const media = fetch.mime?.startsWith('audio/')
    ? await service.importGeneratedAudio(file, projectId, { tags })
    : await service.importGeneratedVideo(file, projectId, { tags })
  await useMediaLibraryStore.getState().loadMediaItems()
  useUrlFetchStore.getState().upsert(await urlApi.imported(fetch.id, [media.id]))
  toast.success(i18n.t('media.url.imported', { title: fetch.title ?? fetch.url }))
}

/** Imports what is due into the open project; safe to call on every event. */
export function importFinishedFetches(fetches: UrlFetch[]): void {
  const projectId = useMediaLibraryStore.getState().currentProjectId
  if (!projectId) return
  for (const fetch of fetches) {
    if (fetch.status !== 'completed' || !fetch.file || fetch.imported.length > 0 || fetch.project_id !== projectId || inFlight.has(fetch.id)) continue
    inFlight.add(fetch.id)
    importFetch(fetch, projectId)
      .catch((error: unknown) => {
        logger.error(`Import of link download ${fetch.id} failed`, error)
        toast.error(i18n.t('media.url.importFailed', { title: fetch.title ?? fetch.url, reason: error instanceof Error ? error.message : String(error) }))
      })
      .finally(() => inFlight.delete(fetch.id))
  }
}
