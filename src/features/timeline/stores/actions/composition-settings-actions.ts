/**
 * Authored canvas settings for a layer-based composition.
 */

import { useCompositionsStore } from '../compositions-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'

export interface CompositionCanvasSettingsUpdate {
  width?: number
  height?: number
  backgroundColor?: string
}

function normalizeDimension(value: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.max(1, Math.min(max, Math.round(value)))
}

/**
 * Update a composition's own canvas rather than the root project canvas.
 *
 * Composition instances share their source composition, so this intentionally
 * changes every reuse of the composition. The command snapshot makes the whole
 * update undoable as one editor action.
 */
export function setCompositionCanvasSettings(
  compositionId: string,
  updates: CompositionCanvasSettingsUpdate,
): void {
  execute(
    'SET_COMPOSITION_CANVAS_SETTINGS',
    () => {
      const composition = useCompositionsStore.getState().getComposition(compositionId)
      if (!composition || composition.editorKind !== 'composite-2d') return

      const next: CompositionCanvasSettingsUpdate = {}
      if (updates.width !== undefined) {
        const width = normalizeDimension(updates.width, 7680)
        if (width !== undefined && width !== composition.width) next.width = width
      }
      if (updates.height !== undefined) {
        const height = normalizeDimension(updates.height, 4320)
        if (height !== undefined && height !== composition.height) next.height = height
      }
      if (
        updates.backgroundColor !== undefined &&
        updates.backgroundColor !== composition.backgroundColor
      ) {
        next.backgroundColor = updates.backgroundColor
      }

      if (Object.keys(next).length === 0) return
      useCompositionsStore.getState().updateComposition(compositionId, next)
      useTimelineSettingsStore.getState().markDirty()
    },
    { compositionId, ...updates },
  )
}
