import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import {
  computeLiveViewportWaveformCanvasGeometry,
  computeTimelineWaveformCanvasGeometry,
  computeVisibleWaveformCanvasGeometry,
  type VisibleWaveformCanvasGeometry,
} from './visible-waveform-canvas-geometry'
import { useTimelineViewportStore } from '../../stores/timeline-viewport-store'
import { useZoomStore } from '../../stores/zoom-store'
import { TILE_WIDTH as TILED_CANVAS_TILE_WIDTH } from '../clip-filmstrip/tiled-canvas'
import { getWaveformZoomRedrawIntervalMs } from './adaptive-render-version'
import {
  cancelTimelineCanvasUpdate,
  scheduleTimelineCanvasUpdate,
} from '../timeline-canvas-update-scheduler'

interface VisibleWaveformCanvasProps {
  /** Total logical width of the clip waveform. */
  width: number
  height: number
  /** Visible logical pixel range within the clip. */
  visibleStartPx: number
  visibleEndPx: number
  /**
   * Changes when the viewport ratios change. Unlike the pixel range, this stays
   * stable while zoom geometry is changing, so zoom redraws remain throttled by
   * `version`.
   */
  viewportVersion: string
  /** Throttled content/zoom version. */
  version: string | number
  /** Waveform data revision, excluding zoom-only changes. */
  contentVersion?: string | number
  /** Track the real live clip/viewport intersection before drawing. */
  liveTimelineViewport?: boolean
  liveViewportOverscanPx?: number
  renderWindow: (
    ctx: CanvasRenderingContext2D,
    windowOffsetPx: number,
    windowWidthPx: number,
  ) => void
}

interface LiveTimelineSnapshot {
  pixelsPerSecond: number
  scrollLeft: number
  viewportWidth: number
}

function getLiveTimelineSnapshot(): LiveTimelineSnapshot {
  const { pixelsPerSecond } = useZoomStore.getState()
  const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState()
  return {
    pixelsPerSecond,
    scrollLeft,
    viewportWidth,
  }
}

function parseRequiredFiniteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseOptionalInset(value: string | undefined): number | null {
  if (value === undefined) return 0
  const number = parseRequiredFiniteNumber(value)
  return number !== null && number >= 0 ? number : null
}

function computeLiveTimelineGeometryFromItem(
  timelineItem: HTMLElement | null,
  snapshot: LiveTimelineSnapshot,
  overscanPx: number,
): VisibleWaveformCanvasGeometry | null {
  if (!timelineItem) return null

  const transform = timelineItem.style.transform.trim()
  if (transform !== '' && transform !== 'none') {
    return null
  }

  const startFrame = parseRequiredFiniteNumber(timelineItem.dataset.timelineStartFrame)
  const durationFrames = parseRequiredFiniteNumber(timelineItem.dataset.timelineDurationFrames)
  const fps = parseRequiredFiniteNumber(timelineItem.dataset.timelineFps)
  const contentInsetStartPx = parseOptionalInset(timelineItem.dataset.timelineContentInsetStartPx)
  const contentInsetEndPx = parseOptionalInset(timelineItem.dataset.timelineContentInsetEndPx)
  if (
    startFrame === null ||
    durationFrames === null ||
    fps === null ||
    contentInsetStartPx === null ||
    contentInsetEndPx === null
  ) {
    return null
  }

  return computeTimelineWaveformCanvasGeometry({
    startFrame,
    durationFrames,
    fps,
    pixelsPerSecond: snapshot.pixelsPerSecond,
    scrollLeft: snapshot.scrollLeft,
    viewportWidth: snapshot.viewportWidth,
    overscanPx,
    contentInsetStartPx,
    contentInsetEndPx,
  })
}

function measureLiveTimelineGeometry(
  canvas: HTMLCanvasElement,
  overscanPx: number,
  timelineViewport = canvas.closest<HTMLElement>('[data-timeline-scroll-container]'),
  viewportRectCache?: Map<HTMLElement, DOMRect>,
): VisibleWaveformCanvasGeometry | null {
  const host = canvas.parentElement
  if (!host || !timelineViewport) return null

  const hostRect = host.getBoundingClientRect()
  let viewportRect = viewportRectCache?.get(timelineViewport)
  if (!viewportRect) {
    viewportRect = timelineViewport.getBoundingClientRect()
    viewportRectCache?.set(timelineViewport, viewportRect)
  }
  return computeLiveViewportWaveformCanvasGeometry({
    hostLeft: hostRect.left,
    hostWidth: hostRect.width,
    viewportLeft: viewportRect.left,
    viewportWidth: viewportRect.width,
    overscanPx,
  })
}

