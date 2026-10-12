import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MutableRefObject, RefObject } from 'react'
import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { getTrackItemRelations } from '../../stores/items-store-indexes'
import { useSelectionStore } from '@/shared/state/selection'
import {
  dragOffsetRef,
  dragPreviewOffsetByItemRef,
  isLargeAltDragCanvasItem,
} from '../../hooks/use-timeline-drag'
import {
  getTimelineItemDragParticipation,
  shouldDimTimelineItemForDrag,
  type TimelineItemGestureMode,
} from './drag-visual-mode'

type JoinDragState = { left: boolean; right: boolean }

type DragVisualItem = Pick<TimelineItem, 'id' | 'from' | 'durationInFrames' | 'trackId'>

interface UseDragVisualStateParams {
  item: DragVisualItem
  gestureMode: TimelineItemGestureMode
  isDragging: boolean
  transformRef: RefObject<HTMLDivElement | null>
  ghostRef: RefObject<HTMLDivElement | null>
}

interface UseDragVisualStateResult {
  dragAffectsJoin: JoinDragState
  isAnyDragActiveRef: MutableRefObject<boolean>
  dragWasActiveRef: MutableRefObject<boolean>
  isPartOfMultiDrag: boolean
  isAltDrag: boolean
  isPartOfDrag: boolean
  isBeingDragged: boolean
  shouldDimForDrag: boolean
}

interface ActiveDragVisual {
  update: () => void
}

function setStyleIfChanged<K extends keyof CSSStyleDeclaration>(
  style: CSSStyleDeclaration,
  property: K,
  value: CSSStyleDeclaration[K],
) {
  if (style[property] !== value) {
    style[property] = value
  }
}

const activeDragVisuals = new Set<ActiveDragVisual>()
let sharedDragVisualRaf: number | null = null

function runSharedDragVisualFrame() {
  sharedDragVisualRaf = null
  for (const visual of activeDragVisuals) {
    visual.update()
  }
  if (activeDragVisuals.size > 0) {
    sharedDragVisualRaf = requestAnimationFrame(runSharedDragVisualFrame)
  }
}

function registerDragVisual(visual: ActiveDragVisual) {
  activeDragVisuals.add(visual)
  if (sharedDragVisualRaf === null) {
    sharedDragVisualRaf = requestAnimationFrame(runSharedDragVisualFrame)
  }
}

function unregisterDragVisual(visual: ActiveDragVisual) {
  activeDragVisuals.delete(visual)
  if (activeDragVisuals.size === 0 && sharedDragVisualRaf !== null) {
    cancelAnimationFrame(sharedDragVisualRaf)
    sharedDragVisualRaf = null
  }
}

