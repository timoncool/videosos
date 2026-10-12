const SOURCE_MONITOR_PLAYING_RESYNC_THRESHOLD_FRAMES = 6

function shouldResyncPlayingMedia(
  currentTime: number,
  targetTime: number,
  fps: number,
): boolean {
  return Math.abs(currentTime - targetTime) * fps >= SOURCE_MONITOR_PLAYING_RESYNC_THRESHOLD_FRAMES
}

export function shouldSeekPlayingMedia(
  media: Pick<HTMLMediaElement, 'currentTime' | 'seeking'>,
  targetTime: number,
  fps: number,
): boolean {
  if (media.seeking) {
    return false
  }

  return shouldResyncPlayingMedia(media.currentTime, targetTime, fps)
}
