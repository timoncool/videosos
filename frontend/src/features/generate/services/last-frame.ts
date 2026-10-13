/**
 * The last frame of a finished video as a picture in the project's media library, to start the next video from
 * ("continue"). The frame is read by the window's own video decoder, so nothing is sent anywhere.
 */

import { mediaLibraryService, useMediaLibraryStore } from '../deps/editor'

/** How far before the end the frame is taken: the very last timestamp of a file often decodes to nothing. */
const BEFORE_END_SECONDS = 0.05

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.onloadedmetadata = () => resolve(video)
    video.onerror = () => reject(new Error(`the video ${url} does not open`))
    video.src = url
  })
}

function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('the video cannot seek to its end'))
    video.currentTime = seconds
  })
}

/** Imports the last frame of the video at `url` and answers with its media id. */
export async function importLastFrame(url: string, name: string, projectId: string): Promise<string> {
  const video = await loadVideo(url)
  await seek(video, Math.max(0, video.duration - BEFORE_END_SECONDS))
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('the window cannot draw a picture')
  context.drawImage(video, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((made) => (made ? resolve(made) : reject(new Error('the frame was not encoded'))), 'image/png'),
  )
  const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() })
  const media = await mediaLibraryService.importGeneratedImage(file, projectId, {
    width: canvas.width,
    height: canvas.height,
    tags: ['generated', 'last-frame'],
    codec: 'png',
  })
  useMediaLibraryStore.getState().prependMediaItem(media)
  return media.id
}
