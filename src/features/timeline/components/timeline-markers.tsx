// React and external libraries
import { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react'

// Stores and selectors
import { useMarkersStore } from '../stores/markers-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { markDirty } from '../stores/timeline-actions'
import { setInOutPointsWithoutHistory } from '../stores/actions/marker-actions'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMicRecordingStore, isMicRecordingActive } from '@/shared/state/mic-recording-store'
import { useSelectionStore } from '@/shared/state/selection'
import { perfMarkRender } from '@/shared/logging/perf-marks'

// Components
import { TimelineInOutMarkers } from './timeline-in-out-markers'
import { TimelineProjectMarkers } from './timeline-project-markers'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'
import { beginIoPointerDrag, IoRangeStrip } from '@/shared/timeline/io-range'
import {
  beginTimelineSkimmerScrub,
  endTimelineSkimmerScrub,
  mainTimelineScrubActiveRef,
} from '@/shared/timeline/main-timeline-scrub'
import {
  getTimelineScrubViewportProgress,
  notifyTimelineScrubVisualFrame,
} from '@/shared/timeline/live-scroll-sync'
import { useSettingsStore } from '@/features/timeline/deps/settings'

// Utilities and hooks
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { useZoomStore } from '../stores/zoom-store'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle'
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@/config/editor-layout'
import { sanitizeInOutPoints } from '../utils/in-out-points'
import { frameToPixelsNow, pixelsToFrameNow } from '../utils/zoom-conversions'
import { getEdgeScrollDelta, getPlayheadEdgeScrollVelocity } from '../utils/playhead-edge-scroll'
import { drawTimelineRulerViewportCanvas } from './timeline-ruler-viewport-canvas'

interface TimelineMarkersProps {
  duration: number // Total timeline duration in seconds
  width?: number // Explicit width in pixels (optional)
}

// The in/out (IO) bar gets its own lane at the top of the ruler; the tick ruler
// occupies the remaining height below it (mirrors the Color workspace). Exported
// so the ruler playhead can drop its flag below the lane.
export const IO_LANE_HEIGHT = 12

function applyMainTimelineScrubVisual({
  scrollContainer,
  viewportRect,
  frame,
  maxFrame,
  frameToPixels,
  playheadElements,
}: {
  scrollContainer: HTMLDivElement | null
  viewportRect: Pick<DOMRect, 'left' | 'width'> | null
  frame: number
  maxFrame: number
  frameToPixels: (frame: number) => number
  playheadElements: HTMLElement[]
}): void {
  if (!scrollContainer || !viewportRect) return
  // Keep the transient visual on the same integer-frame pixel as the committed
  // playhead. Following the raw pointer here makes a stationary click appear to
  // shift on release even when both positions resolve to the same frame.
  const frameTimelineX = Math.round(frameToPixels(frame))
  const visualTimelineX = Math.max(
    scrollContainer.scrollLeft,
    Math.min(
      frameTimelineX,
      scrollContainer.scrollLeft + Math.max(0, viewportRect.width - 1),
      Math.round(frameToPixels(maxFrame)),
    ),
  )
  for (const element of playheadElements) {
    element.style.transform = `translate3d(${visualTimelineX}px, 0, 0)`
  }
  notifyTimelineScrubVisualFrame(scrollContainer, {
    frame,
    source: 'main',
    viewportProgress: getTimelineScrubViewportProgress(
      visualTimelineX - scrollContainer.scrollLeft,
      viewportRect.width - 1,
    ),
  })
}

function applyMainTimelineEdgeScroll(
  scrollContainer: HTMLDivElement | null,
  viewportRect: Pick<DOMRect, 'left' | 'right'> | null,
  clientX: number,
  timestamp: number,
  previousTimestamp: number | null,
): number | null {
  if (!scrollContainer || !viewportRect) return null
  const velocity = getPlayheadEdgeScrollVelocity(clientX, viewportRect)
  const canScroll =
    (velocity < 0 && scrollContainer.scrollLeft > 0) ||
    (velocity > 0 &&
      scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth)
  if (velocity === 0 || !canScroll) return null

  scrollContainer.scrollLeft += getEdgeScrollDelta(
    velocity,
    timestamp,
    previousTimestamp ?? timestamp - 1000 / 60,
  )
  return timestamp
}

