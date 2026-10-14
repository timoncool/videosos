/**
 * The open project's timeline as an FCPXML file: its tracks and clips from the editor, each media file's place on
 * this computer from the workspace, saved where the person chooses in the program or downloaded in a browser.
 */

import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { mediaSourcePath } from '@/infrastructure/storage'
import { isDesktop, revealOnDisk, saveToDisk } from '@/infrastructure/desktop'
import { useProjectStore } from '../deps/projects'
import { getMediaMetadataById } from '../deps/media-library'
import { useItemsStore } from '../deps/timeline'
import { studioApi } from '../deps/studio'
import { buildFcpxml, type FcpxmlMedia } from './fcpxml'

export async function exportFcpxml(): Promise<void> {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(i18n.t('export.fcpxml.noProject'))
  const { tracks, items } = useItemsStore.getState()
  const { projects_dir: workspace } = await studioApi.appPaths()
  const media: Record<string, FcpxmlMedia> = {}
  for (const mediaId of new Set(items.flatMap((item) => ('mediaId' in item && item.mediaId ? [item.mediaId] : [])))) {
    const metadata = getMediaMetadataById(mediaId)
    if (!metadata) continue
    const segments = await mediaSourcePath(mediaId)
    media[mediaId] = {
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      duration: metadata.duration,
      audioCodec: metadata.audioCodec,
      path: segments ? [workspace, ...segments].join(workspace.includes('\\') ? '\\' : '/') : null,
    }
  }
  const { xml, left } = buildFcpxml({
    name: project.name,
    width: project.metadata.width,
    height: project.metadata.height,
    fps: project.metadata.fps,
    tracks,
    items,
    media,
  })
  const blob = new Blob([xml], { type: 'application/xml' })
  const name = `${project.name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'videosos'}.fcpxml`
  if (await isDesktop()) {
    const saved = await saveToDisk(blob, name, { dialog: true })
    if (saved.cancelled || !saved.path) return
    const path = saved.path
    toast.success(i18n.t('desktop.saved', { path }), { action: { label: i18n.t('desktop.reveal'), onClick: () => void revealOnDisk(path) } })
  } else {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (left.length > 0) {
    const reasons = (['kind', 'file', 'speed'] as const)
      .map((reason) => ({ reason, labels: left.filter((each) => each.reason === reason).map((each) => each.label) }))
      .filter((group) => group.labels.length > 0)
      .map((group) => i18n.t(`export.fcpxml.left.${group.reason}`, { items: group.labels.join(', ') }))
    toast.warning(reasons.join('\n'))
  }
}
