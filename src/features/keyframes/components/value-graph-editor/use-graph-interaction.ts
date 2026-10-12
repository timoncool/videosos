/**
 * Graph interaction hook.
 * Handles pointer events, dragging, zoom, and pan for the value graph editor.
 * Uses pointer capture for reliable dragging even outside SVG bounds.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useGraphSnapping } from './use-graph-snapping'
import { useGraphViewport } from './use-graph-viewport'
import { useGraphWheel } from './use-graph-wheel'
import { useMarquee } from './use-marquee'
import type { GraphBezierHandle, GraphDragState, GraphKeyframePoint } from './types'
import { PROPERTY_VALUE_RANGES } from './types'
import type { BezierControlPoints } from '@/types/keyframe'
import { getBezierPresetForEasing } from '@/features/keyframes/utils/easing-presets'
import { updateBezierFromHandle } from './bezier-utils'
import {
  arePreviewValuesEqual,
  DRAG_THRESHOLD,
  type AdjacentSegmentInfo,
  type BezierDragStartState,
  type DragStartState,
  type UseGraphInteractionOptions,
  type UseGraphInteractionReturn,
} from './graph-interaction-types'

/**
 * Hook for managing graph interactions with proper pointer capture.
 */
export function useGraphInteraction({
  viewport,
  padding,
  points,
  selectedKeyframeIds,
  maxFrame,
  minValue: clampMinValue,
  maxValue: clampMaxValue,
  onViewportChange,
  onSelectionChange,
  onBackgroundClick,
  onKeyframeMove,
  onDuplicateKeyframes,
  constrainFrameDelta,
  onBezierHandleMove,
  onDragStart,
  onDragEnd,
  snapEnabled = false,
  snapFrameTargets = [],
  snapValueTargets = [],
  blockedFrameRanges = [],
  disabled = false,
}: UseGraphInteractionOptions): UseGraphInteractionReturn {
  const [dragState, setDragState] = useState<GraphDragState | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [previewValues, setPreviewValues] = useState<Record<
    string,
    { frame: number; value: number }
  > | null>(null)
  const [draggingHandle, setDraggingHandle] = useState<{
    keyframeId: string
    type: 'in' | 'out'
  } | null>(null)
  const [previewBezierConfigs, setPreviewBezierConfigs] = useState<Record<
    string,
    BezierControlPoints
  > | null>(null)
  const [constraintAxis, setConstraintAxis] = useState<'x' | 'y' | null>(null)

  // Refs for stable values during drag
  const dragStartRef = useRef<DragStartState | null>(null)
  const bezierDragStartRef = useRef<BezierDragStartState | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pointsRef = useRef(points)
  useEffect(() => {
    pointsRef.current = points
  }, [points])
  const previewValuesRef = useRef<Record<string, { frame: number; value: number }> | null>(null)
  useEffect(() => {
    previewValuesRef.current = previewValues
  }, [previewValues])
  const previewBezierConfigsRef = useRef<Record<string, BezierControlPoints> | null>(null)
  useEffect(() => {
    previewBezierConfigsRef.current = previewBezierConfigs
  }, [previewBezierConfigs])

  // Ref for latest callbacks to avoid stale closures
  const callbacksRef = useRef({
    onKeyframeMove,
    onDuplicateKeyframes,
    onBezierHandleMove,
    onSelectionChange,
    onViewportChange,
    onBackgroundClick,
    onDragStart,
    onDragEnd,
  })
  useEffect(() => {
    callbacksRef.current = {
      onKeyframeMove,
      onDuplicateKeyframes,
      onBezierHandleMove,
      onSelectionChange,
      onViewportChange,
      onBackgroundClick,
      onDragStart,
      onDragEnd,
    }
  }, [
    onKeyframeMove,
    onDuplicateKeyframes,
    onBezierHandleMove,
    onSelectionChange,
    onViewportChange,
    onBackgroundClick,
    onDragStart,
    onDragEnd,
  ])

  // Track whether we've called onDragStart for the current drag operation
  const dragStartCalledRef = useRef(false)

  // Timestamp of last keyframe/handle interaction (used to ignore click events
  // that fire on the SVG after pointer capture redirects them away from the original target)
  const lastInteractionTimeRef = useRef(0)

  const {
    graphDimensions,
    clampViewportToBounds,
    ensureKeyframesRemainVisible,
    screenToGraph,
    zoomIn,
    zoomOut,
    fitToContent,
  } = useGraphViewport({
    viewport,
    padding,
    points,
    selectedKeyframeIds,
    maxFrame,
    minValue: clampMinValue,
    maxValue: clampMaxValue,
    onViewportChange,
  })

  const { marqueeRect, marqueeStateRef, marqueeJustEndedRef, handleBackgroundPointerDown } =
    useMarquee({
      disabled,
      viewport,
      selectedKeyframeIds,
      pointsRef,
      svgRef,
      dragStartRef,
      bezierDragStartRef,
      onSelectionChange,
    })

  const { snapToTargets, snapThresholds, clampToAvoidBlockedRanges } = useGraphSnapping({
    snapEnabled,
    graphDimensions,
    blockedFrameRanges,
  })

  // Handle keyframe pointer down (start potential drag)
  const handleKeyframePointerDown = useCallback(
    (point: GraphKeyframePoint, event: React.PointerEvent) => {
      if (disabled) return

      event.preventDefault()
      event.stopPropagation()
      lastInteractionTimeRef.current = Date.now()

      // Capture pointer on the SVG element (not the keyframe itself)
      const svg = event.currentTarget.closest('svg')
      if (svg) {
        svg.setPointerCapture(event.pointerId)
        svgRef.current = svg as SVGSVGElement
      }

      // If not already selected, select it (clear others unless shift)
      const selectionForDrag = selectedKeyframeIds.has(point.keyframe.id)
        ? new Set(selectedKeyframeIds)
        : event.shiftKey
          ? new Set([...selectedKeyframeIds, point.keyframe.id])
          : new Set([point.keyframe.id])
      if (!selectedKeyframeIds.has(point.keyframe.id)) {
        callbacksRef.current.onSelectionChange?.(selectionForDrag)
      }

      const draggedPoints = points.filter((candidate) =>
        selectionForDrag.has(candidate.keyframe.id),
      )
      const pointsForDrag = draggedPoints.length > 1 ? draggedPoints : [point]
      const initialKeyframeStates = new Map(
        pointsForDrag.map((dragPoint) => [
          dragPoint.keyframe.id,
          (() => {
            const range = PROPERTY_VALUE_RANGES[dragPoint.property]
            return {
              itemId: dragPoint.itemId,
              property: dragPoint.property,
              frame: dragPoint.keyframe.frame,
              value: dragPoint.keyframe.value,
              minValue: range?.min ?? Number.NEGATIVE_INFINITY,
              maxValue: range?.max ?? Number.POSITIVE_INFINITY,
            }
          })(),
        ]),
      )

      // Store initial state in ref (with cached bounding rect!)
      dragStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
        boundingRect: svg?.getBoundingClientRect() || new DOMRect(),
        pointerId: event.pointerId,
        point,
        initialKeyframeStates,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
      }

      setDragState({
        type: 'keyframe',
        keyframeId: point.keyframe.id,
        draggedKeyframeIds: pointsForDrag.map((dragPoint) => dragPoint.keyframe.id),
        itemId: point.itemId,
        property: point.property,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
      })
    },
    [disabled, onDuplicateKeyframes, points, selectedKeyframeIds],
  )

  // Handle keyframe click (selection only - called when drag threshold not met)
  const handleKeyframeClick = useCallback(
    (point: GraphKeyframePoint, event: React.MouseEvent) => {
      if (disabled) return

      let newSelection: Set<string>
      if (event.shiftKey) {
        // Toggle selection
        newSelection = new Set(selectedKeyframeIds)
        if (newSelection.has(point.keyframe.id)) {
          newSelection.delete(point.keyframe.id)
        } else {
          newSelection.add(point.keyframe.id)
        }
      } else if (event.ctrlKey || event.metaKey) {
        // Add to selection
        newSelection = new Set([...selectedKeyframeIds, point.keyframe.id])
      } else {
        // Single select
        newSelection = new Set([point.keyframe.id])
      }

      callbacksRef.current.onSelectionChange?.(newSelection)
    },
    [disabled, selectedKeyframeIds],
  )

  // Handle bezier handle pointer down
  const handleBezierPointerDown = useCallback(
    (handle: GraphBezierHandle, event: React.PointerEvent) => {
      if (disabled) return

      event.preventDefault()
      event.stopPropagation()
      lastInteractionTimeRef.current = Date.now()

      const point = points.find((p) => p.keyframe.id === handle.keyframeId)
      if (!point) return

      const bezier =
        point.keyframe.easingConfig?.bezier ?? getBezierPresetForEasing(point.keyframe.easing)
      if (!bezier) return

      // Find start and end points for this segment
      const sortedPoints = [...points].sort((a, b) => a.keyframe.frame - b.keyframe.frame)
      const pointIndex = sortedPoints.findIndex((p) => p.keyframe.id === handle.keyframeId)
      if (pointIndex === -1 || pointIndex >= sortedPoints.length - 1) return

      const startPoint = sortedPoints[pointIndex]
      const endPoint = sortedPoints[pointIndex + 1]

      // Capture pointer on the SVG element
      const svg = event.currentTarget.closest('svg')
      if (svg) {
        svg.setPointerCapture(event.pointerId)
        svgRef.current = svg as SVGSVGElement
      }

      // Determine mid-point and adjacent segment for tangent mirroring
      let adjacent: AdjacentSegmentInfo | null = null
      let midPoint: { x: number; y: number }

      if (handle.type === 'out') {
        // Anchor (mid-point) is startPoint; adjacent is the previous segment ending at startPoint
        midPoint = { x: startPoint!.x, y: startPoint!.y }
        const prevPoint = pointIndex > 0 ? sortedPoints[pointIndex - 1] : undefined
        if (prevPoint) {
          const adjBezier =
            prevPoint.keyframe.easingConfig?.bezier ??
            getBezierPresetForEasing(prevPoint.keyframe.easing)
          if (adjBezier) {
            // Opposite handle is the 'in' handle of prev segment (x2, y2), anchored at startPoint
            const segW = startPoint!.x - prevPoint.x
            const segH = startPoint!.y - prevPoint.y
            const oppX = prevPoint.x + adjBezier.x2 * segW
            const oppY = prevPoint.y + adjBezier.y2 * segH
            const dx = oppX - midPoint.x
            const dy = oppY - midPoint.y
            adjacent = {
              keyframeId: prevPoint.keyframe.id,
              itemId: prevPoint.itemId,
              property: prevPoint.property,
              handleType: 'in',
              startPoint: prevPoint,
              endPoint: startPoint!,
              initialBezier: { ...adjBezier },
              initialLength: Math.hypot(dx, dy),
            }
          }
        }
      } else {
        // handle.type === 'in': anchor (mid-point) is endPoint; adjacent is the next segment starting at endPoint
        midPoint = { x: endPoint!.x, y: endPoint!.y }
        const nextNextPoint =
          pointIndex + 2 < sortedPoints.length ? sortedPoints[pointIndex + 2] : undefined
        if (nextNextPoint) {
          const adjBezier =
            endPoint!.keyframe.easingConfig?.bezier ??
            getBezierPresetForEasing(endPoint!.keyframe.easing)
          if (adjBezier) {
            // Opposite handle is the 'out' handle of next segment (x1, y1), anchored at endPoint
            const segW = nextNextPoint.x - endPoint!.x
            const segH = nextNextPoint.y - endPoint!.y
            const oppX = endPoint!.x + adjBezier.x1 * segW
            const oppY = endPoint!.y + adjBezier.y1 * segH
            const dx = oppX - midPoint.x
            const dy = oppY - midPoint.y
            adjacent = {
              keyframeId: endPoint!.keyframe.id,
              itemId: endPoint!.itemId,
              property: endPoint!.property,
              handleType: 'out',
              startPoint: endPoint!,
              endPoint: nextNextPoint,
              initialBezier: { ...adjBezier },
              initialLength: Math.hypot(dx, dy),
            }
          }
        }
      }

      bezierDragStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        boundingRect: svg?.getBoundingClientRect() || new DOMRect(),
        pointerId: event.pointerId,
        handle,
        startPoint: startPoint!,
        endPoint: endPoint!,
        initialBezier: { ...bezier },
        adjacent,
        midPoint,
      }

      // Call onDragStart for bezier handle drag (no threshold, starts immediately)
      if (!dragStartCalledRef.current) {
        dragStartCalledRef.current = true
        callbacksRef.current.onDragStart?.()
      }

      setDraggingHandle({ keyframeId: handle.keyframeId, type: handle.type })
      setIsDragging(true)
      setDragState({
        type: 'bezier-handle',
        keyframeId: handle.keyframeId,
        itemId: point.itemId,
        property: point.property,
        handleType: handle.type,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        initialFrame: point.keyframe.frame,
        initialValue: point.keyframe.value,
        initialControlPoint:
          handle.type === 'out' ? { x: bezier.x1, y: bezier.y1 } : { x: bezier.x2, y: bezier.y2 },
      })
    },
    [disabled, points],
  )

  // Handle pointer move (SVG level)
  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return

      // Handle keyframe dragging
      if (dragStartRef.current && dragState?.type === 'keyframe') {
        const { mouseX, mouseY, point, initialKeyframeStates } = dragStartRef.current
        const anchorInitialState = initialKeyframeStates.get(point.keyframe.id)
        if (!anchorInitialState) return

        // Use fresh viewport dimensions (not cached) to handle resize during drag
        const graphWidth = viewport.width - padding.left - padding.right
        const graphHeight = viewport.height - padding.top - padding.bottom
        const frameRange = viewport.endFrame - viewport.startFrame
        const valueRange = Math.max(0.0001, viewport.maxValue - viewport.minValue)
        const dx = event.clientX - mouseX
        const dy = event.clientY - mouseY

        // Check threshold before committing to drag
        if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          setIsDragging(true)
          // Call onDragStart when we first exceed threshold
          if (!dragStartCalledRef.current && !dragStartRef.current.duplicateOnCommit) {
            dragStartCalledRef.current = true
            callbacksRef.current.onDragStart?.()
          }
        }

        if (!isDragging && !(Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          return
        }

        // Calculate DELTA in graph coordinates (relative movement)
        let frameDelta = (dx / graphWidth) * frameRange
        let valueDelta = -(dy / graphHeight) * valueRange

        // Alt = fine adjustment (half speed)
        if (event.altKey && !dragStartRef.current.duplicateOnCommit) {
          frameDelta *= 0.5
          valueDelta *= 0.5
        }

        let newFrame = anchorInitialState.frame + frameDelta
        let newValue = anchorInitialState.value + valueDelta

        // Shift = constrain to axis
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) {
            newValue = anchorInitialState.value // Lock Y (only change frame)
            setConstraintAxis('x') // Horizontal constraint (frame only)
          } else {
            newFrame = anchorInitialState.frame // Lock X (only change value)
            setConstraintAxis('y') // Vertical constraint (value only)
          }
        } else {
          setConstraintAxis(null)
        }

        // Bounds checking - clamp to valid frame range [0, maxFrame]
        newFrame = Math.round(newFrame)
        newFrame = Math.max(0, newFrame)
        if (maxFrame !== undefined) {
          newFrame = Math.min(maxFrame - 1, newFrame) // -1 because last valid frame is maxFrame - 1
        }

        // Bounds checking - clamp to valid value range
        newValue = Math.max(
          anchorInitialState.minValue,
          Math.min(anchorInitialState.maxValue, newValue),
        )

        // Apply snapping if enabled (but not when Ctrl is held to temporarily disable)
        if (snapEnabled && !event.ctrlKey && !event.metaKey) {
          // Snap frame to targets
          const frameSnap = snapToTargets(newFrame, snapFrameTargets, snapThresholds.frameThreshold)
          newFrame = frameSnap.snapped

          // Snap value to targets
          const valueSnap = snapToTargets(newValue, snapValueTargets, snapThresholds.valueThreshold)
          newValue = valueSnap.snapped
        }

        // Prevent dragging into blocked (transition) regions
        newFrame = clampToAvoidBlockedRanges(newFrame, anchorInitialState.frame)

        const constrainedFrameDelta = constrainFrameDelta
          ? constrainFrameDelta(
              newFrame - anchorInitialState.frame,
              Array.from(initialKeyframeStates.keys()),
            )
          : newFrame - anchorInitialState.frame
        newFrame = anchorInitialState.frame + constrainedFrameDelta

        const appliedFrameDelta = newFrame - anchorInitialState.frame
        const appliedValueDelta = newValue - anchorInitialState.value
        const nextPreviewValues: Record<string, { frame: number; value: number }> = {}

        for (const [keyframeId, initialState] of initialKeyframeStates) {
          let nextFrame = Math.round(initialState.frame + appliedFrameDelta)
          nextFrame = Math.max(0, nextFrame)
          if (maxFrame !== undefined) {
            nextFrame = Math.min(maxFrame - 1, nextFrame)
          }
          nextFrame = clampToAvoidBlockedRanges(nextFrame, initialState.frame)

          let nextValue = initialState.value + appliedValueDelta
          nextValue = Math.max(initialState.minValue, Math.min(initialState.maxValue, nextValue))

          nextPreviewValues[keyframeId] = { frame: nextFrame, value: nextValue }
        }

        setPreviewValues((prev) =>
          arePreviewValuesEqual(prev, nextPreviewValues) ? prev : nextPreviewValues,
        )
        return
      }

      // Handle bezier handle dragging — use local preview, commit on pointer up
      if (bezierDragStartRef.current && dragState?.type === 'bezier-handle') {
        const { boundingRect, startPoint, endPoint, handle, initialBezier, adjacent, midPoint } =
          bezierDragStartRef.current

        const mouseX = event.clientX - boundingRect.left
        const mouseY = event.clientY - boundingRect.top

        // Calculate new handle position in segment-relative coordinates
        const segmentWidth = endPoint.x - startPoint.x
        const segmentHeight = endPoint.y - startPoint.y

        if (segmentWidth === 0) return

        let newX = (mouseX - startPoint.x) / segmentWidth
        let newY = segmentHeight === 0 ? 0.5 : (mouseY - startPoint.y) / segmentHeight

        // Shift = constrain to initial direction (scale length only)
        if (event.shiftKey) {
          const initX = handle.type === 'out' ? initialBezier.x1 : initialBezier.x2
          const initY = handle.type === 'out' ? initialBezier.y1 : initialBezier.y2
          // Anchor in segment-relative coords: 'out' anchored at (0,0), 'in' anchored at (1,1)
          const anchorX = handle.type === 'out' ? 0 : 1
          const anchorY = handle.type === 'out' ? 0 : 1
          const dirX = initX - anchorX
          const dirY = initY - anchorY
          const dirLen = Math.hypot(dirX, dirY)
          if (dirLen > 0) {
            // Project mouse onto the initial direction line
            const toMouseX = newX - anchorX
            const toMouseY = newY - anchorY
            const dot = (toMouseX * dirX + toMouseY * dirY) / (dirLen * dirLen)
            newX = anchorX + dirX * dot
            newY = anchorY + dirY * dot
          }
        }

        const clampedNewX = Math.max(0, Math.min(1, newX))

        // Compute preview bezier for the dragged handle
        const newBezier = updateBezierFromHandle(initialBezier, handle.type, clampedNewX, newY)

        const nextPreview: Record<string, BezierControlPoints> = {
          [handle.keyframeId]: newBezier,
        }

        // Compute mirrored bezier for mid-point tangent continuity
        if (adjacent && adjacent.initialLength > 0) {
          const handleAbsX = startPoint.x + clampedNewX * segmentWidth
          const handleAbsY = startPoint.y + newY * segmentHeight

          const dx = handleAbsX - midPoint.x
          const dy = handleAbsY - midPoint.y
          const len = Math.hypot(dx, dy)

          if (len > 0) {
            const mirrorX = midPoint.x - (dx / len) * adjacent.initialLength
            const mirrorY = midPoint.y - (dy / len) * adjacent.initialLength

            const adjSegW = adjacent.endPoint.x - adjacent.startPoint.x
            const adjSegH = adjacent.endPoint.y - adjacent.startPoint.y

            if (adjSegW !== 0) {
              const adjRelX = (mirrorX - adjacent.startPoint.x) / adjSegW
              const adjRelY = adjSegH === 0 ? 0.5 : (mirrorY - adjacent.startPoint.y) / adjSegH

              nextPreview[adjacent.keyframeId] = updateBezierFromHandle(
                adjacent.initialBezier,
                adjacent.handleType,
                Math.max(0, Math.min(1, adjRelX)),
                adjRelY,
              )
            }
          }
        }

        setPreviewBezierConfigs(nextPreview)
      }
    },
    [
      disabled,
      dragState,
      isDragging,
      viewport,
      padding,
      maxFrame,
      snapEnabled,
      snapFrameTargets,
      snapValueTargets,
      snapThresholds,
      snapToTargets,
      clampToAvoidBlockedRanges,
      constrainFrameDelta,
    ],
  )

  // Handle pointer up (SVG level)
  const dragStateType = dragState?.type
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      // Release pointer capture
      if (
        svgRef.current &&
        (dragStartRef.current || bezierDragStartRef.current || marqueeStateRef.current)
      ) {
        try {
          svgRef.current.releasePointerCapture(event.pointerId)
        } catch {
          // Pointer capture may have been lost
        }
      }

      // If we never exceeded threshold, treat as click (selection only)
      // Selection was already handled in pointerDown, no additional action needed

      if (dragStateType === 'keyframe' && dragStartRef.current && previewValuesRef.current) {
        if (dragStartRef.current.duplicateOnCommit) {
          const entries = Array.from(dragStartRef.current.initialKeyframeStates.entries()).flatMap(
            ([keyframeId, initialState]) => {
              const previewValue = previewValuesRef.current?.[keyframeId]
              if (!previewValue) {
                return []
              }

              return [
                {
                  ref: {
                    itemId: initialState.itemId,
                    property: initialState.property,
                    keyframeId,
                  },
                  frame: previewValue.frame,
                  value: previewValue.value,
                },
              ]
            },
          )

          if (entries.length > 0) {
            callbacksRef.current.onDuplicateKeyframes?.(entries)
          }
        } else {
          for (const [keyframeId, initialState] of dragStartRef.current.initialKeyframeStates) {
            const previewValue = previewValuesRef.current[keyframeId]
            if (!previewValue) continue
            callbacksRef.current.onKeyframeMove?.(
              {
                itemId: initialState.itemId,
                property: initialState.property,
                keyframeId,
              },
              previewValue.frame,
              previewValue.value,
            )
          }
        }
      }

      // Commit bezier handle preview on pointer up
      if (
        dragStateType === 'bezier-handle' &&
        bezierDragStartRef.current &&
        previewBezierConfigsRef.current
      ) {
        const { handle, startPoint, adjacent } = bezierDragStartRef.current
        const previews = previewBezierConfigsRef.current

        // Commit the primary handle
        const primaryBezier = previews[handle.keyframeId]
        if (primaryBezier) {
          callbacksRef.current.onBezierHandleMove?.(
            {
              itemId: startPoint.itemId,
              property: startPoint.property,
              keyframeId: handle.keyframeId,
            },
            primaryBezier,
          )
        }

        // Commit the mirrored adjacent handle
        if (adjacent) {
          const adjBezier = previews[adjacent.keyframeId]
          if (adjBezier) {
            callbacksRef.current.onBezierHandleMove?.(
              {
                itemId: adjacent.itemId,
                property: adjacent.property,
                keyframeId: adjacent.keyframeId,
              },
              adjBezier,
            )
          }
        }
      }

      // Call onDragEnd if we actually started a drag operation
      if (dragStartCalledRef.current) {
        dragStartCalledRef.current = false
        callbacksRef.current.onDragEnd?.()
      }

      // Stamp interaction time so the post-drag click doesn't deselect
      // Only stamp when there was an actual keyframe/handle interaction
      if (dragStartRef.current || bezierDragStartRef.current) {
        lastInteractionTimeRef.current = Date.now()
      }

      // Reset all drag state
      dragStartRef.current = null
      bezierDragStartRef.current = null
      svgRef.current = null
      setDragState(null)
      setIsDragging(false)
      setPreviewValues(null)
      setPreviewBezierConfigs(null)
      setDraggingHandle(null)
      setConstraintAxis(null)
    },
    [dragStateType, marqueeStateRef],
  )

  const { handleWheel } = useGraphWheel({
    disabled,
    viewport,
    graphDimensions,
    screenToGraph,
    clampViewportToBounds,
    ensureKeyframesRemainVisible,
    dragStartRef,
    bezierDragStartRef,
    onViewportChange,
  })

  // Handle background click (deselect)
  const handleBackgroundClick = useCallback(
    (_event: React.MouseEvent) => {
      if (disabled) return
      if (marqueeJustEndedRef.current) return
      // Pointer capture redirects click targets to SVG — ignore clicks
      // that happen right after a keyframe/handle interaction
      if (Date.now() - lastInteractionTimeRef.current < 300) return
      callbacksRef.current.onSelectionChange?.(new Set())
      callbacksRef.current.onBackgroundClick?.()
    },
    [disabled, marqueeJustEndedRef],
  )

  return {
    dragState,
    isDragging,
    previewValues,
    draggingHandle,
    previewBezierConfigs,
    constraintAxis,
    handleKeyframePointerDown,
    handleKeyframeClick,
    handleBezierPointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleBackgroundPointerDown,
    handleBackgroundClick,
    lastInteractionTime: lastInteractionTimeRef,
    marqueeRect,
    zoomIn,
    zoomOut,
    fitToContent,
  }
}
