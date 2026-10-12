import type { TimelineTrack } from '@/types/timeline'
import { getTrackKind } from './classic-tracks'

export function getDefaultActiveTrackId(tracks: TimelineTrack[]): string | null {
  const bottomVideoTrack = tracks.findLast((track) => getTrackKind(track) === 'video')
  return bottomVideoTrack?.id ?? tracks[0]?.id ?? null
}