interface LiveCanvasRegistration {
  canvas: HTMLCanvasElement
  timelineItem: HTMLElement | null
  timelineViewport: HTMLElement | null
  overscanPx: number
  lastPixelsPerSecond: number
  redraw: (geometry: VisibleWaveformCanvasGeometry) => void
}

const liveCanvasRegistrations = new Set<LiveCanvasRegistration>()
const liveWaveformCanvasUpdateKey = {}
let unsubscribeLiveCanvasZoom: (() => void) | null = null
let unsubscribeLiveCanvasViewport: (() => void) | null = null

function flushLiveCanvasPositionUpdate(): void {
  const snapshot = getLiveTimelineSnapshot()
  let viewportRectCache: Map<HTMLElement, DOMRect> | undefined
  const updates: Array<{
    registration: LiveCanvasRegistration
    geometry: VisibleWaveformCanvasGeometry
    needsRedraw: boolean
  }> = []

    // Timeline items use arithmetic from the shared live zoom/viewport snapshot.
    // Only transformed items or legacy/malformed markup fall back to DOM reads.
    // Read every fallback rect before writing any style to avoid layout thrash.
  for (const registration of liveCanvasRegistrations) {
    if (!registration.canvas.isConnected) continue
    let geometry = computeLiveTimelineGeometryFromItem(
      registration.timelineItem,
      snapshot,
      registration.overscanPx,
    )
    if (!geometry) {
      viewportRectCache ??= new Map<HTMLElement, DOMRect>()
      geometry = measureLiveTimelineGeometry(
        registration.canvas,
        registration.overscanPx,
        registration.timelineViewport,
        viewportRectCache,
      )
    }
    if (geometry && geometry.width > 0) {
      const currentWidth = Number.parseFloat(registration.canvas.style.width) || 0
      updates.push({
        registration,
        geometry,
        needsRedraw:
          registration.canvas.style.display === 'none' ||
          currentWidth + 0.5 < geometry.width ||
          Math.abs(registration.lastPixelsPerSecond - snapshot.pixelsPerSecond) > 0.001,
      })
    }
  }
  for (const update of updates) {
    if (update.needsRedraw) {
        // A scale change needs real new pixels even when the bounded window is
        // shrinking. Redraw imperatively from the current live store snapshot;
        // React remains on settled geometry and therefore cannot fan out one
        // state update per waveform during the wheel gesture.
      update.registration.redraw(update.geometry)
      update.registration.lastPixelsPerSecond = snapshot.pixelsPerSecond
    } else {
        // Keep the existing sharp bitmap and backing size; only move it into the
        // new viewport window until the cadence-limited redraw catches up.
      update.registration.canvas.style.left = `${update.geometry.left}px`
    }
  }
}

function getLiveWaveformTileWork(): number {
  let tileCount = 0
  for (const registration of liveCanvasRegistrations) {
    if (!registration.canvas.isConnected) continue
    const width = Number.parseFloat(registration.canvas.style.width) || 0
    tileCount += Math.max(1, Math.ceil(width / TILED_CANVAS_TILE_WIDTH))
  }
  return tileCount
}

function scheduleLiveCanvasPositionUpdate(): void {
  scheduleTimelineCanvasUpdate(
    liveWaveformCanvasUpdateKey,
    flushLiveCanvasPositionUpdate,
    getWaveformZoomRedrawIntervalMs(getLiveWaveformTileWork()),
  )
}

function registerLiveCanvasPositionUpdates(
  canvas: HTMLCanvasElement,
  overscanPx: number,
  redraw: (geometry: VisibleWaveformCanvasGeometry) => void,
): () => void {
  const registration = {
    canvas,
    timelineItem: canvas.closest<HTMLElement>('[data-timeline-item]'),
    timelineViewport: canvas.closest<HTMLElement>('[data-timeline-scroll-container]'),
    overscanPx,
    lastPixelsPerSecond: useZoomStore.getState().pixelsPerSecond,
    redraw,
  }
  liveCanvasRegistrations.add(registration)
  if (!unsubscribeLiveCanvasZoom) {
    unsubscribeLiveCanvasZoom = useZoomStore.subscribe((state, previousState) => {
      if (state.pixelsPerSecond !== previousState.pixelsPerSecond) {
        scheduleLiveCanvasPositionUpdate()
      }
    })
  }
  if (!unsubscribeLiveCanvasViewport) {
    unsubscribeLiveCanvasViewport = useTimelineViewportStore.subscribe((state, previousState) => {
      if (
        state.scrollLeft !== previousState.scrollLeft ||
        state.viewportWidth !== previousState.viewportWidth
      ) {
        scheduleLiveCanvasPositionUpdate()
      }
    })
  }

  return () => {
    liveCanvasRegistrations.delete(registration)
    if (liveCanvasRegistrations.size === 0 && unsubscribeLiveCanvasZoom) {
      unsubscribeLiveCanvasZoom()
      unsubscribeLiveCanvasZoom = null
    }
    if (liveCanvasRegistrations.size === 0 && unsubscribeLiveCanvasViewport) {
      unsubscribeLiveCanvasViewport()
      unsubscribeLiveCanvasViewport = null
    }
    if (liveCanvasRegistrations.size === 0) {
      cancelTimelineCanvasUpdate(liveWaveformCanvasUpdateKey)
    }
  }
}

