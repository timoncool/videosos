/** A motion graphics clip made from code into the open project: its library, and the timeline at the playhead on a
 * track free there, so it lies over the video at that moment. */

import { mediaLibraryService, useMediaLibraryStore, useProjectStore } from '../deps/editor'
import { renderMotion } from './motion-render'
import { placeMediaAt, playheadSeconds } from './timeline-actions'
import { resultFileName } from './result-title'
import { useGenerateStore } from '../stores/generate-store'

/** What the code says, as the clip's name: its visible words, or a plain name without any. */
export function motionName(html: string, fallback: string): string {
  const words = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words ? words.slice(0, 60) : fallback
}

/** Renders the code into the open project's library and puts the clip at the playhead; answers its media id. */
export async function makeMotionClip(
  html: string,
  seconds: number,
  name: string,
  progress?: (share: number) => void,
): Promise<string> {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('no project is open')
  const { width, height, fps } = project.metadata
  const blob = await renderMotion(html, { width, height, fps, seconds }, progress)
  const file = new File([blob], resultFileName({ title: name }, 0, 1, 'webm'), {
    type: 'video/webm',
    lastModified: Date.now(),
  })
  const media = await mediaLibraryService.importGeneratedVideo(file, project.id, {
    tags: ['motion'],
  })
  const library = useMediaLibraryStore.getState()
  if (!library.mediaById[media.id]) library.prependMediaItem(media)
  placeMediaAt(media.id, playheadSeconds())
  useGenerateStore.getState().keepMotion({ mediaId: media.id, name, html, seconds })
  return media.id
}
