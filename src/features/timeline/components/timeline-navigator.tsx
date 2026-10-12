import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useItemsStore } from '../stores/items-store'
import { useZoomStore } from '../stores/zoom-store'
import { notifyTimelineLiveScroll } from '@/shared/timeline/live-scroll-sync'
import { getTimelineWidth } from '../utils/timeline-layout'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import { cn } from '@/shared/ui/cn'
import { attachWindowDragListeners } from '@/shared/utils/window-drag-listeners'
import { getNavigatorResizeDragResult, getNavigatorThumbMetrics } from './timeline-navigator-utils'

interface TimelineNavigatorProps {
  actualDuration: number
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

type DragTarget = 'thumb' | 'left' | 'right' | null

interface NavigatorDragSnapshot {
  startX: number
  lastX: number
  thumbLeft: number
  thumbWidth: number
  trackWidth: number
  timelineWidth: number
  scrollLeft: number
  maxScrollLeft: number
  thumbTravel: number
}

interface NavigatorDragPreview {
  timelineWidth: number
  scrollLeft: number
  thumbLeft: number
  thumbWidth: number
  zoom?: number
}

interface NavigatorViewHandoff {
  from: Pick<NavigatorDragPreview, 'timelineWidth' | 'scrollLeft'>
  to: Pick<NavigatorDragPreview, 'timelineWidth' | 'scrollLeft'>
  thumbLeft: number
  thumbWidth: number
}

interface NavigatorDragPreviewInput {
  dragTarget: Exclude<DragTarget, null>
  snapshot: NavigatorDragSnapshot
  deltaX: number
  viewportWidth: number
  contentDuration: number
}

function shouldRebaseDrag(snapshot: NavigatorDragSnapshot, nextTrackWidth: number): boolean {
  return nextTrackWidth > 0 && Math.abs(nextTrackWidth - snapshot.trackWidth) >= 0.5
}

function getDragView(
  snapshot: NavigatorDragSnapshot,
  preview: NavigatorDragPreview | null,
): Pick<NavigatorDragPreview, 'timelineWidth' | 'scrollLeft'> {
  if (preview) {
    return { timelineWidth: preview.timelineWidth, scrollLeft: preview.scrollLeft }
  }
  return { timelineWidth: snapshot.timelineWidth, scrollLeft: snapshot.scrollLeft }
}

function updateNavigatorThumb(
  thumb: HTMLDivElement | null,
  metrics: Pick<NavigatorDragPreview, 'thumbLeft' | 'thumbWidth'>,
): void {
  if (!thumb) return
  thumb.style.left = `${metrics.thumbLeft}px`
  thumb.style.width = `${metrics.thumbWidth}px`
}

function getNavigatorDragPreview({
  dragTarget,
  snapshot,
  deltaX,
  viewportWidth,
  contentDuration,
}: NavigatorDragPreviewInput): NavigatorDragPreview | null {
  if (dragTarget === 'thumb') {
    if (snapshot.thumbTravel <= 0 || snapshot.maxScrollLeft <= 0) return null
    const nextThumbLeft = Math.max(0, Math.min(snapshot.thumbTravel, snapshot.thumbLeft + deltaX))
    return {
      timelineWidth: snapshot.timelineWidth,
      scrollLeft: (nextThumbLeft / snapshot.thumbTravel) * snapshot.maxScrollLeft,
      thumbLeft: nextThumbLeft,
      thumbWidth: snapshot.thumbWidth,
    }
  }

  if (contentDuration <= 0) return null
  const result = getNavigatorResizeDragResult({
    dragTarget,
    deltaX,
    dragStartThumbLeft: snapshot.thumbLeft,
    dragStartThumbWidth: snapshot.thumbWidth,
    trackWidth: snapshot.trackWidth,
    viewportWidth,
    contentDuration,
  })
  const previewMetrics = getNavigatorThumbMetrics({
    timelineWidth: result.nextTimelineWidth,
    viewportWidth,
    trackWidth: snapshot.trackWidth,
    scrollLeft: result.nextScrollLeft,
  })
  return {
    timelineWidth: result.nextTimelineWidth,
    scrollLeft: result.nextScrollLeft,
    thumbLeft: previewMetrics.thumbLeft,
    thumbWidth: previewMetrics.thumbWidth,
    zoom: result.nextZoom,
  }
}

function isSameNavigatorView(
  timelineWidth: number,
  scrollLeft: number,
  view: Pick<NavigatorDragPreview, 'timelineWidth' | 'scrollLeft'>,
): boolean {
  return (
    Math.abs(timelineWidth - view.timelineWidth) < 0.5 &&
    Math.abs(scrollLeft - view.scrollLeft) < 0.5
  )
}

function isNavigatorViewHandoffState(
  timelineWidth: number,
  scrollLeft: number,
  handoff: NavigatorViewHandoff,
): boolean {
  const timelineWidthIsExpected =
    Math.abs(timelineWidth - handoff.from.timelineWidth) < 0.5 ||
    Math.abs(timelineWidth - handoff.to.timelineWidth) < 0.5
  const scrollLeftIsExpected =
    Math.abs(scrollLeft - handoff.from.scrollLeft) < 0.5 ||
    Math.abs(scrollLeft - handoff.to.scrollLeft) < 0.5
  return timelineWidthIsExpected && scrollLeftIsExpected
}

export function TimelineNavigator({ actualDuration, scrollContainerRef }: TimelineNavigatorProps) {
  perfMarkRender('TimelineNavigator')
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const dragRafRef = useRef<number | null>(null)
  const releaseScrollRafRef = useRef<number | null>(null)
  const dragSnapshotRef = useRef<NavigatorDragSnapshot | null>(null)
  const pendingPreviewRef = useRef<NavigatorDragPreview | null>(null)
  const latestPreviewRef = useRef<NavigatorDragPreview | null>(null)
  const viewHandoffRef = useRef<NavigatorViewHandoff | null>(null)
  const fps = useTimelineSettingsStore((s) => s.fps)
  const setZoomImmediate = useZoomStore((s) => s.setZoomLevelImmediate)
  const setZoomSynchronized = useZoomStore((s) => s.setZoomLevelSynchronized)
  const viewportWidth = useTimelineViewportStore((s) => s.viewportWidth)
  const livePixelsPerSecondRef = useRef(useZoomStore.getState().pixelsPerSecond)
  const liveScrollLeftRef = useRef(useTimelineViewportStore.getState().scrollLeft)

  const [trackWidth, setTrackWidth] = useState(0)
  const [dragTarget, setDragTarget] = useState<DragTarget>(null)

  const maxFrame = useItemsStore((s) => s.maxItemEndFrame)

  const contentDuration = useMemo(() => {
    const furthestEndSeconds = maxFrame / fps
    return Math.max(actualDuration, furthestEndSeconds, 10)
  }, [actualDuration, fps, maxFrame])

  // The timeline content deliberately defers its expensive settled geometry
  // while wheel zoom is active. The navigator is lightweight and should mirror
  // the live geometry so its thumb does not jump only after input settles.
  const navigatorTimelineWidth = getTimelineWidth({
    contentWidth: contentDuration * livePixelsPerSecondRef.current,
    viewportWidth,
  })
  const navigatorScrollLeft = liveScrollLeftRef.current

  const currentMetrics = getNavigatorThumbMetrics({
    timelineWidth: navigatorTimelineWidth,
    viewportWidth,
    trackWidth,
    scrollLeft: navigatorScrollLeft,
  })
  const handoff = viewHandoffRef.current
  const renderedMetrics = latestPreviewRef.current
    ? {
        ...currentMetrics,
        thumbLeft: latestPreviewRef.current.thumbLeft,
        thumbWidth: latestPreviewRef.current.thumbWidth,
      }
    : handoff && isNavigatorViewHandoffState(navigatorTimelineWidth, navigatorScrollLeft, handoff)
      ? { ...currentMetrics, thumbLeft: handoff.thumbLeft, thumbWidth: handoff.thumbWidth }
      : currentMetrics
  const { thumbWidth, thumbLeft } = renderedMetrics

  const setScrollLeftOnContainer = useCallback(
    (nextScrollLeft: number) => {
      const node = scrollContainerRef.current
      if (!node) return
      node.scrollLeft = nextScrollLeft
      liveScrollLeftRef.current = node.scrollLeft
      // The Edit keyframe lane lives outside this native scroller. Publish the
      // navigator's zoom/pan geometry in the same RAF as the DOM write so it can
      // update its compositor transform before paint instead of waiting for the
      // browser's later native scroll event. This is intentionally imperative:
      // no React/store update is added to the pointer hot path.
      notifyTimelineLiveScroll(node)
    },
    [scrollContainerRef],
  )

  const getLiveNavigatorMetrics = useCallback(() => {
    const nextTrackWidth = trackRef.current?.clientWidth ?? trackWidth
    const nextPixelsPerSecond = useZoomStore.getState().pixelsPerSecond
    const nextScrollLeft = scrollContainerRef.current?.scrollLeft ?? liveScrollLeftRef.current
    const nextTimelineWidth = getTimelineWidth({
      contentWidth: contentDuration * nextPixelsPerSecond,
      viewportWidth,
    })

    livePixelsPerSecondRef.current = nextPixelsPerSecond
    liveScrollLeftRef.current = nextScrollLeft
    return {
      timelineWidth: nextTimelineWidth,
      scrollLeft: nextScrollLeft,
      metrics: getNavigatorThumbMetrics({
        timelineWidth: nextTimelineWidth,
        viewportWidth,
        trackWidth: nextTrackWidth,
        scrollLeft: nextScrollLeft,
      }),
    }
  }, [contentDuration, scrollContainerRef, trackWidth, viewportWidth])

  const syncThumbToLiveGeometry = useCallback(() => {
    if (dragSnapshotRef.current || !thumbRef.current) return
    const live = getLiveNavigatorMetrics()
    updateNavigatorThumb(thumbRef.current, live.metrics)
  }, [getLiveNavigatorMetrics])

  const rebaseActiveDragToTrackWidth = useCallback(
    (nextTrackWidth: number) => {
      const snapshot = dragSnapshotRef.current
      if (!snapshot) return
      if (!shouldRebaseDrag(snapshot, nextTrackWidth)) return

      const preview = latestPreviewRef.current
      const { timelineWidth: nextTimelineWidth, scrollLeft: nextScrollLeft } = getDragView(
        snapshot,
        preview,
      )
      const nextMetrics = getNavigatorThumbMetrics({
        timelineWidth: nextTimelineWidth,
        viewportWidth,
        trackWidth: nextTrackWidth,
        scrollLeft: nextScrollLeft,
      })

      dragSnapshotRef.current = {
        ...snapshot,
        startX: snapshot.lastX,
        thumbLeft: nextMetrics.thumbLeft,
        thumbWidth: nextMetrics.thumbWidth,
        trackWidth: nextTrackWidth,
        timelineWidth: nextTimelineWidth,
        scrollLeft: nextScrollLeft,
        maxScrollLeft: nextMetrics.maxScrollLeft,
        thumbTravel: nextMetrics.thumbTravel,
      }

      if (!preview) return
      const rebasedPreview = {
        ...preview,
        thumbLeft: nextMetrics.thumbLeft,
        thumbWidth: nextMetrics.thumbWidth,
      }
      latestPreviewRef.current = rebasedPreview
      if (pendingPreviewRef.current) pendingPreviewRef.current = rebasedPreview
      updateNavigatorThumb(thumbRef.current, nextMetrics)
    },
    [viewportWidth],
  )

  const handleMouseDown = useCallback(
    (event: React.MouseEvent, target: Exclude<DragTarget, null>) => {
      event.preventDefault()
      event.stopPropagation()
      if (releaseScrollRafRef.current !== null) {
        cancelAnimationFrame(releaseScrollRafRef.current)
        releaseScrollRafRef.current = null
      }
      const live = getLiveNavigatorMetrics()
      dragSnapshotRef.current = {
        startX: event.clientX,
        lastX: event.clientX,
        thumbLeft: live.metrics.thumbLeft,
        thumbWidth: live.metrics.thumbWidth,
        trackWidth: trackRef.current?.clientWidth ?? trackWidth,
        timelineWidth: live.timelineWidth,
        scrollLeft: live.scrollLeft,
        maxScrollLeft: live.metrics.maxScrollLeft,
        thumbTravel: live.metrics.thumbTravel,
      }
      latestPreviewRef.current = null
      pendingPreviewRef.current = null
      viewHandoffRef.current = null
      setDragTarget(target)
    },
    [getLiveNavigatorMetrics, trackWidth],
  )

  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const live = getLiveNavigatorMetrics()
      if (
        !trackRef.current ||
        dragTarget ||
        live.metrics.maxScrollLeft <= 0 ||
        live.metrics.thumbTravel <= 0
      ) {
        return
      }

      const rect = trackRef.current.getBoundingClientRect()
      const clickX = event.clientX - rect.left
      const desiredThumbLeft = Math.max(
        0,
        Math.min(live.metrics.thumbTravel, clickX - live.metrics.thumbWidth / 2),
      )
      const nextScrollLeft =
        (desiredThumbLeft / live.metrics.thumbTravel) * live.metrics.maxScrollLeft
      setScrollLeftOnContainer(nextScrollLeft)
    },
    [dragTarget, getLiveNavigatorMetrics, setScrollLeftOnContainer],
  )

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    setTrackWidth(track.clientWidth)

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const nextTrackWidth = entry.contentRect.width
        rebaseActiveDragToTrackWidth(nextTrackWidth)
        setTrackWidth(nextTrackWidth)
      }
    })

    observer.observe(track)

    return () => {
      observer.disconnect()
    }
  }, [rebaseActiveDragToTrackWidth])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    let microtaskQueued = false
    let disposed = false
    const scheduleSynchronizedUpdate = () => {
      if (microtaskQueued) return
      microtaskQueued = true
      queueMicrotask(() => {
        microtaskQueued = false
        if (!disposed) syncThumbToLiveGeometry()
      })
    }
    const handleScroll = () => syncThumbToLiveGeometry()
    const unsubscribeZoom = useZoomStore.subscribe((state, previousState) => {
      if (state.pixelsPerSecond !== previousState.pixelsPerSecond) {
        scheduleSynchronizedUpdate()
      }
    })

    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      disposed = true
      unsubscribeZoom()
      scrollContainer?.removeEventListener('scroll', handleScroll)
    }
  }, [scrollContainerRef, syncThumbToLiveGeometry])

  useLayoutEffect(() => {
    const nextHandoff = viewHandoffRef.current
    if (
      nextHandoff &&
      (isSameNavigatorView(navigatorTimelineWidth, navigatorScrollLeft, nextHandoff.to) ||
        !isNavigatorViewHandoffState(navigatorTimelineWidth, navigatorScrollLeft, nextHandoff))
    ) {
      viewHandoffRef.current = null
    }
    if (dragTarget || !thumbRef.current) return
    thumbRef.current.style.left = `${renderedMetrics.thumbLeft}px`
    thumbRef.current.style.width = `${renderedMetrics.thumbWidth}px`
  }, [
    dragTarget,
    navigatorScrollLeft,
    navigatorTimelineWidth,
    renderedMetrics.thumbLeft,
    renderedMetrics.thumbWidth,
  ])

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
      }
      if (releaseScrollRafRef.current !== null) {
        cancelAnimationFrame(releaseScrollRafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const activeDragTarget = dragTarget
    if (!activeDragTarget) return

    const flush = () => {
      dragRafRef.current = null
      const preview = pendingPreviewRef.current
      pendingPreviewRef.current = null
      if (!preview) return
      if (preview.zoom !== undefined) setZoomImmediate(preview.zoom)
      setScrollLeftOnContainer(preview.scrollLeft)
    }

    const handleMouseMove = (event: MouseEvent) => {
      const measuredTrackWidth = trackRef.current?.clientWidth
      if (measuredTrackWidth !== undefined) {
        rebaseActiveDragToTrackWidth(measuredTrackWidth)
      }
      const snapshot = dragSnapshotRef.current
      if (!snapshot || snapshot.trackWidth <= 0) return

      const deltaX = event.clientX - snapshot.startX
      const preview = getNavigatorDragPreview({
        dragTarget: activeDragTarget,
        snapshot,
        deltaX,
        viewportWidth,
        contentDuration,
      })
      if (!preview) return

      latestPreviewRef.current = preview
      pendingPreviewRef.current = preview
      dragSnapshotRef.current = { ...snapshot, lastX: event.clientX }
      updateNavigatorThumb(thumbRef.current, preview)
      if (dragRafRef.current !== null) return
      dragRafRef.current = requestAnimationFrame(flush)
    }

    const handleMouseUp = () => {
      const measuredTrackWidth = trackRef.current?.clientWidth
      if (measuredTrackWidth !== undefined) {
        rebaseActiveDragToTrackWidth(measuredTrackWidth)
      }
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      flush()
      const snapshot = dragSnapshotRef.current
      const finalPreview = latestPreviewRef.current
      if (finalPreview?.zoom !== undefined) {
        // The live resize uses deferred content geometry for responsiveness.
        // Settle that geometry before the final scroll write so a later width
        // commit cannot clamp the old scroll position and move the navigator
        // after the pointer has already been released.
        setZoomSynchronized(finalPreview.zoom)
        setScrollLeftOnContainer(finalPreview.scrollLeft)
        releaseScrollRafRef.current = requestAnimationFrame(() => {
          releaseScrollRafRef.current = null
          setScrollLeftOnContainer(finalPreview.scrollLeft)
        })
      }
      viewHandoffRef.current =
        snapshot && finalPreview
          ? {
              from: {
                timelineWidth: snapshot.timelineWidth,
                scrollLeft: snapshot.scrollLeft,
              },
              to: {
                timelineWidth: finalPreview.timelineWidth,
                scrollLeft: finalPreview.scrollLeft,
              },
              thumbLeft: finalPreview.thumbLeft,
              thumbWidth: finalPreview.thumbWidth,
            }
          : null
      latestPreviewRef.current = null
      dragSnapshotRef.current = null
      setDragTarget(null)
    }

    const detachWindowDragListeners = attachWindowDragListeners(
      handleMouseMove,
      handleMouseUp,
      dragRafRef,
    )

    return () => {
      detachWindowDragListeners()
      pendingPreviewRef.current = null
    }
  }, [
    contentDuration,
    dragTarget,
    rebaseActiveDragToTrackWidth,
    setZoomImmediate,
    setZoomSynchronized,
    setScrollLeftOnContainer,
    viewportWidth,
  ])

  return (
    <div className="h-5 border-t border-border bg-background/80 px-2 py-1">
      <div
        ref={trackRef}
        className="relative h-full rounded-sm bg-secondary/70"
        onClick={handleTrackClick}
      >
        <div
          ref={thumbRef}
          className={cn(
            'absolute top-0 flex h-full items-center justify-between rounded-sm bg-muted-foreground/55 transition-colors',
            dragTarget
              ? 'cursor-grabbing bg-muted-foreground/75'
              : 'cursor-grab hover:bg-muted-foreground/70',
          )}
          style={{
            left: thumbLeft,
            width: thumbWidth,
          }}
          onMouseDown={(event) => handleMouseDown(event, 'thumb')}
          onClick={(event) => event.stopPropagation()}
          data-testid="timeline-navigator-thumb"
        >
          <div
            data-testid="timeline-navigator-left-handle"
            className="flex h-full w-3 items-center justify-center cursor-ew-resize"
            onMouseDown={(event) => handleMouseDown(event, 'left')}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-background/90" />
          </div>
          <div className="h-2 w-8 rounded-full bg-background/20" />
          <div
            data-testid="timeline-navigator-right-handle"
            className="flex h-full w-3 items-center justify-center cursor-ew-resize"
            onMouseDown={(event) => handleMouseDown(event, 'right')}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-background/90" />
          </div>
        </div>
      </div>
    </div>
  )
}
