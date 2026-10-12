/**
 * Track Height Actions - resizing tracks and switching the Track Size preset.
 *
 * Unlike every other module in this directory these deliberately do NOT go
 * through `execute()`: track height is a local view preference persisted to
 * localStorage (see `utils/track-heights.ts`), not project data. Resizing a
 * track pushes no undo entry and does not mark the project dirty, the same way
 * the timeline's A/V section divider behaves.
 */

import type { TimelineTrack } from '@/types/timeline'
import { useEditorStore, type TrackSizePreset } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '../items-store'
import {
  clearAllTrackHeightOverrides,
  clearTrackHeightOverride,
  setTrackHeightOverride,
} from '../../utils/track-heights'

/**
 * Re-derive every track's height from the preset + overrides. `setTracks` does
 * the resolving, so handing it back the current array is enough.
 */
function refreshTrackHeights(): void {
  useItemsStore.getState().setTracks(useItemsStore.getState().tracks)
}

/**
 * Persist the heights carried by `nextTracks` as per-track overrides, then push
 * the tracks into the store. Only tracks whose height actually moved are
 * recorded, so an untouched track keeps following the preset.
 */
export function commitTrackHeights(nextTracks: TimelineTrack[]): void {
  const previousById = new Map(useItemsStore.getState().tracks.map((track) => [track.id, track]))

  for (const track of nextTracks) {
    if (previousById.get(track.id)?.height === track.height) continue
    setTrackHeightOverride(track.id, track.height)
  }

  useItemsStore.getState().setTracks(nextTracks)
}

/** Switch the saved Track Size preset and drop every per-track override. */
export function applyTrackSizePreset(preset: TrackSizePreset): void {
  usePlaybackStore.getState().setPreviewFrame(null)
  useEditorStore.getState().setTrackSizePreset(preset)
  clearAllTrackHeightOverrides()
  refreshTrackHeights()
}

/** Drop the override on one track (or all of them) so it snaps back to the preset. */
export function resetTrackHeights(trackId: string, applyToAll: boolean): void {
  usePlaybackStore.getState().setPreviewFrame(null)

  if (applyToAll) {
    clearAllTrackHeightOverrides()
  } else {
    clearTrackHeightOverride(trackId)
  }

  refreshTrackHeights()
}
