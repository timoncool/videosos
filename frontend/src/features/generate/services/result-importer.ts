/**
 * Finished generations of the open project into its media library: each file
 * is fetched from the server and imported through the library's own path for
 * generated media (thumbnails, waveforms, metadata), then the job is marked
 * imported on the server, so a second window or a restart does not import it
 * again. Jobs started with "put on the timeline" are placed at the playhead.
 */

import { createLogger } from '@/shared/logging/logger'
import { i18n } from '@/i18n'
import { generateApi, type Job } from './generate-api'
import { mediaLibraryService, saveTimeline, useMediaLibraryStore, useProjectStore } from '../deps/editor'
import { useGenerateStore } from '../stores/generate-store'
import { placeMediaAtPlayhead } from './timeline-actions'

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
  for (const output of job.outputs) {
    if (output.kind !== 'image' && output.kind !== 'video' && output.kind !== 'audio') continue
    const response = await fetch(generateApi.fileUrl(job.id, output.index), { cache: 'no-store' })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const blob = await response.blob()
    const extension = output.file.split('.').pop() ?? 'bin'
    const base = (job.model_name || job.model).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)
    const name = `${base}-${job.id.slice(-6)}-${output.index + 1}.${extension}`
    const file = new File([blob], name, { type: output.mime })
    const media =
      output.kind === 'image'
        ? await mediaLibraryService.importGeneratedImage(file, projectId, { tags })
        : output.kind === 'video'
          ? await mediaLibraryService.importGeneratedVideo(file, projectId, { tags })
          : await mediaLibraryService.importGeneratedAudio(file, projectId, { tags })
    mediaIds.push(media.id)
  }
  await useMediaLibraryStore.getState().loadMediaItems()
  const updated = await generateApi.markImported(job.id, mediaIds)
  useGenerateStore.getState().upsertJob(updated)
  if (job.place || useGenerateStore.getState().toPlace.includes(job.id)) {
    useGenerateStore.getState().placed(job.id)
    for (const mediaId of mediaIds) placeMediaAtPlayhead(mediaId)
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
