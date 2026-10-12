import { useState, useCallback, useRef, useEffect } from 'react'
import type { TimelineItem } from '@/types/timeline'
import { commitPreviewFrameToCurrentFrame } from '@/shared/state/playback'
import { useDragInteractionPreamble } from './use-drag-interaction-preamble'
import { useItemsStore } from '../stores/items-store'
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store'

import { trackPushItems } from '../stores/actions/item-actions'
import type { SnapTarget } from '../types/drag'
import { setActiveSnapTargetIfChanged } from '../utils/snap-target-state'
import { createRafCoalescedCallback } from '../utils/raf-coalesced-callback'

interface TrackPushState {
  isActive: boolean
  startX: number
  currentDelta: number
  /** Max frames the items can move left (negative direction clamp) */
  maxLeftFrames: number
}

/**
 * Hook for track push/pull — drag the left edge of a clip that has a gap
 * before it to move ALL items at or after that time position (across every
 * track) left or right.  The left clamp is the tightest gap across all
 * tracks so no overlaps are created.
 */
export function useTrackPush(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
) {
  const {
    pixelsToTime,
    fps,
    setDragState,
    setActiveSnapTarget,
    getMagneticSnapTargets,
    getSnapThresholdFrames,
    isSnapEnabled,
  } = useDragInteractionPreamble(item, timelineDuration)

  const [state, setState] = useState<TrackPushState>({
    isActive: false,
    startX: 0,
    currentDelta: 0,
    maxLeftFrames: 0,
  })
  const stateRef = useRef(state)
  stateRef.current = state

  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null)
  const magneticSnapTargetsRef = useRef<SnapTarget[]>([])

  const findSnapForFrame = useCallback(
    (targetFrame: number): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      if (!isSnapEnabled()) return { snappedFrame: targetFrame, snapTarget: null }
      const targets = magneticSnapTargetsRef.current
      let nearest: SnapTarget | null = null
      let minDist = getSnapThresholdFrames()
      for (const t of targets) {
        const d = Math.abs(targetFrame - t.frame)
        if (d < minDist) {
          nearest = t
          minDist = d
        }
      }
      return nearest
        ? { snappedFrame: nearest.frame, snapTarget: nearest }
        : { snappedFrame: targetFrame, snapTarget: null }
    },
    [getSnapThresholdFrames, isSnapEnabled],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!stateRef.current.isActive || trackLocked) return

      const deltaX = e.clientX - stateRef.current.startX
      const deltaTime = pixelsToTime(deltaX)
      let deltaFrames = Math.round(deltaTime * fps)

      // Clamp: can't push left beyond the tightest gap across all tracks
      deltaFrames = Math.max(deltaFrames, -stateRef.current.maxLeftFrames)

      // Snap the anchor item's new start edge
      const anchorFrom = item.from + deltaFrames
      const { snappedFrame, snapTarget } = findSnapForFrame(anchorFrom)
      if (snapTarget) {
        deltaFrames = snappedFrame - item.from
        deltaFrames = Math.max(deltaFrames, -stateRef.current.maxLeftFrames)
      }

      // Update preview store
      const previewStore = useTrackPushPreviewStore.getState()
      if (previewStore.delta !== deltaFrames) {
        previewStore.setDelta(deltaFrames)
      }

      // The delta is only read imperatively (mouseup commit) and by the
      // preview store above; keeping it in React state re-rendered the clip
      // on every pointer frame for nothing.
      stateRef.current.currentDelta = deltaFrames

      setActiveSnapTargetIfChanged({
        previousRef: prevSnapTargetRef,
        snapTarget,
        setActiveSnapTarget,
      })
    },
    [pixelsToTime, fps, trackLocked, findSnapForFrame, setActiveSnapTarget, item.from],
  )

  const handleMouseUp = useCallback(() => {
    if (!stateRef.current.isActive) return
    const delta = stateRef.current.currentDelta
    if (delta !== 0) {
      trackPushItems(item.id, delta)
    }
    useTrackPushPreviewStore.getState().clearPreview()
    setActiveSnapTarget(null)
    setDragState(null)
    prevSnapTargetRef.current = null
    magneticSnapTargetsRef.current = []
    setState({ isActive: false, startX: 0, currentDelta: 0, maxLeftFrames: 0 })
  }, [item.id, setActiveSnapTarget, setDragState])

  useEffect(() => {
    if (state.isActive) {
      // Coalesce the pointer stream to one preview update per painted frame.
      const coalescedMouseMove = createRafCoalescedCallback(handleMouseMove)
      const queueMouseMove = (event: MouseEvent) => coalescedMouseMove.queue(event)
      const handleCoalescedMouseUp = () => {
        coalescedMouseMove.flush()
        handleMouseUp()
      }

      window.addEventListener('mousemove', queueMouseMove)
      window.addEventListener('mouseup', handleCoalescedMouseUp)
      return () => {
        coalescedMouseMove.cancel()
        window.removeEventListener('mousemove', queueMouseMove)
        window.removeEventListener('mouseup', handleCoalescedMouseUp)
        useTrackPushPreviewStore.getState().clearPreview()
        magneticSnapTargetsRef.current = []
        setActiveSnapTarget(null)
        setDragState(null)
      }
    }
  }, [state.isActive, handleMouseMove, handleMouseUp, setActiveSnapTarget, setDragState])

  const handleTrackPushStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || trackLocked) return
      e.stopPropagation()
      e.preventDefault()
      commitPreviewFrameToCurrentFrame()

      const { items: allItems, itemsByTrackId } = useItemsStore.getState()
      const cutFrame = item.from

      // Collect ALL items at or after the anchor's position, across every track
      const shiftedIds = new Set<string>()
      for (const ti of allItems) {
        if (ti.from >= cutFrame) {
          shiftedIds.add(ti.id)
        }
      }

      // Compute the tightest gap across all tracks.
      // Per track, find the first shifted item and the last non-shifted item
      // before it — the gap between them constrains the max leftward push.
      let minGap = Infinity
      for (const trackId in itemsByTrackId) {
        const trackItems = itemsByTrackId[trackId]
        if (!trackItems) continue

        let firstShiftedFrom = Infinity
        let lastStaticEnd = 0
        for (const ti of trackItems) {
          if (shiftedIds.has(ti.id)) {
            if (ti.from < firstShiftedFrom) firstShiftedFrom = ti.from
          } else {
            const end = ti.from + ti.durationInFrames
            if (end > lastStaticEnd && ti.from < cutFrame) lastStaticEnd = end
          }
        }
        if (firstShiftedFrom < Infinity) {
          const gap = firstShiftedFrom - lastStaticEnd
          if (gap < minGap) minGap = gap
        }
      }
      if (!isFinite(minGap)) minGap = cutFrame

      magneticSnapTargetsRef.current = getMagneticSnapTargets().filter(
        (target) => !target.itemId || !shiftedIds.has(target.itemId),
      )
      useTrackPushPreviewStore.getState().setPreview({
        anchorItemId: item.id,
        trackId: item.trackId,
        shiftedItemIds: shiftedIds,
        delta: 0,
      })

      setDragState({
        isDragging: true,
        draggedItemIds: [],
        offset: { x: 0, y: 0 },
      })
      setActiveSnapTarget(null)

      setState({
        isActive: true,
        startX: e.clientX,
        currentDelta: 0,
        maxLeftFrames: Math.max(0, minGap),
      })
    },
    [
      item.id,
      item.trackId,
      item.from,
      trackLocked,
      setActiveSnapTarget,
      setDragState,
      getMagneticSnapTargets,
    ],
  )

  return {
    isTrackPushActive: state.isActive,
    handleTrackPushStart,
  }
}
