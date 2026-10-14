/**
 * Finished generations of the open project into its media library: each file
 * is fetched from the server and imported through the library's own path for
 * generated media (thumbnails, waveforms, metadata), then the job is marked
 * imported on the server, so a second window or a restart does not import it
 * again. A result is named by what its prompt asked for. Jobs started with "put on the timeline" are placed where the playhead was when they were asked for.
 */

import { createLogger } from '@/shared/logging/logger'
import { i18n } from '@/i18n'
import { generateApi, type Job } from './generate-api'
import { mediaLibraryService, saveTimeline, useMediaLibraryStore, useProjectStore } from '../deps/editor'
import { useGenerateStore } from '../stores/generate-store'
import { placeMediaAt } from './timeline-actions'
import { resultFileName } from './result-title'

const logger = createLogger('GenerateImport')

const inFlight = new Set<string>()

function needsImport(job: Job, projectId: string | null): boolean {
  return (
    job.status === 'done' &&
    !!projectId &&
    job.project_id === projectId &&
    job.imported.length === 0 &&
    job.outputs.some((output) => output.kind === 'image' || output.kind === 'video' || output.kind === 'audio')
  )
}

async function importJob(job: Job, projectId: string): Promise<void> {
  const mediaIds: string[] = []
  const tags = ['generated', job.provider, job.model_name]
  const media = job.outputs.filter((output) => output.kind === 'image' || output.kind === 'video' || output.kind === 'audio')
  for (const [position, output] of media.entries()) {
    const response = await fetch(generateApi.fileUrl(job.id, output.index), { cache: 'no-store' })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const blob = await response.blob()
    const extension = output.file.split('.').pop() ?? 'bin'
    const file = new File([blob], resultFileName(job, position, media.length, extension), { type: output.mime })
    const imported =
      output.kind === 'image'
        ? await mediaLibraryService.importGeneratedImage(file, projectId, { tags })
        : output.kind === 'video'
          ? await mediaLibraryService.importGeneratedVideo(file, projectId, { tags })
          : await mediaLibraryService.importGeneratedAudio(file, projectId, { tags })
    mediaIds.push(imported.id)
  }
  await useMediaLibraryStore.getState().loadMediaItems()
  const updated = await generateApi.markImported(job.id, mediaIds)
  useGenerateStore.getState().upsertJob(updated)
  if (job.place) {
    for (const mediaId of mediaIds) placeMediaAt(mediaId, job.place_at)
    await saveTimeline(projectId)
  }
}

/** Imports what is due; safe to call on every job event. */
export function importFinished(jobs: Job[]): void {
  const projectId = useProjectStore.getState().currentProject?.id ?? null
  for (const job of jobs) {
    if (!needsImport(job, projectId) || inFlight.has(job.id) || !projectId) continue
    inFlight.add(job.id)
    importJob(job, projectId)
      .catch((error: unknown) => {
        logger.error(`Import of generation ${job.id} failed`, error)
        useGenerateStore.getState().upsertJob({
          ...job,
          error: i18n.t('generate.importFailed', { reason: error instanceof Error ? error.message : String(error) }),
        })
      })
      .finally(() => inFlight.delete(job.id))
  }
}