/**
 * Timeline markers with a single viewport-sized ruler canvas.
 */
export const TimelineMarkers = memo(function TimelineMarkers({
  duration,
  width,
}: TimelineMarkersProps) {
  perfMarkRender('TimelineMarkers')
  const editorDensity = useSettingsStore((s) => s.editorDensity)
  const editorLayout = getEditorLayout(editorDensity)
  const { frameToPixels } = useTimelineCommittedZoomContext()
  const fps = useTimelineSettingsStore((s) => s.fps)
  const inPoint = useMarkersStore((s) => s.inPoint)
  const outPoint = useMarkersStore((s) => s.outPoint)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame)
  const pause = usePlaybackStore((s) => s.pause)
  const selectMarker = useSelectionStore((s) => s.selectMarker)

  const containerRef = useRef<HTMLDivElement>(null)
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  // scrollLeft is ref-only — the viewport canvas updates imperatively from
  // the scroll RAF callback without a React render.
  const [isDragging, setIsDragging] = useState(false)
  const [isRangeDragging, setIsRangeDragging] = useState(false)

  // Refs for drag handlers
  const pixelsToFrameRef = useRef(pixelsToFrameNow)
  const frameToPixelsRef = useRef(frameToPixels)
  const setCurrentFrameRef = useRef(setCurrentFrame)
  const setScrubFrameRef = useRef(setScrubFrame)
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame)
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame
    })
  }, [])
  const markDirtyRef = useRef(markDirty)
  const pauseRef = useRef(pause)
  const fpsRef = useRef(fps)
  const durationRef = useRef(duration)
  const inPointRef = useRef(inPoint)
  const outPointRef = useRef(outPoint)
  const rangeDragCleanupRef = useRef<(() => void) | null>(null)
  const maxFrame = Math.max(1, Math.floor(duration * fps))
  const sanitizedInOutPoints = useMemo(
    () => sanitizeInOutPoints({ inPoint, outPoint, maxFrame }),
    [inPoint, outPoint, maxFrame],
  )
  const safeInPoint = sanitizedInOutPoints.inPoint
  const safeOutPoint = sanitizedInOutPoints.outPoint

  useEffect(() => {
    frameToPixelsRef.current = frameToPixels
    setCurrentFrameRef.current = setCurrentFrame
    setScrubFrameRef.current = setScrubFrame
    markDirtyRef.current = markDirty
    pauseRef.current = pause
    fpsRef.current = fps
    durationRef.current = duration
    inPointRef.current = safeInPoint
    outPointRef.current = safeOutPoint
  }, [
    frameToPixels,
    setCurrentFrame,
    setScrubFrame,
    pause,
    fps,
    duration,
    safeInPoint,
    safeOutPoint,
  ])

  useEffect(() => {
    if (safeInPoint === inPoint && safeOutPoint === outPoint) {
      return
    }

    setInOutPointsWithoutHistory(safeInPoint, safeOutPoint)
  }, [inPoint, outPoint, safeInPoint, safeOutPoint])

  // Track viewport and scroll
  const scrollLeftRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const syncRulerScrollRef = useRef<(() => void) | null>(null)
  const hoverPreviewRafRef = useRef<number | null>(null)
  const pendingHoverPreviewFrameRef = useRef<number | null>(null)

  // Unified scrubbing refs (scroll + playhead in same RAF frame)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrubMouseClientXRef = useRef<number>(0)
  const scrubRAFIdRef = useRef<number | null>(null)
  const scrubAnimationTimeRef = useRef<number | null>(null)
  const scrubPlayheadElementsRef = useRef<HTMLElement[]>([])
  const skimmerScrubOwnerRef = useRef({})
  const isScrubActiveRef = useRef(false)
  const scrubThrottleStateRef = useRef(createScrubThrottleState())

  useEffect(() => {
    if (!containerRef.current) return

    // Find the actual scroll container (not the sticky parent)
    const scrollContainer = containerRef.current.closest('.timeline-container') as HTMLElement
    if (!scrollContainer) return

    const updateViewport = () => {
      // Measure scroll container - that's the actual viewport
      setViewportWidth(scrollContainer.clientWidth)
    }

    const updateScroll = () => {
      const newScrollLeft = scrollContainer.scrollLeft
      if (newScrollLeft !== scrollLeftRef.current) {
        scrollLeftRef.current = newScrollLeft
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null
            syncRulerScrollRef.current?.()
          })
        }
      }
    }

    updateViewport()
    scrollLeftRef.current = scrollContainer.scrollLeft
    // Initial sync is deferred to the config-change effect (runs after first render)

    // Observe scroll container for viewport size changes
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(scrollContainer)
    scrollContainer.addEventListener('scroll', updateScroll, { passive: true })

    return () => {
      resizeObserver.disconnect()
      scrollContainer.removeEventListener('scroll', updateScroll)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  // Ticks live in the lane below the IO bar, so the canvas is the ruler height
  // minus the IO lane.
  const canvasHeight = editorLayout.timelineRulerHeight - IO_LANE_HEIGHT

  // Store viewport config in refs so the imperative scroll handler can access it.
  const canvasHeightRef = useRef(canvasHeight)
  const viewportWidthRef = useRef(viewportWidth)
  canvasHeightRef.current = canvasHeight
  viewportWidthRef.current = viewportWidth

  /** Draw the visible ruler directly into its viewport-sized canvas. */
  const syncRulerScroll = useCallback(() => {
    const rulerCanvas = rulerCanvasRef.current
    if (!rulerCanvas) return
    drawTimelineRulerViewportCanvas({
      canvas: rulerCanvas,
      scrollLeft: scrollLeftRef.current,
      viewportWidth: viewportWidthRef.current,
      canvasHeight: canvasHeightRef.current,
      pixelsPerSecond: useZoomStore.getState().pixelsPerSecond,
      fps: fpsRef.current,
    })
  }, [])
  syncRulerScrollRef.current = syncRulerScroll

  // Redraw once per animation frame at live zoom. The viewport canvas keeps
  // work bounded to visible pixels without creating timeline-length nodes.
  useEffect(() => {
    return useZoomStore.subscribe((state, previousState) => {
      if (state.pixelsPerSecond === previousState.pixelsPerSecond) return

      if (rafIdRef.current !== null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        syncRulerScrollRef.current?.()
      })
    })
  }, [])

  // Trigger sync on non-store config changes.
  useEffect(() => {
    syncRulerScroll()
  }, [fps, canvasHeight, viewportWidth, syncRulerScroll])

  /**
   * Unified scrub loop - handles BOTH edge scroll AND playhead in same RAF frame
   * This ensures scroll and playhead are always perfectly synchronized
   */
  const runUnifiedScrubLoop = useCallback((timestamp: number) => {
    if (!isScrubActiveRef.current || !containerRef.current) {
      scrubRAFIdRef.current = null
      return
    }

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      scrubRAFIdRef.current = null
      return
    }
    const mouseClientX = scrubMouseClientXRef.current
    // One layout read owns all viewport and timeline-coordinate work for this
    // frame. The content origin is the viewport origin minus native scroll.
    const viewportRect = scrollContainer.getBoundingClientRect()

    // --- STEP 1: Calculate and apply edge scroll ---
    scrubAnimationTimeRef.current = applyMainTimelineEdgeScroll(
      scrollContainer,
      viewportRect,
      mouseClientX,
      timestamp,
      scrubAnimationTimeRef.current,
    )

    // --- STEP 2: Update playhead with the freshly applied scroll position ---
    const x = mouseClientX - viewportRect.left + scrollContainer.scrollLeft

    // Calculate frame (pixel-perfect: round to whole frames)
    const maxFrame = Math.floor(durationRef.current * fpsRef.current)
    const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))))

    const nowMs = performance.now()
    if (
      shouldCommitScrubFrame({
        state: scrubThrottleStateRef.current,
        pointerX: x,
        targetFrame: frame,
        pixelsPerSecond: useZoomStore.getState().pixelsPerSecond,
        nowMs,
      })
    ) {
      setScrubFrameRef.current(frame)
    }

    applyMainTimelineScrubVisual({
      scrollContainer,
      viewportRect,
      frame,
      maxFrame,
      frameToPixels: frameToPixelsNow,
      playheadElements: scrubPlayheadElementsRef.current,
    })

    // --- STEP 3: Continue loop while scrubbing ---
    scrubRAFIdRef.current = requestAnimationFrame(runUnifiedScrubLoop)
  }, [])

  const getTimelineXFromClientX = useCallback((clientX: number): number => {
    if (!containerRef.current) return 0
    return clientX - containerRef.current.getBoundingClientRect().left
  }, [])

  const getFrameFromClientX = useCallback(
    (clientX: number): number => {
      const x = getTimelineXFromClientX(clientX)
      const maxFrame = Math.floor(durationRef.current * fpsRef.current)
      return Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))))
    },
    [getTimelineXFromClientX],
  )

  const handleRulerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging || isRangeDragging) return
      // The ruler owns this hover. Prevent TimelineContent's bubbling handler
      // from scheduling a second publication for the same pointer sample.
      e.stopPropagation()

      const frame = getFrameFromClientX(e.clientX)
      pendingHoverPreviewFrameRef.current = frame
      if (hoverPreviewRafRef.current !== null) return
      hoverPreviewRafRef.current = requestAnimationFrame(() => {
        hoverPreviewRafRef.current = null
        const nextFrame = pendingHoverPreviewFrameRef.current
        pendingHoverPreviewFrameRef.current = null
        if (nextFrame !== null) {
          setPreviewFrameRef.current(nextFrame)
        }
      })
    },
    [getFrameFromClientX, isDragging, isRangeDragging],
  )

  const handleRulerMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging || isRangeDragging) return

      const timelineContainer = e.currentTarget.closest('[data-timeline-scroll-container]')
      if (e.relatedTarget instanceof Node && timelineContainer?.contains(e.relatedTarget)) {
        if (hoverPreviewRafRef.current !== null) {
          cancelAnimationFrame(hoverPreviewRafRef.current)
          hoverPreviewRafRef.current = null
        }
        pendingHoverPreviewFrameRef.current = null
        // The parent timeline owns skimming across both its ruler and tracks.
        // Crossing that internal boundary is not a skim release: clearing here
        // briefly retargets the committed frame and cancels compound-frame work
        // before the parent publishes the next hovered frame.
        return
      }

      if (hoverPreviewRafRef.current !== null) {
        cancelAnimationFrame(hoverPreviewRafRef.current)
        hoverPreviewRafRef.current = null
      }
      pendingHoverPreviewFrameRef.current = null
      setPreviewFrameRef.current(null)
    },
    [isDragging, isRangeDragging],
  )

  useEffect(
    () => () => {
      if (hoverPreviewRafRef.current !== null) {
        cancelAnimationFrame(hoverPreviewRafRef.current)
      }
      hoverPreviewRafRef.current = null
      pendingHoverPreviewFrameRef.current = null
    },
    [],
  )

  const handleRangeMouseDown = useCallback(
    (e: React.PointerEvent) => {
      const startIn = inPointRef.current
      const startOut = outPointRef.current
      if (startIn === null || startOut === null) return

      const startTimelineX = getTimelineXFromClientX(e.clientX)
      const rangeTop = e.currentTarget.getBoundingClientRect().top
      const originalCursor = document.body.style.cursor
      let lastIn = startIn
      let lastOut = startOut

      const cleanup = beginIoPointerDrag(
        e,
        (clientX) => {
          const deltaFrames = Math.round(
            pixelsToFrameRef.current(getTimelineXFromClientX(clientX)) -
              pixelsToFrameRef.current(startTimelineX),
          )
          const span = Math.max(1, startOut - startIn)
          const maxIn = Math.max(0, Math.floor(durationRef.current * fpsRef.current) - span)
          const nextIn = Math.max(0, Math.min(startIn + deltaFrames, maxIn))
          const nextOut = nextIn + span
          const label = `${formatTimecodeCompact(nextIn, fpsRef.current)} → ${formatTimecodeCompact(nextOut, fpsRef.current)}`
          const scrollContainer = containerRef.current?.closest(
            '.timeline-container',
          ) as HTMLDivElement | null
          const coordinateBox = scrollContainer ?? containerRef.current
          const coordinateRect = coordinateBox?.getBoundingClientRect()
          const scrollLeft = scrollContainer?.scrollLeft ?? 0
          const rangeLeft = (coordinateRect?.left ?? 0) + frameToPixels(nextIn) - scrollLeft
          const rangeRight = (coordinateRect?.left ?? 0) + frameToPixels(nextOut) - scrollLeft
          const visibleLeft = coordinateRect
            ? Math.max(coordinateRect.left, Math.min(coordinateRect.right, rangeLeft))
            : rangeLeft
          const visibleRight = coordinateRect
            ? Math.max(coordinateRect.left, Math.min(coordinateRect.right, rangeRight))
            : rangeRight
          const readout = {
            label,
            x: (visibleLeft + visibleRight) / 2,
            // The global readout places its bottom 16px above this coordinate;
            // offset by the lane height so it sits just above the body.
            y: rangeTop + IO_LANE_HEIGHT,
          }
          // Skip redundant writes while dragging (still update the readout).
          if (nextIn === lastIn && nextOut === lastOut) return readout
          setInOutPointsWithoutHistory(nextIn, nextOut)
          // Skim the preview to the range's leading (in) edge as it slides.
          setPreviewFrameRef.current(nextIn)
          lastIn = nextIn
          lastOut = nextOut
          return readout
        },
        () => {
          document.body.style.cursor = originalCursor
          previewScrubberSuppressRef.current = false
          setPreviewFrameRef.current(null)
          markDirtyRef.current()
          setIsRangeDragging(false)
          rangeDragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'move'
      // Keep the preview canvas refreshing but pin the ghost skimmer so it
      // doesn't chase the range as it slides (matches the Color workspace).
      previewScrubberSuppressRef.current = true
      setIsRangeDragging(true)
      rangeDragCleanupRef.current = cleanup
    },
    [frameToPixels, getTimelineXFromClientX],
  )

  // Scrubbing handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation() // Prevent click from bubbling to container and clearing selection
      if (!containerRef.current) return

      // Seeking is disabled during a voiceover take — moving the playhead
      // without moving the mic audio would desync the recording irreparably.
      if (isMicRecordingActive(useMicRecordingStore.getState().status)) return

      // Clear marker selection when clicking on ruler (only if a marker is selected)
      const { selectedMarkerId } = useSelectionStore.getState()
      if (selectedMarkerId) {
        selectMarker(null)
      }

      // Cache scroll container for edge-scrolling
      scrollContainerRef.current = containerRef.current.closest(
        '.timeline-container',
      ) as HTMLDivElement | null
      scrubPlayheadElementsRef.current = scrollContainerRef.current
        ? Array.from(
            scrollContainerRef.current.querySelectorAll<HTMLElement>('[data-timeline-playhead]'),
          )
        : []

      // Initialize unified scrub state
      scrubMouseClientXRef.current = e.clientX
      scrubAnimationTimeRef.current = null
      isScrubActiveRef.current = true
      mainTimelineScrubActiveRef.current = true
      beginTimelineSkimmerScrub(skimmerScrubOwnerRef.current)

      pauseRef.current()

      // Immediate frame update on click using the ruler's time-axis origin.
      const viewportRect = scrollContainerRef.current?.getBoundingClientRect() ?? null
      const x = viewportRect
        ? e.clientX - viewportRect.left + scrollContainerRef.current!.scrollLeft
        : e.clientX - containerRef.current.getBoundingClientRect().left
      const maxFrame = Math.floor(durationRef.current * fpsRef.current)
      const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))))
      setScrubFrameRef.current(frame)
      applyMainTimelineScrubVisual({
        scrollContainer: scrollContainerRef.current,
        viewportRect,
        frame,
        maxFrame,
        frameToPixels: frameToPixelsNow,
        playheadElements: scrubPlayheadElementsRef.current,
      })
      scrubThrottleStateRef.current = createScrubThrottleState({
        pointerX: x,
        frame,
        nowMs: performance.now(),
      })

      setIsDragging(true)

      // Start unified RAF loop
      if (scrubRAFIdRef.current === null) {
        scrubRAFIdRef.current = requestAnimationFrame(runUnifiedScrubLoop)
      }
    },
    [selectMarker, runUnifiedScrubLoop],
  )

  useEffect(() => {
    if (!isDragging) return
    const skimmerScrubOwner = skimmerScrubOwnerRef.current

    const originalCursor = document.body.style.cursor
    document.body.style.cursor = 'ew-resize'

    const handleMouseMove = (e: MouseEvent) => {
      // Just store position - the unified RAF loop handles everything else
      scrubMouseClientXRef.current = e.clientX
    }

    const handleMouseUp = () => {
      // Stop the unified scrub loop
      isScrubActiveRef.current = false
      if (scrubRAFIdRef.current !== null) {
        cancelAnimationFrame(scrubRAFIdRef.current)
        scrubRAFIdRef.current = null
      }
      const finalFrame = getFrameFromClientX(scrubMouseClientXRef.current)
      setScrubFrameRef.current(finalFrame)
      const finalTimelineX = Math.round(frameToPixelsNow(finalFrame))
      for (const element of scrubPlayheadElementsRef.current) {
        element.style.transform = `translate3d(${finalTimelineX}px, 0, 0)`
      }
      scrubAnimationTimeRef.current = null
      scrubPlayheadElementsRef.current = []
      setIsDragging(false)
      setPreviewFrameRef.current(null)
      // Clear after the preview notification so linked playheads retain the
      // final frame while their slower React props catch up.
      mainTimelineScrubActiveRef.current = false
      endTimelineSkimmerScrub(skimmerScrubOwner)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      document.body.style.cursor = originalCursor
      // Ensure cleanup
      isScrubActiveRef.current = false
      mainTimelineScrubActiveRef.current = false
      endTimelineSkimmerScrub(skimmerScrubOwner)
      if (scrubRAFIdRef.current !== null) {
        cancelAnimationFrame(scrubRAFIdRef.current)
        scrubRAFIdRef.current = null
      }
      scrubAnimationTimeRef.current = null
      scrubPlayheadElementsRef.current = []
    }
  }, [getFrameFromClientX, isDragging])

  // Tear down an in-flight range drag if the component unmounts mid-gesture.
  useEffect(() => () => rangeDragCleanupRef.current?.(), [])

  return (
    <div
      ref={containerRef}
      className="border-b border-border/80 relative"
      onMouseDown={handleMouseDown}
      onMouseMove={handleRulerMouseMove}
      onMouseLeave={handleRulerMouseLeave}
      style={{
        background: 'oklch(0.22 0 0 / 0.22)',
        userSelect: 'none',
        cursor: 'ew-resize',
        height: EDITOR_LAYOUT_CSS_VALUES.timelineRulerHeight,
        width: width ? `${width}px` : undefined,
        minWidth: width ? `${width}px` : undefined,
      }}
    >
      {/* Viewport-sized ruler canvas below the IO lane. */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{ top: IO_LANE_HEIGHT }}
      >
        <canvas
          ref={rulerCanvasRef}
          data-main-timeline-ruler-canvas
          aria-hidden="true"
          className="sticky left-0 block pointer-events-none text-[10px] text-muted-foreground"
          style={{
            width: viewportWidth || undefined,
            height: canvasHeight,
            contain: 'layout paint',
          }}
        />
      </div>

      {/* IO lane backdrop + divider so the in/out bar reads as its own track
          rather than floating over the ruler ticks. */}
      <div
        className="absolute left-0 right-0 top-0 border-b border-border/70 bg-black/25 pointer-events-none"
        style={{ height: IO_LANE_HEIGHT, zIndex: 8 }}
      />

      {/* Draggable in/out strip — its own lane at the top of the ruler */}
      {safeInPoint !== null && safeOutPoint !== null && (
        <IoRangeStrip
          left={`${frameToPixels(safeInPoint)}px`}
          width={`${frameToPixels(safeOutPoint) - frameToPixels(safeInPoint)}px`}
          height={IO_LANE_HEIGHT}
          className="cursor-move active:cursor-move"
          onDragStart={handleRangeMouseDown}
          testId="edit-timeline-io-strip"
        />
      )}

      {/* In/Out markers (DOM - only 2 elements) */}
      <TimelineInOutMarkers />

      {/* Project markers (DOM - minimal count) */}
      <TimelineProjectMarkers />
    </div>
  )
})
