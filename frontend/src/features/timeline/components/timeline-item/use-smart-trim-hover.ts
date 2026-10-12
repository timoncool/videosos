import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useItemsStore } from '../../stores/items-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useRollHoverStore } from '../../stores/roll-hover-store'
import {
  resolveSmartBodyIntent,
  resolveSmartTrimIntent,
  SMART_TRIM_EDGE_ZONE_PX,
  SMART_TRIM_RETENTION_PX,
  SMART_TRIM_ROLL_ZONE_PX,
  smartTrimIntentToHandle,
  type SmartBodyIntent,
  type SmartTrimIntent,
} from '../../utils/smart-trim-zones'
import { hasTransitionBridgeAtHandle } from '../../utils/transition-edit-guards'
import { findHandleNeighborWithTransitions } from '../../utils/transition-linked-neighbors'
import { getTimelineClipLabelRowHeightPx } from './hover-layout'

const EDGE_HOVER_ZONE = SMART_TRIM_EDGE_ZONE_PX

interface UseSmartTrimHoverParams {
  item: TimelineItemType
  trackLocked: boolean
  activeTool: string
  activeToolRef: RefObject<string>
  isAnyDragActiveRef: MutableRefObject<boolean>
}

export interface SmartTrimHoverHandle {
  hoveredEdge: 'start' | 'end' | null
  smartTrimIntent: SmartTrimIntent
  smartBodyIntent: SmartBodyIntent
  smartTrimIntentRef: RefObject<SmartTrimIntent>
  handleMouseMove: (e: React.MouseEvent) => void
  handleMouseLeave: () => void
}

