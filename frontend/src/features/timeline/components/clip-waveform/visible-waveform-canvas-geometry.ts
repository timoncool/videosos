export interface VisibleWaveformCanvasGeometry {
  left: number
  width: number
}

export interface TimelineWaveformCanvasGeometryInput {
  startFrame: number
  durationFrames: number
  fps: number
  pixelsPerSecond: number
  scrollLeft: number
  viewportWidth: number
  overscanPx: number
  contentInsetStartPx?: number
  contentInsetEndPx?: number
}

export function computeLiveViewportWaveformCanvasGeometry({
  hostLeft,
  hostWidth,
  viewportLeft,
  viewportWidth,
  overscanPx,
}: {
  hostLeft: number
  hostWidth: number
  viewportLeft: number
  viewportWidth: number
  overscanPx: number
}): VisibleWaveformCanvasGeometry {
  const safeHostWidth = Math.max(0, hostWidth)
  const safeViewportWidth = Math.max(0, viewportWidth)
  const safeOverscan = Math.max(0, overscanPx)
  const left = Math.max(0, Math.min(safeHostWidth, viewportLeft - safeOverscan - hostLeft))
  const right = Math.max(
    left,
    Math.min(safeHostWidth, viewportLeft + safeViewportWidth + safeOverscan - hostLeft),
  )

  return {
    left: Math.floor(left),
    width: Math.max(0, Math.ceil(right) - Math.floor(left)),
  }
}

/**
 * Computes the live viewport window from timeline coordinates without reading
 * DOM layout. The content insets describe the waveform host inside the outer
 * timeline item; they remain real pixels while the frame geometry zooms.
 */
export function computeTimelineWaveformCanvasGeometry({
  startFrame,
  durationFrames,
  fps,
  pixelsPerSecond,
  scrollLeft,
  viewportWidth,
  overscanPx,
  contentInsetStartPx = 0,
  contentInsetEndPx = 0,
}: TimelineWaveformCanvasGeometryInput): VisibleWaveformCanvasGeometry | null {
  if (
    !Number.isFinite(startFrame) ||
    !Number.isFinite(durationFrames) ||
    durationFrames < 0 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isFinite(pixelsPerSecond) ||
    pixelsPerSecond <= 0 ||
    !Number.isFinite(scrollLeft) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0 ||
    !Number.isFinite(overscanPx) ||
    !Number.isFinite(contentInsetStartPx) ||
    contentInsetStartPx < 0 ||
    !Number.isFinite(contentInsetEndPx) ||
    contentInsetEndPx < 0
  ) {
    return null
  }

  const clipLeft = (startFrame / fps) * pixelsPerSecond
  const clipWidth = (durationFrames / fps) * pixelsPerSecond
  return computeLiveViewportWaveformCanvasGeometry({
    hostLeft: clipLeft + contentInsetStartPx,
    hostWidth: Math.max(0, clipWidth - contentInsetStartPx - contentInsetEndPx),
    viewportLeft: scrollLeft,
    viewportWidth,
    overscanPx,
  })
}

export function computeVisibleWaveformCanvasGeometry(
  width: number,
  visibleStartPx: number,
  visibleEndPx: number,
): VisibleWaveformCanvasGeometry {
  const safeWidth = Math.max(0, width)
  const left = Math.max(0, Math.min(safeWidth, Math.floor(visibleStartPx)))
  const right = Math.max(left, Math.min(safeWidth, Math.ceil(visibleEndPx)))

  return {
    left,
    width: Math.max(0, right - left),
  }
}
