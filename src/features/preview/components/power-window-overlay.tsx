import { memo, useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { usePlaybackStore } from '@/shared/state/playback'
import { useGizmoStore } from '../stores/gizmo-store'
import { usePowerWindowEditorStore } from '../stores/power-window-editor-store'
import {
  applyAutoKeyframeOperations,
  setItemEffects,
  useItemsStore,
  useKeyframesStore,
} from '../deps/timeline-store'
import type { CoordinateParams, Point } from '../types/gizmo'
import { screenToCanvas } from '../utils/coordinate-transform'
import { planEffectGizmoCommit } from '../utils/effect-gizmo-keyframes'
import {
  buildPowerWindowEffects,
  derivePowerWindowDragParams,
  readPowerWindowParams,
  type PowerWindowDragState,
  type PowerWindowHandle,
  type PowerWindowParams,
} from './power-window-overlay-utils'

interface PowerWindowOverlayContainerProps {
  containerRect: DOMRect | null
  playerSize: { width: number; height: number }
  projectSize: { width: number; height: number }
  zoom: number
}

interface PowerWindowOverlayProps {
  coordParams: CoordinateParams
  playerSize: { width: number; height: number }
  item: TimelineItem
  effect: ItemEffect
}

const HANDLE_SIZE = 14
const POWER_WINDOW_NUMBER_KEYS = ['centerX', 'centerY', 'sizeX', 'sizeY', 'rotation'] as const

function findPowerWindowEffect(item: TimelineItem, effectId: string): ItemEffect | null {
  return (
    (item.effects ?? []).find(
      (entry) =>
        entry.id === effectId &&
        entry.enabled &&
        entry.effect.type === 'gpu-effect' &&
        entry.effect.gpuEffectType === 'gpu-power-window',
    ) ?? null
  )
}

function pointerToCanvasUv(
  event: Pick<PointerEvent<HTMLElement>, 'clientX' | 'clientY'>,
  coordParams: CoordinateParams,
): Point {
  const projectPoint = screenToCanvas(event.clientX, event.clientY, coordParams)
  return {
    x: projectPoint.x / coordParams.projectSize.width,
    y: projectPoint.y / coordParams.projectSize.height,
  }
}

export const PowerWindowOverlayContainer = memo(function PowerWindowOverlayContainer({
  containerRect,
  playerSize,
  projectSize,
  zoom,
}: PowerWindowOverlayContainerProps) {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const items = useItemsStore((s) => s.items)
  const isEditing = usePowerWindowEditorStore((s) => s.isEditing)
  const editingItemId = usePowerWindowEditorStore((s) => s.editingItemId)
  const editingEffectId = usePowerWindowEditorStore((s) => s.editingEffectId)
  const stopEditing = usePowerWindowEditorStore((s) => s.stopEditing)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)

  const editingItem = useMemo(() => {
    if (!isEditing || !editingItemId || !selectedItemIds.includes(editingItemId)) return null
    return items.find((item) => item.id === editingItemId) ?? null
  }, [editingItemId, isEditing, items, selectedItemIds])

  const effect =
    editingItem && editingEffectId !== null
      ? findPowerWindowEffect(editingItem, editingEffectId)
      : null
  const coordParams = useMemo((): CoordinateParams | null => {
    if (!containerRect) return null
    return { containerRect, playerSize, projectSize, zoom }
  }, [containerRect, playerSize, projectSize, zoom])
  useEffect(() => {
    if (!isEditing) return
    if (!editingItem || !effect) {
      if (editingItemId) clearPreviewForItems([editingItemId])
      stopEditing()
    }
  }, [clearPreviewForItems, editingItem, editingItemId, effect, isEditing, stopEditing])

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

  if (!coordParams || !editingItem || !effect) return null

  return (
    <PowerWindowOverlay
      coordParams={coordParams}
      effect={effect}
      item={editingItem}
      playerSize={playerSize}
    />
  )
})