export function useSmartTrimHover({
  item,
  trackLocked,
  activeTool,
  activeToolRef,
  isAnyDragActiveRef,
}: UseSmartTrimHoverParams): SmartTrimHoverHandle {
  const [hoveredEdge, setHoveredEdge] = useState<'start' | 'end' | null>(null)
  const [smartTrimIntent, setSmartTrimIntent] = useState<SmartTrimIntent>(null)
  const [smartBodyIntent, setSmartBodyIntent] = useState<SmartBodyIntent>(null)

  const hoveredEdgeRef = useRef(hoveredEdge)
  const smartTrimIntentRef = useRef(smartTrimIntent)
  const smartBodyIntentRef = useRef(smartBodyIntent)

  const syncHoveredEdge = useCallback((nextHoveredEdge: 'start' | 'end' | null) => {
    hoveredEdgeRef.current = nextHoveredEdge
    setHoveredEdge(nextHoveredEdge)
  }, [])

  const syncSmartTrimIntent = useCallback((nextIntent: SmartTrimIntent) => {
    smartTrimIntentRef.current = nextIntent
    setSmartTrimIntent(nextIntent)
  }, [])

  const syncSmartBodyIntent = useCallback((nextIntent: SmartBodyIntent) => {
    smartBodyIntentRef.current = nextIntent
    setSmartBodyIntent(nextIntent)
  }, [])

  // Clear stale hover state when the active tool changes (mouse may be stationary)
  useEffect(() => {
    syncHoveredEdge(null)
    syncSmartTrimIntent(null)
    syncSmartBodyIntent(null)
    useRollHoverStore.getState().clearRollHover(item.id)
  }, [activeTool, item.id, syncHoveredEdge, syncSmartBodyIntent, syncSmartTrimIntent])

  // Neighbor/bridge lookups are O(items + transitions); they only change when
  // the item, its track items or the transitions change, so cache them across
  // pointer moves instead of rescanning on every hover event.
  const trimNeighborInfoRef = useRef<{
    item: TimelineItemType
    items: TimelineItemType[]
    transitions: Transition[]
    hasLeftNeighbor: boolean
    hasRightNeighbor: boolean
    hasStartBridge: boolean
    hasEndBridge: boolean
  } | null>(null)

  const getTrimNeighborInfo = useCallback(
    (items: TimelineItemType[], transitions: Transition[]) => {
      const cached = trimNeighborInfoRef.current
      if (
        cached &&
        cached.item === item &&
        cached.items === items &&
        cached.transitions === transitions
      ) {
        return cached
      }
      const info = {
        item,
        items,
        transitions,
        hasLeftNeighbor: !!findHandleNeighborWithTransitions(item, 'start', items, transitions),
        hasRightNeighbor: !!findHandleNeighborWithTransitions(item, 'end', items, transitions),
        hasStartBridge: hasTransitionBridgeAtHandle(transitions, item.id, 'start'),
        hasEndBridge: hasTransitionBridgeAtHandle(transitions, item.id, 'end'),
      }
      trimNeighborInfoRef.current = info
      return info
    },
    [item],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (trackLocked || activeToolRef.current === 'razor' || isAnyDragActiveRef.current) {
        if (hoveredEdgeRef.current !== null) syncHoveredEdge(null)
        if (smartTrimIntentRef.current !== null) syncSmartTrimIntent(null)
        if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)
        return
      }

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const itemWidth = rect.width

      if (activeToolRef.current === 'trim-edit' || activeToolRef.current === 'select') {
        const items = useItemsStore.getState().items
        const transitions = useTransitionsStore.getState().transitions
        const { hasLeftNeighbor, hasRightNeighbor, hasStartBridge, hasEndBridge } =
          getTrimNeighborInfo(items, transitions)
        const nextIntent = resolveSmartTrimIntent({
          x,
          width: itemWidth,
          hasLeftNeighbor,
          hasRightNeighbor,
          hasStartBridge,
          hasEndBridge,
          preferRippleOuterEdges: activeToolRef.current === 'trim-edit',
          currentIntent: smartTrimIntentRef.current,
          edgeZonePx: SMART_TRIM_EDGE_ZONE_PX,
          rollZonePx: SMART_TRIM_ROLL_ZONE_PX,
          retentionPx: SMART_TRIM_RETENTION_PX,
        })
        const nextHoveredEdge = smartTrimIntentToHandle(nextIntent)

        if (smartTrimIntentRef.current !== nextIntent) {
          const prevIntent = smartTrimIntentRef.current
          syncSmartTrimIntent(nextIntent)
          if (nextIntent === 'roll-start') {
            const neighbor = findHandleNeighborWithTransitions(item, 'start', items, transitions)
            if (neighbor) useRollHoverStore.getState().setRollHover(item.id, neighbor.id, 'end')
          } else if (nextIntent === 'roll-end') {
            const neighbor = findHandleNeighborWithTransitions(item, 'end', items, transitions)
            if (neighbor) useRollHoverStore.getState().setRollHover(item.id, neighbor.id, 'start')
          } else if (prevIntent === 'roll-start' || prevIntent === 'roll-end') {
            useRollHoverStore.getState().clearRollHover(item.id)
          }
        }
        if (hoveredEdgeRef.current !== nextHoveredEdge) {
          syncHoveredEdge(nextHoveredEdge)
        }

        if (activeToolRef.current === 'select') {
          if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)
          return
        }

        if (nextIntent) {
          if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)
          return
        }

        const nextBodyIntent = resolveSmartBodyIntent({
          y,
          height: rect.height,
          labelRowHeight: getTimelineClipLabelRowHeightPx(e.currentTarget),
          isMediaItem:
            item.type === 'video' || item.type === 'audio' || item.type === 'composition',
          currentIntent: smartBodyIntentRef.current,
        })
        if (smartBodyIntentRef.current !== nextBodyIntent) {
          syncSmartBodyIntent(nextBodyIntent)
        }
        return
      }

      if (smartTrimIntentRef.current !== null) syncSmartTrimIntent(null)
      if (smartBodyIntentRef.current !== null) syncSmartBodyIntent(null)

      if (activeToolRef.current === 'rate-stretch') {
        if (hoveredEdgeRef.current !== null) syncHoveredEdge(null)
        return
      }

      if (x <= EDGE_HOVER_ZONE) {
        if (hoveredEdgeRef.current !== 'start') syncHoveredEdge('start')
      } else if (x >= itemWidth - EDGE_HOVER_ZONE) {
        if (hoveredEdgeRef.current !== 'end') syncHoveredEdge('end')
      } else {
        if (hoveredEdgeRef.current !== null) syncHoveredEdge(null)
      }
    },
    [
      activeToolRef,
      isAnyDragActiveRef,
      getTrimNeighborInfo,
      item,
      syncHoveredEdge,
      syncSmartBodyIntent,
      syncSmartTrimIntent,
      trackLocked,
    ],
  )

  const handleMouseLeave = useCallback(() => {
    syncHoveredEdge(null)
    syncSmartTrimIntent(null)
    syncSmartBodyIntent(null)
    useRollHoverStore.getState().clearRollHover(item.id)
  }, [item.id, syncHoveredEdge, syncSmartBodyIntent, syncSmartTrimIntent])

  return {
    hoveredEdge,
    smartTrimIntent,
    smartBodyIntent,
    smartTrimIntentRef,
    handleMouseMove,
    handleMouseLeave,
  }
}
