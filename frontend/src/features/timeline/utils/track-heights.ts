/**
 * Track heights are a local view preference, not project data.
 *
 * Two localStorage keys back them: the global Track Size preset
 * (`editor:trackSizePreset`, owned by the editor store) supplies the base row
 * height, and `editor:trackHeights:<projectId>` holds per-track overrides for
 * tracks the user has dragged to a custom height. `items-store.setTracks()`
 * re-derives `TimelineTrack.height` from these on every write, so the height
 * stored in a project file is ignored.
 *
 * Overrides are held in memory and flushed to localStorage on a short debounce
 * so a drag gesture doesn't write once per mousemove.
 */
import { useEditorStore } from '@/shared/state/editor'
import { TRACK_SIZE_PRESET_HEIGHTS } from '../constants'
import { clampTrackHeight } from './track-resize'

const OVERRIDES_KEY_PREFIX = 'editor:trackHeights:'
const PERSIST_DEBOUNCE_MS = 250

let activeProjectId: string | null = null
let overrides = new Map<string, number>()
let persistTimer: ReturnType<typeof setTimeout> | null = null

function storageKey(projectId: string): string {
  return `${OVERRIDES_KEY_PREFIX}${projectId}`
}

function writeOverrides(): void {
  if (!activeProjectId) return
  try {
    if (overrides.size === 0) {
      localStorage.removeItem(storageKey(activeProjectId))
      return
    }
    localStorage.setItem(storageKey(activeProjectId), JSON.stringify(Object.fromEntries(overrides)))
  } catch {
    /* noop */
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeOverrides()
  }, PERSIST_DEBOUNCE_MS)
}

/** Write any pending overrides immediately (end of a resize gesture). */
export function flushTrackHeightOverrides(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeOverrides()
}

/** Base row height for tracks with no override, from the saved Track Size preset. */
function getPresetTrackHeight(): number {
  return TRACK_SIZE_PRESET_HEIGHTS[useEditorStore.getState().trackSizePreset]
}

export function resolveTrackHeight(trackId: string): number {
  return overrides.get(trackId) ?? getPresetTrackHeight()
}

/** Swap the override set to the given project. Flushes the outgoing project first. */
export function loadTrackHeightOverrides(projectId: string): void {
  flushTrackHeightOverrides()
  activeProjectId = projectId
  overrides = new Map()

  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return

    for (const [trackId, height] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof height === 'number' && Number.isFinite(height)) {
        overrides.set(trackId, clampTrackHeight(height))
      }
    }
  } catch {
    /* noop */
  }
}

/**
 * Record a custom height for one track. A height equal to the current preset is
 * stored as "no override" so a later preset change still moves the track.
 */
export function setTrackHeightOverride(trackId: string, height: number): void {
  const clamped = clampTrackHeight(height)
  if (clamped === getPresetTrackHeight()) {
    overrides.delete(trackId)
  } else {
    overrides.set(trackId, clamped)
  }
  schedulePersist()
}

export function clearTrackHeightOverride(trackId: string): void {
  if (!overrides.delete(trackId)) return
  schedulePersist()
}

export function clearAllTrackHeightOverrides(): void {
  if (overrides.size === 0) return
  overrides.clear()
  schedulePersist()
}