const PowerWindowOverlay = memo(function PowerWindowOverlay({
  coordParams,
  effect,
  item,
  playerSize,
}: PowerWindowOverlayProps) {
  const dragRef = useRef<PowerWindowDragState | null>(null)
  const dragEffectsRef = useRef<ItemEffect[] | null>(null)
  const setEffectsPreviewNew = useGizmoStore((s) => s.setEffectsPreviewNew)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)
  const previewEffect = useGizmoStore((s) =>
    s.preview?.[item.id]?.effects?.find((entry) => entry.id === effect.id),
  )
  const itemKeyframes = useKeyframesStore((s) => s.keyframesByItemId[item.id])

  const params = readPowerWindowParams(previewEffect ?? effect)
  const currentEffects = useMemo(
    () =>
      (item.effects ?? []).map((entry) =>
        entry.id === effect.id && previewEffect ? previewEffect : entry,
      ),
    [effect.id, item.effects, previewEffect],
  )
  const canvasAspectRatio =
    coordParams.projectSize.width / Math.max(coordParams.projectSize.height, 1)

  const applyPreview = useCallback(
    (nextParams: PowerWindowParams) => {
      setEffectsPreviewNew({
        [item.id]: buildPowerWindowEffects(
          dragEffectsRef.current ?? currentEffects,
          effect.id,
          nextParams,
        ),
      })
    },
    [currentEffects, effect.id, item.id, setEffectsPreviewNew],
  )

  const commit = useCallback(
    (nextParams: PowerWindowParams, startParams: PowerWindowParams) => {
      const changedUpdates: Record<string, number> = {}
      for (const key of POWER_WINDOW_NUMBER_KEYS) {
        if (nextParams[key] !== startParams[key]) changedUpdates[key] = nextParams[key]
      }
      const plan = planEffectGizmoCommit(
        item,
        effect,
        itemKeyframes,
        usePlaybackStore.getState().currentFrame,
        changedUpdates,
      )
      if (plan.autoKeyframeOperations.length > 0) {
        applyAutoKeyframeOperations(plan.autoKeyframeOperations)
      }
      if (Object.keys(plan.baseParamUpdates).length > 0) {
        const rawParams = readPowerWindowParams(effect) ?? startParams
        const baseParams: PowerWindowParams = { ...rawParams, ...plan.baseParamUpdates }
        setItemEffects([
          {
            itemId: item.id,
            effects: buildPowerWindowEffects(
              dragEffectsRef.current ?? currentEffects,
              effect.id,
              baseParams,
              POWER_WINDOW_NUMBER_KEYS,
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
    ],
  )

  const handlePointerDown = useCallback(
    (handle: PowerWindowHandle, event: PointerEvent<HTMLElement>) => {
      if (!params) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = {
        handle,
        startParams: params,
        startUv: pointerToCanvasUv(event, coordParams),
      }
      dragEffectsRef.current = currentEffects
    },
    [coordParams, currentEffects, params],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || event.buttons !== 1) return
      event.preventDefault()
      event.stopPropagation()
      applyPreview(
        derivePowerWindowDragParams(drag, pointerToCanvasUv(event, coordParams), {
          canvasAspectRatio,
          snapRotation: event.shiftKey,
        }),
      )
    },
    [applyPreview, canvasAspectRatio, coordParams],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag) return
      event.preventDefault()
      event.stopPropagation()
      const nextParams = derivePowerWindowDragParams(drag, pointerToCanvasUv(event, coordParams), {
        canvasAspectRatio,
        snapRotation: event.shiftKey,
      })
      dragRef.current = null
      commit(nextParams, drag.startParams)
      dragEffectsRef.current = null
    },
    [canvasAspectRatio, commit, coordParams],
  )

  if (!params) return null

  const handleStyle = {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  }
  const shapeBorderRadius = params.shape === 'rectangle' ? '2px' : '50%'

  return (
    <div
      className="pointer-events-auto absolute z-50"
      data-testid="power-window-overlay"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{
        left: 0,
        top: 0,
        width: playerSize.width,
        height: playerSize.height,
      }}
    >
      <div
        className="absolute border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
        style={{
          left: `${params.centerX * 100}%`,
          top: `${params.centerY * 100}%`,
          width: `${params.sizeX * 100}%`,
          height: `${params.sizeY * 100}%`,
          borderRadius: shapeBorderRadius,
          transform: `translate(-50%, -50%) rotate(${params.rotation}deg)`,
        }}
      >
        <button
          type="button"
          aria-label="Move power window"
          className="pointer-events-auto absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-black/70 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          onPointerDown={(event) => handlePointerDown('center', event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {(
          [
            ['east', 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
            ['west', 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
            ['north', 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize'],
            ['south', 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize'],
          ] as const
        ).map(([handle, className]) => (
          <button
            key={handle}
            type="button"
            aria-label={`Resize power window ${handle}`}
            className={`pointer-events-auto absolute rounded-full border border-black/70 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${className}`}
            style={handleStyle}
            onPointerDown={(event) => handlePointerDown(handle, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        ))}
        <div
          className="pointer-events-none absolute -top-[22px] left-1/2 h-[22px] border-l border-dashed border-white/90 shadow-[1px_0_0_rgba(0,0,0,0.65)]"
          aria-hidden="true"
        />
        <button
          type="button"
          aria-label="Rotate power window"
          title="Rotate power window · Hold Shift to snap to 15°"
          className="pointer-events-auto absolute -top-7 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border border-black/70 bg-white shadow-sm active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          onPointerDown={(event) => handlePointerDown('rotation', event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
    </div>
  )
})
