import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import { getSpatialPointEffectConfig } from '@/infrastructure/gpu-effects/spatial-point-editor'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  applyAutoKeyframeOperations,
  setItemEffects,
  useItemsStore,
  useKeyframesStore,
} from '../deps/timeline-store'
import { useGizmoStore } from '../stores/gizmo-store'
import { useSpatialEffectEditorStore } from '../stores/spatial-effect-editor-store'
import type { CoordinateParams, Point } from '../types/gizmo'
import { screenToCanvas } from '../utils/coordinate-transform'
import { planEffectGizmoCommit } from '../utils/effect-gizmo-keyframes'
import { canvasPointToSpatialEffectUv } from '../utils/spatial-effect-coordinates'
import { buildSpatialPointEffects } from './spatial-effect-point-overlay-utils'

interface SpatialEffectPointOverlayContainerProps {
  containerRect: DOMRect | null
  playerSize: { width: number; height: number }
  projectSize: { width: number; height: number }
  zoom: number
}

interface SpatialEffectPointOverlayProps {
  coordParams: CoordinateParams
  playerSize: { width: number; height: number }
  item: TimelineItem
  effect: ItemEffect
  xParam: string
  yParam: string
}

function findSpatialEffect(item: TimelineItem, effectId: string): ItemEffect | null {
  const effect = (item.effects ?? []).find((entry) => entry.id === effectId)
  if (!effect?.enabled || effect.effect.type !== 'gpu-effect') return null
  return getSpatialPointEffectConfig(effect.effect.gpuEffectType) ? effect : null
}

function readPoint(effect: ItemEffect, xParam: string, yParam: string): Point | null {
  if (effect.effect.type !== 'gpu-effect') return null
  const x = effect.effect.params[xParam]
  const y = effect.effect.params[yParam]
  return {
    x: typeof x === 'number' ? x : 0.5,
    y: typeof y === 'number' ? y : 0.5,
  }
}

function pointerToCanvasUv(
  event: Pick<PointerEvent<HTMLElement>, 'clientX' | 'clientY'>,
  coordParams: CoordinateParams,
): Point {
  const projectPoint = screenToCanvas(event.clientX, event.clientY, coordParams)
  return canvasPointToSpatialEffectUv(projectPoint, coordParams.projectSize)
}

export const SpatialEffectPointOverlayContainer = memo(function SpatialEffectPointOverlayContainer({
  containerRect,
  playerSize,
  projectSize,
  zoom,
}: SpatialEffectPointOverlayContainerProps) {
  const items = useItemsStore((s) => s.items)
  const isEditing = useSpatialEffectEditorStore((s) => s.isEditing)
  const editingItemId = useSpatialEffectEditorStore((s) => s.editingItemId)
  const editingEffectId = useSpatialEffectEditorStore((s) => s.editingEffectId)
  const stopEditing = useSpatialEffectEditorStore((s) => s.stopEditing)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)

  const editingItem = useMemo(() => {
    if (!isEditing || !editingItemId) return null
    return items.find((item) => item.id === editingItemId) ?? null
  }, [editingItemId, isEditing, items])
  const effect =
    editingItem && editingEffectId ? findSpatialEffect(editingItem, editingEffectId) : null
  const config =
    effect?.effect.type === 'gpu-effect'
      ? getSpatialPointEffectConfig(effect.effect.gpuEffectType)
      : null
  const coordParams = useMemo((): CoordinateParams | null => {
    if (!containerRect) return null
    return { containerRect, playerSize, projectSize, zoom }
  }, [containerRect, playerSize, projectSize, zoom])

  useEffect(() => {
    if (!isEditing || (editingItem && effect && config)) return
    if (editingItemId) clearPreviewForItems([editingItemId])
    stopEditing()
  }, [clearPreviewForItems, config, editingItem, editingItemId, effect, isEditing, stopEditing])

  useEffect(() => {
    if (!isEditing) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (editingItemId) clearPreviewForItems([editingItemId])
      stopEditing()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearPreviewForItems, editingItemId, isEditing, stopEditing])

  if (!coordParams || !editingItem || !effect || !config) return null

  return (
    <SpatialEffectPointOverlay
      coordParams={coordParams}
      playerSize={playerSize}
      item={editingItem}
      effect={effect}
      xParam={config.xParam}
      yParam={config.yParam}
    />
  )
})

