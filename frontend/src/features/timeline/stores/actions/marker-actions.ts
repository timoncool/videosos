/**
 * Marker Actions - Project marker and in/out point operations.
 */

import type { ProjectMarker } from '@/types/timeline'
import { useMarkersStore } from '../markers-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { getActiveInOutMaxFrame } from '../in-out-bound'
import { execute } from './shared'
import { sanitizeInOutPoints } from '../../utils/in-out-points'

export function addMarker(frame: number, color?: string, label?: string): void {
  execute(
    'ADD_MARKER',
    () => {
      useMarkersStore.getState().addMarker(frame, color, label)
      useTimelineSettingsStore.getState().markDirty()
    },
    { frame, color, label },
  )
}

export function updateMarker(id: string, updates: Partial<Omit<ProjectMarker, 'id'>>): void {
  execute(
    'UPDATE_MARKER',
    () => {
      useMarkersStore.getState().updateMarker(id, updates)
      useTimelineSettingsStore.getState().markDirty()
    },
    { id, updates },
  )
}

export function removeMarker(id: string): void {
  execute(
    'REMOVE_MARKER',
    () => {
      useMarkersStore.getState().removeMarker(id)
      useTimelineSettingsStore.getState().markDirty()
    },
    { id },
  )
}

export function clearAllMarkers(): void {
  execute('CLEAR_MARKERS', () => {
    useMarkersStore.getState().clearAllMarkers()
    useTimelineSettingsStore.getState().markDirty()
  })
}

// =============================================================================
// IN/OUT POINT ACTIONS
// =============================================================================

export function setInPoint(frame: number): void {
  execute(
    'SET_IN_POINT',
    () => {
      const outPoint = useMarkersStore.getState().outPoint
      const maxFrame = getActiveInOutMaxFrame()

      // Validate: inPoint must be >= 0 and <= maxFrame
      const validatedFrame = Math.max(0, Math.min(frame, maxFrame))

      // If there is no out-point yet, default it to timeline end.
      if (outPoint === null) {
        useMarkersStore.getState().setOutPoint(maxFrame)
      }

      // If inPoint is placed after outPoint, reset outPoint to the end
      if (outPoint !== null && validatedFrame >= outPoint) {
        useMarkersStore.getState().setOutPoint(maxFrame)
      }

      useMarkersStore.getState().setInPoint(validatedFrame)
      useTimelineSettingsStore.getState().markDirty()
    },
    { frame },
  )
}

export function setOutPoint(frame: number): void {
  execute(
    'SET_OUT_POINT',
    () => {
      const inPoint = useMarkersStore.getState().inPoint
      const maxFrame = getActiveInOutMaxFrame()

      // Validate: outPoint must be >= 1 and <= maxFrame
      const validatedFrame = Math.max(1, Math.min(frame, maxFrame))

      // If there is no in-point yet, default it to timeline start.
      if (inPoint === null) {
        useMarkersStore.getState().setInPoint(0)
      }

      // If outPoint is placed before inPoint, reset inPoint to the beginning
      if (inPoint !== null && validatedFrame <= inPoint) {
        useMarkersStore.getState().setInPoint(0)
      }

      useMarkersStore.getState().setOutPoint(validatedFrame)
      useTimelineSettingsStore.getState().markDirty()
    },
    { frame },
  )
}

export function clearInOutPoints(): void {
  execute('CLEAR_IN_OUT_POINTS', () => {
    useMarkersStore.getState().clearInOutPoints()
    useTimelineSettingsStore.getState().markDirty()
  })
}

/**
 * Atomic, non-undoable in/out point write used by continuous UI interactions
 * (range drag, post-edit sanitization sync). Sanitizes against the current
 * timeline max frame and does NOT mark the project dirty — callers that own
 * the interaction lifecycle (e.g. mouseup) handle markDirty themselves.
 */
export function setInOutPointsWithoutHistory(
  inPoint: number | null,
  outPoint: number | null,
): void {
  const sanitized = sanitizeInOutPoints({
    inPoint,
    outPoint,
    maxFrame: getActiveInOutMaxFrame(),
  })
  useMarkersStore.getState().setInOutPoints(sanitized.inPoint, sanitized.outPoint)
}
