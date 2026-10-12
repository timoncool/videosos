import type { TimelineItem, TimelineTrack } from '@/types/timeline'

/**
 * Build a set of track IDs whose items should contribute snap targets.
 */
export function getVisibleTrackIds(tracks: TimelineTrack[]): Set<string> {
  return new Set(
    resolveEffectiveTrackStates(tracks)
      .filter((track) => track.visible !== false)
      .map((track) => track.id),
  )
}

/**
 * Remove layer-group containers that no longer own any child tracks.
 *
 * A layer group is an organizational timeline container, not an item lane of
 * its own, so retaining an empty container only leaves an orphaned UI row.
 */
export function pruneEmptyLayerGroups(tracks: TimelineTrack[]): TimelineTrack[] {
  const populatedGroupIds = new Set(
    tracks
      .filter((track) => !track.isGroup && track.parentTrackId)
      .map((track) => track.parentTrackId as string),
  )

  const nextTracks = tracks.filter((track) => !track.isGroup || populatedGroupIds.has(track.id))
  return nextTracks.length === tracks.length ? tracks : nextTracks
}

/**
 * Remove empty child lanes after deleting Motion layers, then remove any Layer
 * Group containers that no longer have children. Empty top-level classic
 * timeline tracks remain valid and are deliberately preserved.
 */
export function pruneEmptyLayerGroupHierarchy(
  tracks: TimelineTrack[],
  items: ReadonlyArray<Pick<TimelineItem, 'trackId'>>,
): TimelineTrack[] {
  const populatedTrackIds = new Set(items.map((item) => item.trackId))
  const tracksWithPopulatedGroupChildren = tracks.filter(
    (track) => track.isGroup || !track.parentTrackId || populatedTrackIds.has(track.id),
  )

  return pruneEmptyLayerGroups(tracksWithPopulatedGroupChildren)
}

/**
 * Return active timeline lanes with inherited Layer Group state and without
 * the organizational container rows themselves.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  const groupsById = new Map(
    tracks.filter((track) => track.isGroup).map((track) => [track.id, track] as const),
  )

  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => {
      const parentGroup = track.parentTrackId ? groupsById.get(track.parentTrackId) : undefined
      if (!parentGroup) {
        return track
      }

      return {
        ...track,
        locked: track.locked || parentGroup.locked,
        muted: track.muted || parentGroup.muted,
        visible: track.visible !== false && parentGroup.visible !== false,
        solo: track.solo || parentGroup.solo,
      }
    })
}
