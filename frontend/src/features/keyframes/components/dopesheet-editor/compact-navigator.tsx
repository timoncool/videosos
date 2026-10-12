import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/shared/ui/cn'
import { attachWindowDragListeners } from '@/shared/utils/window-drag-listeners'

import {
  getKeyframeNavigatorResizeDragResult,
  getKeyframeNavigatorThumbMetrics,
  getStartFrameFromNavigatorThumbLeft,
  type KeyframeNavigatorDragTarget,
  type KeyframeNavigatorViewport,
} from './compact-navigator-utils'

interface CompactNavigatorProps {
  viewport: KeyframeNavigatorViewport
  currentFrame: number
  contentFrameMax: number
  minVisibleFrames: number
  disabled?: boolean
  onViewportChange: (viewport: KeyframeNavigatorViewport) => void
  onViewportPreviewStart?: () => void
  onViewportPreview?: (viewport: KeyframeNavigatorViewport | null) => void
}

type DragTarget = 'thumb' | KeyframeNavigatorDragTarget | null

interface NavigatorDragSnapshot {
  startX: number
  thumbLeft: number
  thumbWidth: number
  trackWidth: number
  viewport: KeyframeNavigatorViewport
  metrics: ReturnType<typeof getKeyframeNavigatorThumbMetrics>
}

interface NavigatorViewportHandoff {
  from: KeyframeNavigatorViewport
  to: KeyframeNavigatorViewport
}

function isSameViewport(a: KeyframeNavigatorViewport, b: KeyframeNavigatorViewport): boolean {
  return a.startFrame === b.startFrame && a.endFrame === b.endFrame
}

