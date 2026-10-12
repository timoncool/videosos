// React and external libraries
import { useState, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

// Stores and selectors
import { usePlaybackStore } from '@/shared/state/playback'
import { useMicRecordingStore, isMicRecordingActive } from '@/shared/state/mic-recording-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'

// Utilities and hooks
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle'
import {
  frameToPixelsNow,
  getPixelsPerSecondNow,
  pixelsToFrameNow,
} from '../utils/zoom-conversions'
import { withPerfMeasure, perfMarkRender } from '@/shared/logging/perf-marks'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import {
  beginTimelineSkimmerScrub,
  endTimelineSkimmerScrub,
  mainTimelineScrubActiveRef,
} from '@/shared/timeline/main-timeline-scrub'
import {
  TIMELINE_SCRUB_VISUAL_FRAME_EVENT,
  getTimelineScrubViewportProgress,
  getTimelineScrubViewportX,
  notifyTimelineScrubVisualFrame,
  type TimelineScrubVisualFrameDetail,
} from '@/shared/timeline/live-scroll-sync'
import { getEdgeScrollDelta, getPlayheadEdgeScrollVelocity } from '../utils/playhead-edge-scroll'

interface TimelinePlayheadProps {
  inRuler?: boolean // If true, shows diamond indicator for ruler
  maxFrame?: number // Maximum frame the playhead can be dragged to (content duration)
  // Drop the marks below the ruler's top IO lane so the flag doesn't share it.
  topOffsetPx?: number
  coordinateSurfaceRef?: RefObject<HTMLDivElement | null>
}

function setTranslateXIfChanged(element: HTMLElement, left: number): void {
  const transform = `translate3d(${left}px, 0, 0)`
  if (element.style.transform !== transform) element.style.transform = transform
}

function updatePlayheadPosition(element: HTMLElement | null, frame: number): void {
  if (!element) return
  setTranslateXIfChanged(element, Math.round(frameToPixelsNow(frame)))
}

function getPlayheadDragSurfaces({
  playhead,
  explicitCoordinateSurface,
  inRuler,
}: {
  playhead: HTMLDivElement | null
  explicitCoordinateSurface: HTMLDivElement | null
  inRuler: boolean
}): {
  scrollContainer: HTMLDivElement | null
  coordinateSurface: HTMLDivElement | null
} {
  if (!playhead) {
    return {
      scrollContainer: null,
      coordinateSurface: explicitCoordinateSurface,
    }
  }

  const scrollContainer = playhead.closest<HTMLDivElement>('.timeline-container')
  const fallbackSurface = inRuler
    ? playhead.closest<HTMLDivElement>('.timeline-ruler')
    : playhead.closest<HTMLDivElement>('.timeline-tracks')
  const coordinateSurface = explicitCoordinateSurface ?? (scrollContainer ? null : fallbackSurface)

  return { scrollContainer, coordinateSurface }
}

function getPlayheadPointerX(
  coordinateSurface: HTMLDivElement | null,
  scrollContainer: HTMLDivElement | null,
  clientX: number,
  fallbackX: number,
): number {
  if (coordinateSurface) {
    return clientX - coordinateSurface.getBoundingClientRect().left
  }
  if (scrollContainer) {
    return clientX - scrollContainer.getBoundingClientRect().left + scrollContainer.scrollLeft
  }

  return fallbackX
}

/**
 * Timeline Playhead Component
 *
 * Renders the playhead indicator that shows the current frame position
 * - Vertical line across all tracks
 * - Diamond indicator in ruler when inRuler=true
 * - Synchronized with playback store via manual subscription (no re-renders during playback)
 * - Draggable for scrubbing through timeline
 */
export function TimelinePlayhead({
  inRuler = false,
  maxFrame,
  topOffsetPx = 0,
  coordinateSurfaceRef,
}: TimelinePlayheadProps) {
  perfMarkRender('TimelinePlayhead')
  // Don't subscribe to currentFrame - use ref + manual subscription instead
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame)

  const [isDragging, setIsDragging] = useState(false)
  const [isExternalDrag, setIsExternalDrag] = useState(false)
  const playheadRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  // Track activeTool via ref subscription to avoid re-renders during playback
  // This prevents mode toggle from interrupting frame updates
  const activeToolRef = useRef(useSelectionStore.getState().activeTool)
  useEffect(() => {
    return useSelectionStore.subscribe((state) => {
      activeToolRef.current = state.activeTool
    })
  }, [])

  // Use refs to avoid stale closures
  const pixelsToFrameRef = useRef(pixelsToFrameNow)
  const setScrubFrameRef = useRef(setScrubFrame)
  const maxFrameRef = useRef(maxFrame)
  const frameToPixelsRef = useRef(frameToPixelsNow)
  const pixelsPerSecondRef = useRef(getPixelsPerSecondNow())

  // RAF throttling refs for smooth scrubbing without excessive state updates
  const rafIdRef = useRef<number | null>(null)
  const scrubClientXRef = useRef<number | null>(null)
  const scrubAnimationTimeRef = useRef<number | null>(null)
  const scrubScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrubCoordinateSurfaceRef = useRef<HTMLDivElement | null>(null)
  const scrubPlayheadElementsRef = useRef<HTMLElement[]>([])
  const resumePlaybackRafRef = useRef<number | null>(null)
  const skimmerScrubOwnerRef = useRef({})
  const scrubThrottleStateRef = useRef(
    createScrubThrottleState({
      frame: usePlaybackStore.getState().currentFrame,
      nowMs: performance.now(),
    }),
  )
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame)
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame
    })
  }, [])

  // Update prop/action refs without subscribing the component to live zoom.
  useEffect(() => {
    setScrubFrameRef.current = setScrubFrame
    maxFrameRef.current = maxFrame
  }, [setScrubFrame, maxFrame])

  useEffect(() => {
    isDraggingRef.current = isDragging
    const playbackState = usePlaybackStore.getState()
    updatePlayheadPosition(
      playheadRef.current,
      isDragging && playbackState.previewFrame !== null
        ? playbackState.previewFrame
        : playbackState.currentFrame,
    )
  }, [isDragging])

  useEffect(() => {
    return () => {
      if (resumePlaybackRafRef.current !== null) {
        cancelAnimationFrame(resumePlaybackRafRef.current)
        usePlaybackStore.getState().cancelPlaybackScrubResume()
      }
    }
  }, [])

  // Subscribe to playback frame changes and update position directly.
  // During playhead drags, use the same atomic scrub state as the main ruler
  // so the fast-scrub overlay hands back to the player consistently.
  useLayoutEffect(() => {
    const updateCurrentPosition = () => {
      const playbackState = usePlaybackStore.getState()
      updatePlayheadPosition(
        playheadRef.current,
        isDraggingRef.current && playbackState.previewFrame !== null
          ? playbackState.previewFrame
          : playbackState.currentFrame,
      )
    }

    // Initial update
    updateCurrentPosition()

    const unsubscribePlayback = usePlaybackStore.subscribe((state) => {
      updatePlayheadPosition(
        playheadRef.current,
        isDraggingRef.current && state.previewFrame !== null
          ? state.previewFrame
          : state.currentFrame,
      )
    })
    const unsubscribeZoom = useZoomStore.subscribe((state, previousState) => {
      pixelsPerSecondRef.current = state.pixelsPerSecond
      if (state.pixelsPerSecond !== previousState.pixelsPerSecond) {
        updateCurrentPosition()
      }
    })
    const unsubscribeTimelineSettings = useTimelineSettingsStore.subscribe(
      (state, previousState) => {
        if (state.fps !== previousState.fps) {
          updateCurrentPosition()
        }
      },
    )

    return () => {
      unsubscribePlayback()
      unsubscribeZoom()
      unsubscribeTimelineSettings()
    }
  }, [])

  useEffect(() => {
    const scrollContainer = playheadRef.current?.closest<HTMLDivElement>('.timeline-container')
    if (!scrollContainer) return

    const updateFromLinkedScrub = (event: Event) => {
      const { source, viewportProgress } = (event as CustomEvent<TimelineScrubVisualFrameDetail>)
        .detail
      if (source !== 'keyframe' || !playheadRef.current) return
      const viewportX = getTimelineScrubViewportX(viewportProgress, scrollContainer.clientWidth - 1)
      setTranslateXIfChanged(playheadRef.current, scrollContainer.scrollLeft + viewportX)
    }

    scrollContainer.addEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, updateFromLinkedScrub)
    return () => {
      scrollContainer.removeEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, updateFromLinkedScrub)
    }
  }, [])

  // Track external drag operations to disable pointer events on hit areas
  useEffect(() => {
    const handleDragStart = () => setIsExternalDrag(true)
    const handleDragEnd = () => setIsExternalDrag(false)

    document.addEventListener('dragstart', handleDragStart)
    document.addEventListener('dragend', handleDragEnd)
    document.addEventListener('drop', handleDragEnd)

    return () => {
      document.removeEventListener('dragstart', handleDragStart)
      document.removeEventListener('dragend', handleDragEnd)
      document.removeEventListener('drop', handleDragEnd)
    }
  }, [])

  // Handle drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Seeking is disabled during a voiceover take (see timeline-markers).
      if (isMicRecordingActive(useMicRecordingStore.getState().status)) return
      const playbackState = usePlaybackStore.getState()
      if (resumePlaybackRafRef.current !== null) {
        cancelAnimationFrame(resumePlaybackRafRef.current)
        resumePlaybackRafRef.current = null
        playbackState.cancelPlaybackScrubResume()
      }
      // Match ruler scrubbing: grabbing the playhead takes transport ownership
      // immediately so the playback clock cannot overwrite the drag.
      playbackState.beginPlaybackScrub()
      const { scrollContainer, coordinateSurface } = getPlayheadDragSurfaces({
        playhead: playheadRef.current,
        explicitCoordinateSurface: coordinateSurfaceRef?.current ?? null,
        inRuler,
      })
      const pointerX = getPlayheadPointerX(
        coordinateSurface,
        scrollContainer,
        e.clientX,
        frameToPixelsRef.current(playbackState.currentFrame),
      )
      scrubClientXRef.current = e.clientX
      scrubAnimationTimeRef.current = null
      scrubScrollContainerRef.current = scrollContainer
      scrubCoordinateSurfaceRef.current = coordinateSurface
      scrubPlayheadElementsRef.current = scrollContainer
        ? Array.from(scrollContainer.querySelectorAll<HTMLElement>('[data-timeline-playhead]'))
        : playheadRef.current
          ? [playheadRef.current]
          : []
      scrubThrottleStateRef.current = createScrubThrottleState({
        pointerX,
        frame: playbackState.currentFrame,
        nowMs: performance.now(),
      })
      isDraggingRef.current = true
      mainTimelineScrubActiveRef.current = true
      beginTimelineSkimmerScrub(skimmerScrubOwnerRef.current)
      setPreviewFrameRef.current(null)
      setIsDragging(true)
    },
    [coordinateSurfaceRef, inRuler],
  )

  // Handle dragging
  useEffect(() => {
    if (!isDragging) return
    const skimmerScrubOwner = skimmerScrubOwnerRef.current

    // Keep the horizontal scrub cursor stable while crossing timeline children.
    const originalCursor = document.body.style.cursor
    document.body.style.cursor = 'ew-resize'

    const runScrubLoop = (timestamp: number) => {
      rafIdRef.current = null
      const clientX = scrubClientXRef.current
      if (clientX === null) return

      withPerfMeasure('tl.raf.playheadScrub', () => {
        const scrollContainer = scrubScrollContainerRef.current
        const bounds = scrollContainer?.getBoundingClientRect()
        if (scrollContainer && bounds) {
          const velocity = getPlayheadEdgeScrollVelocity(clientX, bounds)
          const canScroll =
            (velocity < 0 && scrollContainer.scrollLeft > 0) ||
            (velocity > 0 &&
              scrollContainer.scrollLeft + scrollContainer.clientWidth <
                scrollContainer.scrollWidth)
          if (velocity !== 0 && canScroll) {
            const previousTimestamp = scrubAnimationTimeRef.current ?? timestamp - 1000 / 60
            scrollContainer.scrollLeft += getEdgeScrollDelta(velocity, timestamp, previousTimestamp)
            scrubAnimationTimeRef.current = timestamp
          } else {
            scrubAnimationTimeRef.current = null
          }
        }

        const coordinateSurface = scrubCoordinateSurfaceRef.current
        const coordinateBounds =
          coordinateSurface?.getBoundingClientRect() ?? scrollContainer?.getBoundingClientRect()
        if (!coordinateBounds) return

        const scrollLeft = scrollContainer?.scrollLeft ?? 0
        const coordinateScrollOffset = coordinateSurface ? 0 : scrollLeft
        const pointerX = clientX - coordinateBounds.left + coordinateScrollOffset
        let targetFrame = Math.max(0, Math.round(pixelsToFrameRef.current(pointerX)))
        if (maxFrameRef.current !== undefined) {
          targetFrame = Math.min(targetFrame, maxFrameRef.current)
        }

        if (
          shouldCommitScrubFrame({
            state: scrubThrottleStateRef.current,
            pointerX,
            targetFrame,
            pixelsPerSecond: pixelsPerSecondRef.current,
            nowMs: performance.now(),
          })
        ) {
          setScrubFrameRef.current(targetFrame)
        }

        const viewportBounds = scrollContainer?.getBoundingClientRect() ?? coordinateBounds
        // Match the committed playhead's integer-frame position during the
        // gesture so a stationary press/release cannot visibly settle sideways.
        const frameTimelineX = Math.round(frameToPixelsRef.current(targetFrame))
        const maxTimelineX =
          maxFrameRef.current === undefined
            ? undefined
            : Math.round(frameToPixelsRef.current(maxFrameRef.current))
        const visualTimelineX = Math.max(
          scrollLeft,
          Math.min(
            frameTimelineX,
            scrollLeft + Math.max(0, viewportBounds.width - 1),
            maxTimelineX ?? Number.POSITIVE_INFINITY,
          ),
        )
        for (const element of scrubPlayheadElementsRef.current) {
          setTranslateXIfChanged(element, visualTimelineX)
        }
        notifyTimelineScrubVisualFrame(scrollContainer, {
          frame: targetFrame,
          source: 'main',
          viewportProgress: getTimelineScrubViewportProgress(
            visualTimelineX - scrollLeft,
            viewportBounds.width - 1,
          ),
        })
      })

      if (isDraggingRef.current) rafIdRef.current = requestAnimationFrame(runScrubLoop)
    }

    const handleMouseMove = (e: MouseEvent) => {
      scrubClientXRef.current = e.clientX
    }

    const finishDrag = (resumePlayback: boolean) => {
      // Cancel any pending RAF before clearing preview to prevent resurrection
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }

      const clientX = scrubClientXRef.current
      const scrollContainer = scrubScrollContainerRef.current
      const coordinateSurface = scrubCoordinateSurfaceRef.current
      const bounds =
        coordinateSurface?.getBoundingClientRect() ?? scrollContainer?.getBoundingClientRect()
      if (clientX !== null && bounds) {
        const pointerX =
          clientX - bounds.left + (coordinateSurface ? 0 : (scrollContainer?.scrollLeft ?? 0))
        let frame = Math.max(0, Math.round(pixelsToFrameRef.current(pointerX)))
        if (maxFrameRef.current !== undefined) frame = Math.min(frame, maxFrameRef.current)
        setScrubFrameRef.current(frame)
      }

      isDraggingRef.current = false
      scrubClientXRef.current = null
      scrubAnimationTimeRef.current = null
      scrubScrollContainerRef.current = null
      scrubCoordinateSurfaceRef.current = null
      scrubPlayheadElementsRef.current = []
      setPreviewFrameRef.current(null)
      // Keep the shared flag set through the preview-clear notification so the
      // keyframe playhead retains the final scrub position until props settle.
      mainTimelineScrubActiveRef.current = false
      endTimelineSkimmerScrub(skimmerScrubOwner)
      setIsDragging(false)

      if (resumePlayback) {
        // Give the paused seek one paint boundary to settle before restarting.
        // Resuming in the mouseup event lets React batch pause + resume and the
        // previous playback clock can overwrite the released frame.
        resumePlaybackRafRef.current = requestAnimationFrame(() => {
          resumePlaybackRafRef.current = null
          usePlaybackStore.getState().resumePlaybackAfterScrub()
        })
      } else {
        usePlaybackStore.getState().cancelPlaybackScrubResume()
      }
    }
    const handleMouseUp = () => finishDrag(true)
    const handleWindowBlur = () => finishDrag(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleWindowBlur)
    rafIdRef.current = requestAnimationFrame(runScrubLoop)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleWindowBlur)
      // Restore original cursor
      document.body.style.cursor = originalCursor
      // Cancel any pending RAF to prevent memory leaks
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      scrubAnimationTimeRef.current = null
      mainTimelineScrubActiveRef.current = false
      endTimelineSkimmerScrub(skimmerScrubOwner)
    }
  }, [isDragging])

  return (
    <div
      ref={playheadRef}
      data-timeline-playhead={inRuler ? 'ruler' : 'tracks'}
      className="absolute top-0 bottom-0"
      style={{
        // left is set via ref subscription in useEffect (no re-renders during playback)
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* Shared line + (ruler-only) flag handle. */}
      <PlayheadMarks handle={inRuler ? 'flag' : 'none'} topOffsetPx={topOffsetPx} />

      {/* Invisible larger hit area over the flag — draggable to scrub. */}
      {inRuler && (
        <div
          data-playhead-handle
          className="absolute"
          style={{
            top: `${topOffsetPx}px`,
            left: '0px',
            width: '20px',
            height: '20px',
            transform: 'translateX(-50%)',
            cursor: activeToolRef.current === 'razor' ? 'default' : 'ew-resize',
            // Pass through pointer events in razor mode or during external drag operations
            pointerEvents: activeToolRef.current === 'razor' || isExternalDrag ? 'none' : 'auto',
            backgroundColor: 'transparent',
          }}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  )
}