/**
 * A single viewport-bounded waveform canvas.
 *
 * The element's CSS size and backing bitmap are committed together. In
 * particular, width changes never stretch an older bitmap while a zoom redraw
 * is waiting for its cadence-limited commit.
 */
export const VisibleWaveformCanvas = memo(function VisibleWaveformCanvas({
  width,
  height,
  visibleStartPx,
  visibleEndPx,
  version,
  contentVersion,
  liveTimelineViewport = false,
  liveViewportOverscanPx = 0,
  renderWindow,
}: VisibleWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const redrawGeometryRef = useRef<(geometry: VisibleWaveformCanvasGeometry) => void>(() => {})
  const lastDrawRef = useRef<{
    left: number
    width: number
    height: number
    backingWidth: number
    backingHeight: number
    renderWindow: VisibleWaveformCanvasProps['renderWindow']
    renderRevision: string | number | null
  } | null>(null)

  useEffect(() => {
    if (!liveTimelineViewport) return
    const canvas = canvasRef.current
    if (!canvas) return
    return registerLiveCanvasPositionUpdates(canvas, liveViewportOverscanPx, (geometry) => {
      redrawGeometryRef.current(geometry)
    })
  }, [liveTimelineViewport, liveViewportOverscanPx])

  const redrawGeometry = useCallback(
    (geometry: VisibleWaveformCanvasGeometry) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (geometry.width <= 0 || height <= 0) {
        canvas.style.display = 'none'
        lastDrawRef.current = null
        return
      }

      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const backingWidth = Math.max(1, Math.ceil(geometry.width * dpr))
      const backingHeight = Math.max(1, Math.ceil(height * dpr))
      const renderRevision = liveTimelineViewport
        ? `${contentVersion ?? version}:${useZoomStore.getState().pixelsPerSecond}`
        : version
      const previousDraw = lastDrawRef.current
      if (
        canvas.style.display !== 'none' &&
        previousDraw !== null &&
        Math.abs(previousDraw.left - geometry.left) < 0.01 &&
        Math.abs(previousDraw.width - geometry.width) < 0.01 &&
        previousDraw.height === height &&
        previousDraw.backingWidth === backingWidth &&
        previousDraw.backingHeight === backingHeight &&
        previousDraw.renderWindow === renderWindow &&
        previousDraw.renderRevision === renderRevision
      ) {
        return
      }

      // Assigning either backing dimension resets the 2D context even when the
      // value is unchanged. Preserve it for content-only redraws while still
      // resizing to the exact rounded DPR dimensions whenever geometry changes.
      canvas.style.display = 'block'
      canvas.style.left = `${geometry.left}px`
      canvas.style.width = `${geometry.width}px`
      canvas.style.height = `${height}px`
      if (canvas.width !== backingWidth) {
        canvas.width = backingWidth
      }
      if (canvas.height !== backingHeight) {
        canvas.height = backingHeight
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, geometry.width, height)
      renderWindow(ctx, geometry.left, geometry.width)
      lastDrawRef.current = {
        left: geometry.left,
        width: geometry.width,
        height,
        backingWidth,
        backingHeight,
        renderWindow,
        renderRevision,
      }
    },
    [contentVersion, height, liveTimelineViewport, renderWindow, version],
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Store-driven callbacks must keep using the last committed render. Refs
    // are shared by current and work-in-progress fibers, so publishing this
    // during render would let an abandoned zoom transition affect the canvas.
    redrawGeometryRef.current = redrawGeometry

    let geometry = computeVisibleWaveformCanvasGeometry(width, visibleStartPx, visibleEndPx)
    if (liveTimelineViewport) {
      geometry =
        computeLiveTimelineGeometryFromItem(
          canvas.closest<HTMLElement>('[data-timeline-item]'),
          getLiveTimelineSnapshot(),
          liveViewportOverscanPx,
        ) ??
        measureLiveTimelineGeometry(canvas, liveViewportOverscanPx) ??
        geometry
    }
    redrawGeometry(geometry)
  }, [
    liveTimelineViewport,
    liveViewportOverscanPx,
    redrawGeometry,
    visibleEndPx,
    visibleStartPx,
    width,
  ])

  return (
    <canvas ref={canvasRef} className="absolute top-0 pointer-events-none" aria-hidden="true" />
  )
})