export function CompactNavigator({
  viewport,
  currentFrame,
  contentFrameMax,
  minVisibleFrames,
  disabled = false,
  onViewportChange,
  onViewportPreviewStart,
  onViewportPreview,
}: CompactNavigatorProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [dragTarget, setDragTarget] = useState<DragTarget>(null)
  const dragSnapshotRef = useRef<NavigatorDragSnapshot | null>(null)
  const latestPreviewViewportRef = useRef<KeyframeNavigatorViewport | null>(null)
  const viewportHandoffRef = useRef<NavigatorViewportHandoff | null>(null)
  const pendingPreviewViewportRef = useRef<KeyframeNavigatorViewport | null>(null)
  const previewAnimationFrameRef = useRef<number | null>(null)
  const viewportHandoff = viewportHandoffRef.current
  const settledViewport =
    viewportHandoff && isSameViewport(viewport, viewportHandoff.from)
      ? viewportHandoff.to
      : viewport
  const renderedViewport = latestPreviewViewportRef.current ?? settledViewport

  const metrics = getKeyframeNavigatorThumbMetrics({
    viewport: renderedViewport,
    contentFrameMax,
    trackWidth,
  })

  const playheadLeft =
    trackWidth > 0
      ? Math.max(
          metrics.edgeInset,
          Math.min(
            metrics.edgeInset + metrics.usableTrackWidth,
            metrics.edgeInset +
              (Math.max(0, Math.min(metrics.contentFrameMax, currentFrame)) /
                metrics.contentFrameMax) *
                metrics.usableTrackWidth,
          ),
        )
      : 0

  const handleMouseDown = useCallback(
    (event: React.MouseEvent, target: Exclude<DragTarget, null>) => {
      if (disabled) return
      event.preventDefault()
      event.stopPropagation()
      const nextTrackWidth = trackRef.current?.clientWidth ?? trackWidth
      const startMetrics = getKeyframeNavigatorThumbMetrics({
        viewport: renderedViewport,
        contentFrameMax,
        trackWidth: nextTrackWidth,
      })
      dragSnapshotRef.current = {
        startX: event.clientX,
        thumbLeft: startMetrics.thumbLeft,
        thumbWidth: startMetrics.thumbWidth,
        trackWidth: nextTrackWidth,
        viewport: renderedViewport,
        metrics: startMetrics,
      }
      viewportHandoffRef.current = null
      latestPreviewViewportRef.current = null
      onViewportPreviewStart?.()
      setDragTarget(target)
    },
    [contentFrameMax, disabled, onViewportPreviewStart, renderedViewport, trackWidth],
  )

  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        disabled ||
        !trackRef.current ||
        dragTarget ||
        metrics.maxStartFrame <= 0 ||
        metrics.thumbTravel <= 0
      ) {
        return
      }

      const rect = trackRef.current.getBoundingClientRect()
      const clickX = event.clientX - rect.left
      const desiredThumbLeft = Math.max(
        metrics.edgeInset,
        Math.min(metrics.edgeInset + metrics.thumbTravel, clickX - metrics.thumbWidth / 2),
      )
      const nextStartFrame = getStartFrameFromNavigatorThumbLeft(desiredThumbLeft, metrics)
      onViewportChange({
        startFrame: nextStartFrame,
        endFrame: nextStartFrame + metrics.visibleFrameRange,
      })
    },
    [disabled, dragTarget, metrics, onViewportChange],
  )

  useLayoutEffect(() => {
    const handoff = viewportHandoffRef.current
    if (
      handoff &&
      (isSameViewport(viewport, handoff.to) || !isSameViewport(viewport, handoff.from))
    ) {
      viewportHandoffRef.current = null
    }
    if (dragTarget || !thumbRef.current) return
    thumbRef.current.style.left = `${metrics.thumbLeft}px`
    thumbRef.current.style.width = `${metrics.thumbWidth}px`
  }, [dragTarget, metrics.thumbLeft, metrics.thumbWidth, viewport])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const updateWidth = () => {
      setTrackWidth(track.clientWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!dragTarget || disabled) return

    const handleMouseMove = (event: MouseEvent) => {
      const snapshot = dragSnapshotRef.current
      if (!snapshot || snapshot.trackWidth <= 0) return

      const deltaX = event.clientX - snapshot.startX
      let nextViewport: KeyframeNavigatorViewport

      if (dragTarget === 'thumb') {
        if (snapshot.metrics.thumbTravel <= 0 || snapshot.metrics.maxStartFrame <= 0) return
        const nextThumbLeft = Math.max(
          snapshot.metrics.edgeInset,
          Math.min(
            snapshot.metrics.edgeInset + snapshot.metrics.thumbTravel,
            snapshot.thumbLeft + deltaX,
          ),
        )
        const nextStartFrame = getStartFrameFromNavigatorThumbLeft(nextThumbLeft, snapshot.metrics)
        nextViewport = {
          startFrame: nextStartFrame,
          endFrame: nextStartFrame + snapshot.metrics.visibleFrameRange,
        }
      } else {
        nextViewport = getKeyframeNavigatorResizeDragResult({
          dragTarget,
          deltaX,
          dragStartThumbWidth: snapshot.thumbWidth,
          trackWidth: snapshot.trackWidth,
          viewport: snapshot.viewport,
          contentFrameMax,
          minVisibleFrames,
        })
      }

      latestPreviewViewportRef.current = nextViewport
      const previewMetrics = getKeyframeNavigatorThumbMetrics({
        viewport: nextViewport,
        contentFrameMax,
        trackWidth: snapshot.trackWidth,
      })
      if (thumbRef.current) {
        thumbRef.current.style.left = `${previewMetrics.thumbLeft}px`
        thumbRef.current.style.width = `${previewMetrics.thumbWidth}px`
      }
      pendingPreviewViewportRef.current = nextViewport
      if (previewAnimationFrameRef.current === null) {
        previewAnimationFrameRef.current = requestAnimationFrame(() => {
          previewAnimationFrameRef.current = null
          const pendingViewport = pendingPreviewViewportRef.current
          pendingPreviewViewportRef.current = null
          if (!pendingViewport) return
          if (onViewportPreview) onViewportPreview(pendingViewport)
          else onViewportChange(pendingViewport)
        })
      }
    }

    const handleMouseUp = () => {
      if (previewAnimationFrameRef.current !== null) {
        cancelAnimationFrame(previewAnimationFrameRef.current)
        previewAnimationFrameRef.current = null
      }
      pendingPreviewViewportRef.current = null
      const finalViewport = latestPreviewViewportRef.current
      if (finalViewport) {
        const dragStartViewport = dragSnapshotRef.current?.viewport
        viewportHandoffRef.current =
          dragStartViewport && !isSameViewport(dragStartViewport, finalViewport)
            ? { from: dragStartViewport, to: finalViewport }
            : null
        onViewportPreview?.(finalViewport)
        onViewportChange(finalViewport)
      }
      onViewportPreview?.(null)
      latestPreviewViewportRef.current = null
      dragSnapshotRef.current = null
      setDragTarget(null)
    }

    const detachWindowDragListeners = attachWindowDragListeners(
      handleMouseMove,
      handleMouseUp,
      previewAnimationFrameRef,
    )

    return () => {
      detachWindowDragListeners()
      pendingPreviewViewportRef.current = null
      if (dragSnapshotRef.current) onViewportPreview?.(null)
    }
  }, [contentFrameMax, disabled, dragTarget, minVisibleFrames, onViewportChange, onViewportPreview])

  return (
    <div className="h-5 border-t border-border bg-background/80 px-2 py-1">
      <div
        ref={trackRef}
        className={cn('relative h-full rounded-sm bg-secondary/70', disabled && 'opacity-50')}
        onClick={handleTrackClick}
      >
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-primary/70"
          style={{ left: playheadLeft }}
        />
        <div
          ref={thumbRef}
          className={cn(
            'absolute top-0 flex h-full items-center justify-between rounded-sm bg-muted-foreground/55 transition-colors',
            disabled
              ? 'cursor-default'
              : dragTarget
                ? 'cursor-grabbing bg-muted-foreground/75'
                : 'cursor-grab hover:bg-muted-foreground/70',
          )}
          style={{
            left: metrics.thumbLeft,
            width: metrics.thumbWidth,
          }}
          onMouseDown={disabled ? undefined : (event) => handleMouseDown(event, 'thumb')}
          onClick={(event) => event.stopPropagation()}
          data-testid="keyframe-navigator-thumb"
        >
          <div
            data-testid="keyframe-navigator-left-handle"
            className={cn(
              'flex h-full w-2 items-center justify-center',
              disabled ? 'cursor-default' : 'cursor-ew-resize',
            )}
            onMouseDown={disabled ? undefined : (event) => handleMouseDown(event, 'left')}
          >
            <div className="h-1.5 w-0.5 rounded-full bg-background/90" />
          </div>
          <div className="h-1.5 w-5 rounded-full bg-background/25" />
          <div
            data-testid="keyframe-navigator-right-handle"
            className={cn(
              'flex h-full w-2 items-center justify-center',
              disabled ? 'cursor-default' : 'cursor-ew-resize',
            )}
            onMouseDown={disabled ? undefined : (event) => handleMouseDown(event, 'right')}
          >
            <div className="h-1.5 w-0.5 rounded-full bg-background/90" />
          </div>
        </div>
      </div>
    </div>
  )
}