export function useDragVisualState({
  item,
  gestureMode,
  isDragging,
  transformRef,
  ghostRef,
}: UseDragVisualStateParams): UseDragVisualStateResult {
  const wasDraggingRef = useRef(false)
  const isAnyDragActiveRef = useRef(false)
  const dragWasActiveRef = useRef(false)
  const dragWasActiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const neighboringJoinIds = useItemsStore(
    useShallow(
      (state) => getTrackItemRelations(state.itemsByTrackId[item.trackId], item).dragNeighborIds,
    ),
  )

  const dragParticipation = useSelectionStore((state) =>
    getTimelineItemDragParticipation({
      itemId: item.id,
      dragState: state.dragState,
      gestureMode,
    }),
  )
  const dragAffectsJoin = useSelectionStore(
    useShallow((state) => {
      if (!state.dragState?.isDragging) {
        return { left: false, right: false }
      }

      const draggedItemIds =
        state.dragState.draggedItemIdSet ?? new Set(state.dragState.draggedItemIds)
      const itemDragged = draggedItemIds.has(item.id)

      return {
        left:
          itemDragged ||
          !!(neighboringJoinIds.leftId && draggedItemIds.has(neighboringJoinIds.leftId)),
        right:
          itemDragged ||
          !!(neighboringJoinIds.rightId && draggedItemIds.has(neighboringJoinIds.rightId)),
      }
    }),
  )
  const dragParticipationRef = useRef(dragParticipation)
  dragParticipationRef.current = dragParticipation

  useEffect(() => {
    const updateDragActiveRefs = (isDragActive: boolean) => {
      const previousWasActive = isAnyDragActiveRef.current
      isAnyDragActiveRef.current = isDragActive

      if (previousWasActive && !isDragActive) {
        dragWasActiveRef.current = true
        if (dragWasActiveTimeoutRef.current) {
          clearTimeout(dragWasActiveTimeoutRef.current)
        }
        dragWasActiveTimeoutRef.current = setTimeout(() => {
          dragWasActiveRef.current = false
          dragWasActiveTimeoutRef.current = null
        }, 100)
      }
    }

    updateDragActiveRefs(!!useSelectionStore.getState().dragState?.isDragging)
    return useSelectionStore.subscribe((state, previousState) => {
      const isDragActive = !!state.dragState?.isDragging
      if (isDragActive === !!previousState.dragState?.isDragging) return
      updateDragActiveRefs(isDragActive)
    })
  }, [])

  useEffect(() => {
    const cleanupDragStyles = () => {
      if (transformRef.current) {
        const style = transformRef.current.style
        setStyleIfChanged(style, 'transition', 'none')
        setStyleIfChanged(style, 'transform', '')
        setStyleIfChanged(style, 'pointerEvents', '')
        setStyleIfChanged(style, 'zIndex', '')
      }

      if (ghostRef.current) {
        setStyleIfChanged(ghostRef.current.style, 'display', 'none')
      }
    }

    const updateTransform = () => {
      if (!transformRef.current) return

      const participation = dragParticipationRef.current
      const isPartOfDrag = participation > 0 && !isDragging
      const isAltPreviewDrag = participation === 2
      const shouldUpdatePreview = isPartOfDrag || isAltPreviewDrag

      if (!shouldUpdatePreview) {
        cleanupDragStyles()
        return
      }

      if (isAltPreviewDrag && isLargeAltDragCanvasItem(item.id)) {
        const style = transformRef.current.style
        setStyleIfChanged(style, 'transform', '')
        setStyleIfChanged(style, 'transition', 'none')
        setStyleIfChanged(style, 'pointerEvents', 'none')
        if (ghostRef.current) {
          setStyleIfChanged(ghostRef.current.style, 'display', 'none')
        }
        return
      }

      const offset = dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current

      if (isAltPreviewDrag) {
        const style = transformRef.current.style
        setStyleIfChanged(style, 'transform', '')
        setStyleIfChanged(style, 'transition', 'none')
        setStyleIfChanged(style, 'pointerEvents', 'none')

        if (ghostRef.current) {
          const ghostStyle = ghostRef.current.style
          setStyleIfChanged(ghostStyle, 'transform', `translate(${offset.x}px, ${offset.y}px)`)
          setStyleIfChanged(ghostStyle, 'display', 'block')
        }
      } else {
        const style = transformRef.current.style
        setStyleIfChanged(style, 'transform', `translate(${offset.x}px, ${offset.y}px)`)
        setStyleIfChanged(style, 'transition', 'none')
        setStyleIfChanged(style, 'pointerEvents', 'none')
        setStyleIfChanged(style, 'zIndex', '50')

        if (ghostRef.current) {
          setStyleIfChanged(ghostRef.current.style, 'display', 'none')
        }
      }
    }

    if (dragParticipation > 0 && (!isDragging || dragParticipation === 2)) {
      if (dragParticipation === 2 && isLargeAltDragCanvasItem(item.id)) {
        updateTransform()
        return cleanupDragStyles
      }
      const visual: ActiveDragVisual = { update: updateTransform }
      registerDragVisual(visual)
      return () => {
        unregisterDragVisual(visual)
        cleanupDragStyles()
      }
    }

    cleanupDragStyles()
    return cleanupDragStyles
  }, [dragParticipation, ghostRef, isDragging, item.id, transformRef])

  useEffect(() => {
    const transform = transformRef.current
    if (wasDraggingRef.current && !isDragging && transform) {
      transform.style.transition = 'none'
      requestAnimationFrame(() => {
        transform.style.transition = ''
      })
    }

    wasDraggingRef.current = isDragging
  }, [isDragging, transformRef])

  useEffect(() => {
    return () => {
      if (dragWasActiveTimeoutRef.current) {
        clearTimeout(dragWasActiveTimeoutRef.current)
      }
    }
  }, [])

  const isPartOfMultiDrag = dragParticipation > 0
  const isAltDrag = dragParticipation === 2
  const isPartOfDrag = isPartOfMultiDrag && !isDragging
  const isBeingDragged = isDragging || isPartOfDrag

  return {
    dragAffectsJoin,
    isAnyDragActiveRef,
    dragWasActiveRef,
    isPartOfMultiDrag,
    isAltDrag,
    isPartOfDrag,
    isBeingDragged,
    shouldDimForDrag: shouldDimTimelineItemForDrag({
      isBeingDragged,
      isAltDrag,
      gestureMode,
    }),
  }
}