const SpatialEffectPointOverlay = memo(function SpatialEffectPointOverlay({
  coordParams,
  playerSize,
  item,
  effect,
  xParam,
  yParam,
}: SpatialEffectPointOverlayProps) {
  const handleRef = useRef<HTMLButtonElement>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragEffectsRef = useRef<ItemEffect[] | null>(null)
  const pendingPointRef = useRef<Point | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)
  const previewEffect = useGizmoStore((s) =>
    s.preview?.[item.id]?.effects?.find((entry) => entry.id === effect.id),
  )
  const itemKeyframes = useKeyframesStore((s) => s.keyframesByItemId[item.id])
  const point = readPoint(previewEffect ?? effect, xParam, yParam)
  const currentEffects = useMemo(
    () =>
      (item.effects ?? []).map((entry) =>
        entry.id === effect.id && previewEffect ? previewEffect : entry,
      ),
    [effect.id, item.effects, previewEffect],
  )

  const updateHandle = useCallback((nextPoint: Point) => {
    if (!handleRef.current) return
    handleRef.current.style.left = `${nextPoint.x * 100}%`
    handleRef.current.style.top = `${nextPoint.y * 100}%`
  }, [])

  const applyPreview = useCallback(
    (nextPoint: Point) => {
      setEffectsPreviewNew({
        [item.id]: buildSpatialPointEffects(
          dragEffectsRef.current ?? currentEffects,
          effect.id,
          xParam,
          yParam,
          nextPoint,
        ),
      })
    },
    [currentEffects, effect.id, item.id, setEffectsPreviewNew, xParam, yParam],
  )

  const schedulePreview = useCallback(
    (nextPoint: Point) => {
      pendingPointRef.current = nextPoint
      if (previewFrameRef.current !== null) return
      previewFrameRef.current = requestAnimationFrame(() => {
        previewFrameRef.current = null
        const pendingPoint = pendingPointRef.current
        pendingPointRef.current = null
        if (pendingPoint) applyPreview(pendingPoint)
      })
    },
    [applyPreview],
  )

  const commit = useCallback(
    (nextPoint: Point) => {
      const updates = { [xParam]: nextPoint.x, [yParam]: nextPoint.y }
      const plan = planEffectGizmoCommit(
        item,
        effect,
        itemKeyframes,
        usePlaybackStore.getState().currentFrame,
        updates,
      )
      if (plan.autoKeyframeOperations.length > 0) {
        applyAutoKeyframeOperations(plan.autoKeyframeOperations)
      }
      const baseParamKeys = Object.keys(plan.baseParamUpdates)
      if (baseParamKeys.length > 0) {
        const rawPoint = readPoint(effect, xParam, yParam) ?? nextPoint
        const basePoint = {
          x: plan.baseParamUpdates[xParam] ?? rawPoint.x,
          y: plan.baseParamUpdates[yParam] ?? rawPoint.y,
        }
        setItemEffects([
          {
            itemId: item.id,
            effects: buildSpatialPointEffects(
              dragEffectsRef.current ?? currentEffects,
              effect.id,
              xParam,
              yParam,
              basePoint,
              [xParam, yParam],
            ),
          },
        ])
      }
      clearPreviewForItems([item.id])
    },
    [
      clearPreviewForItems,
      currentEffects,
      effect,
      item,
      itemKeyframes,
      xParam,
      yParam,
    ],
  )

  useEffect(() => {
    if (point && dragPointerIdRef.current === null) updateHandle(point)
  }, [point, updateHandle])

  useEffect(
    () => () => {
      if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current)
    },
    [],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      dragPointerIdRef.current = event.pointerId
      dragEffectsRef.current = currentEffects
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [currentEffects],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const nextPoint = pointerToCanvasUv(event, coordParams)
      updateHandle(nextPoint)
      schedulePreview(nextPoint)
    },
    [coordParams, schedulePreview, updateHandle],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (dragPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const nextPoint = pointerToCanvasUv(event, coordParams)
      dragPointerIdRef.current = null
      pendingPointRef.current = null
      if (previewFrameRef.current !== null) {
        cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
      updateHandle(nextPoint)
      commit(nextPoint)
      dragEffectsRef.current = null
    },
    [commit, coordParams, updateHandle],
  )

  const handlePointerCancel = useCallback(() => {
    dragPointerIdRef.current = null
    dragEffectsRef.current = null
    pendingPointRef.current = null
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    clearPreviewForItems([item.id])
    const originalPoint = readPoint(effect, xParam, yParam)
    if (originalPoint) updateHandle(originalPoint)
  }, [clearPreviewForItems, effect, item.id, updateHandle, xParam, yParam])

  if (!point) return null

  return (
    <div
      className="pointer-events-auto absolute z-50"
      data-testid="spatial-effect-point-overlay"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{ left: 0, top: 0, width: playerSize.width, height: playerSize.height }}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label="Move effect center"
        title="Drag to move the effect center"
        className="pointer-events-auto absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white bg-black/45 shadow-[0_0_0_1px_rgba(0,0,0,0.65)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <span className="pointer-events-none absolute left-1/2 top-1 h-4 -translate-x-1/2 border-l border-white" />
        <span className="pointer-events-none absolute left-1 top-1/2 w-4 -translate-y-1/2 border-t border-white" />
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </button>
    </div>
  )
})
