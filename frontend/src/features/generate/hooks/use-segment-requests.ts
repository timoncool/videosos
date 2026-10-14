import { useEffect } from 'react'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { useSegmentRequestStore, type SegmentRequest } from '@/shared/state/segment-request-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { mediaLibraryService, useMediaLibraryStore, useProjectStore } from '../deps/editor'
import { cutSegment } from '../services/clip-segment'
import { resultFileName } from '../services/result-title'
import { useGenerateStore } from '../stores/generate-store'

function seconds(value: number): string {
  return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
}

async function take(request: SegmentRequest): Promise<void> {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(i18n.t('generate.use.needsProject'))
  const source = await mediaLibraryService.getMediaFile(request.mediaId)
  if (!source) throw new Error(i18n.t('generate.segment.noFile', { name: request.label }))
  const cut = await cutSegment(source, request.start, request.end)
  const title = i18n.t('generate.segment.name', { title: request.label.replace(/\.[^.]+$/, ''), from: seconds(request.start), to: seconds(request.end) })
  const file = new File([cut], resultFileName({ title }, 0, 1, 'mp4'), { type: 'video/mp4', lastModified: Date.now() })
  const media = await mediaLibraryService.importGeneratedVideo(file, project.id, { tags: ['segment'] })
  await useMediaLibraryStore.getState().loadMediaItems()
  const fps = project.metadata?.fps ?? 30
  usePlaybackStore.getState().setCurrentFrame(Math.round(request.at * fps))
  useEditorStore.getState().setLeftSidebarOpen(true)
  useEditorStore.getState().setActiveTab('generate')
  useGenerateStore.getState().useAs({ task: 'video_edit', roles: ['source'], kind: 'video', ref: { media: media.id } })
}

/**
 * A clip's part the timeline asks to make again, as the competitors regenerate a stretch of a shot: it is cut
 * from the clip's file, put into the library and into "Edit video" as the source, and the playhead goes to the
 * clip, where "Put on the timeline" lands the new take.
 */
export function useSegmentRequests(): void {
  const request = useSegmentRequestStore((state) => state.request)
  useEffect(() => {
    if (!request) return
    useSegmentRequestStore.getState().clear()
    const range = { from: seconds(request.start), to: seconds(request.end) }
    toast.promise(take(request), {
      loading: i18n.t('generate.segment.cutting', range),
      success: i18n.t('generate.segment.ready', range),
      error: (error: unknown) => i18n.t('generate.segment.failed', { reason: error instanceof Error ? error.message : String(error) }),
    })
  }, [request])
}
