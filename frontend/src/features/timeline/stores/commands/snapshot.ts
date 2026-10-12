import type { TimelineSnapshot } from './types'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useMarkersStore } from '../markers-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useCompositionsStore } from '../compositions-store'
import { useSequencesStore } from '../sequences-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '@/features/timeline/deps/projects'
import { updateProject } from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'
import { sanitizeInOutPoints } from '../../utils/in-out-points'
import { getActiveInOutMaxFrame } from '../in-out-bound'

const logger = createLogger('TimelineSnapshot')

function projectMetadataEqual(
  left: TimelineSnapshot['projectMetadata'],
  right: TimelineSnapshot['projectMetadata'],
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return left === right
  }

  return (
    left.width === right.width &&
    left.height === right.height &&
    left.fps === right.fps &&
    (left.backgroundColor ?? '#000000') === (right.backgroundColor ?? '#000000')
  )
}

function restoreProjectMetadata(snapshot: TimelineSnapshot): void {
  if (!snapshot.projectId || !snapshot.projectMetadata) {
    return
  }

  const projectStoreState = useProjectStore.getState()
  const currentProject = projectStoreState.currentProject
  const storedProject =
    currentProject?.id === snapshot.projectId
      ? currentProject
      : (projectStoreState.projects.find((project) => project.id === snapshot.projectId) ?? null)

  if (!storedProject || projectMetadataEqual(storedProject.metadata, snapshot.projectMetadata)) {
    return
  }

  const nextUpdatedAt = Date.now()
  useProjectStore.setState((state) => ({
    currentProject:
      state.currentProject?.id === snapshot.projectId
        ? {
            ...state.currentProject,
            metadata: { ...snapshot.projectMetadata! },
            updatedAt: nextUpdatedAt,
          }
        : state.currentProject,
    projects: state.projects.map((project) =>
      project.id === snapshot.projectId
        ? {
            ...project,
            metadata: { ...snapshot.projectMetadata! },
            updatedAt: nextUpdatedAt,
          }
        : project,
    ),
  }))

  void Promise.resolve(
    updateProject(snapshot.projectId, {
      metadata: { ...snapshot.projectMetadata },
    }),
  ).catch((error) => {
    logger.error(`Failed to persist restored project metadata for ${snapshot.projectId}:`, error)
  })
}

/**
 * Capture a snapshot of all timeline state.
 * This is called before executing commands to enable undo.
 */
export function captureSnapshot(): TimelineSnapshot {
  const itemsState = useItemsStore.getState()
  const transitionsState = useTransitionsStore.getState()
  const keyframesState = useKeyframesStore.getState()
  const markersState = useMarkersStore.getState()
  const settingsState = useTimelineSettingsStore.getState()
  const compositionsState = useCompositionsStore.getState()
  const playbackState = usePlaybackStore.getState()
  const projectState = useProjectStore.getState()
  const currentProject = projectState.currentProject

  return {
    items: itemsState.items,
    tracks: itemsState.tracks,
    transitions: transitionsState.transitions,
    keyframes: keyframesState.keyframes,
    markers: markersState.markers,
    compositions: compositionsState.compositions,
    topLevelSequenceIds: useSequencesStore.getState().topLevelSequenceIds,
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
    fps: settingsState.fps,
    scrollPosition: settingsState.scrollPosition,
    snapEnabled: settingsState.snapEnabled,
    currentFrame: playbackState.currentFrame,
    busAudioEq: playbackState.busAudioEq,
    masterBusDb: playbackState.masterBusDb,
    projectId: currentProject?.id ?? null,
    projectMetadata: currentProject ? { ...currentProject.metadata } : null,
  }
}

/**
 * Restore all timeline state from a snapshot.
 * This is called during undo/redo to revert to a previous state.
 * All stores are updated synchronously to avoid inconsistent intermediate states.
 */
export function restoreSnapshot(snapshot: TimelineSnapshot): void {
  // Restore items and tracks
  useItemsStore.getState().setItems(snapshot.items)
  useItemsStore.getState().setTracks(snapshot.tracks)

  // Restore transitions
  useTransitionsStore.getState().setTransitions(snapshot.transitions)

  // Restore keyframes
  useKeyframesStore.getState().setKeyframes(snapshot.keyframes)

  // Restore compositions + their standalone-timeline tab membership together,
  // so undoing a sequence creation removes the tab id instead of dangling it.
  // Ahead of the in/out sanitize below: inside a composition the range is bounded
  // by that comp's canvas, so its restored duration has to be in place first.
  useCompositionsStore.getState().setCompositions(snapshot.compositions)
  useSequencesStore.getState().setTopLevelSequenceIds(snapshot.topLevelSequenceIds)

  // Restore markers and in/out points
  useMarkersStore.getState().setMarkers(snapshot.markers)
  const sanitizedInOutPoints = sanitizeInOutPoints({
    inPoint: snapshot.inPoint,
    outPoint: snapshot.outPoint,
    maxFrame: getActiveInOutMaxFrame(snapshot.items, snapshot.fps),
  })
  useMarkersStore.getState().setInPoint(sanitizedInOutPoints.inPoint)
  useMarkersStore.getState().setOutPoint(sanitizedInOutPoints.outPoint)

  // Restore settings
  useTimelineSettingsStore.getState().setFps(snapshot.fps)
  useTimelineSettingsStore.getState().setScrollPosition(snapshot.scrollPosition)
  useTimelineSettingsStore.getState().setSnapEnabled(snapshot.snapEnabled)

  // Restore playhead position
  usePlaybackStore.getState().setCurrentFrame(snapshot.currentFrame)
  usePlaybackStore.getState().setBusAudioEq(snapshot.busAudioEq)
  usePlaybackStore.getState().setMasterBusDb(snapshot.masterBusDb ?? 0)

  // Restore current project metadata so canvas/project changes undo with the editor history.
  restoreProjectMetadata(snapshot)
}

/**
 * Check if two snapshots are equal (for deduplication).
 * Uses reference equality for most fields; busAudioEq uses JSON.stringify
 * for deep comparison because it may be structurally equal across restores.
 */
export function snapshotsEqual(a: TimelineSnapshot, b: TimelineSnapshot): boolean {
  return (
    a.items === b.items &&
    a.tracks === b.tracks &&
    a.transitions === b.transitions &&
    a.keyframes === b.keyframes &&
    a.markers === b.markers &&
    a.compositions === b.compositions &&
    a.topLevelSequenceIds === b.topLevelSequenceIds &&
    a.inPoint === b.inPoint &&
    a.outPoint === b.outPoint &&
    a.fps === b.fps &&
    a.scrollPosition === b.scrollPosition &&
    a.snapEnabled === b.snapEnabled &&
    a.currentFrame === b.currentFrame &&
    JSON.stringify(a.busAudioEq ?? null) === JSON.stringify(b.busAudioEq ?? null) &&
    a.masterBusDb === b.masterBusDb &&
    a.projectId === b.projectId &&
    projectMetadataEqual(a.projectMetadata, b.projectMetadata)
  )
}
