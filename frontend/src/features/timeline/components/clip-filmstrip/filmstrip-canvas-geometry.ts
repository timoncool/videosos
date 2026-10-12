import type { FilmstripFrame } from '../../hooks/use-filmstrip'

export interface FilmstripCanvasGeometry {
  left: number
  width: number
}

export interface LiveTimelineFilmstripCanvasWindow {
  renderWidth: number
  visibleStartPx: number
  visibleEndPx: number
}

export interface TimelineFilmstripCanvasWindowInput {
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

export interface FilmstripCanvasTile {
  slot: number
  frame: FilmstripFrame
  x: number
  width: number
}

export interface FilmstripCanvasTilesOptions {
  frames: FilmstripFrame[]
  renderWidth: number
  visibleStartPx: number
  visibleEndPx: number
  tileWidth: number
  pixelsPerSecond: number
  effectiveStart: number
  effectiveEnd: number
  speed: number
  isReversed: boolean
}

export const MAX_VISIBLE_FILMSTRIP_TILES = 64

export function getFilmstripTileStride(startTile: number, endTile: number): number {
  return Math.max(
    1,
    Math.ceil(Math.max(0, endTile - startTile) / MAX_VISIBLE_FILMSTRIP_TILES),
  )
}

export function computeFilmstripCanvasGeometry(
  renderWidth: number,
  visibleStartPx: number,
  visibleEndPx: number,
): FilmstripCanvasGeometry {
  const safeRenderWidth = Math.max(0, renderWidth)
  const boundedStart = Math.max(0, Math.min(safeRenderWidth, visibleStartPx))
  const boundedEnd = Math.max(boundedStart, Math.min(safeRenderWidth, visibleEndPx))
  const left = Math.floor(boundedStart)
  if (boundedEnd <= boundedStart) {
    return { left, width: 0 }
  }
  // Round both CSS and backing geometry to the same real-pixel window. The
  // filmstrip host clips the sub-pixel excess at its edge; retaining a
  // fractional CSS width would resample the integer backing bitmap.
  const right = Math.max(left, Math.ceil(boundedEnd))

  return {
    left,
    width: Math.max(0, right - left),
  }
}

/**
 * Computes a clip-local filmstrip window from timeline model coordinates.
 * This is the layout-read-free equivalent of intersecting the filmstrip host
 * and timeline viewport DOM rectangles.
 */
export function computeTimelineFilmstripCanvasWindow({
  startFrame,
  durationFrames,
  fps,
  pixelsPerSecond,
  scrollLeft,
  viewportWidth,
  overscanPx,
  contentInsetStartPx = 0,
  contentInsetEndPx = 0,
}: TimelineFilmstripCanvasWindowInput): LiveTimelineFilmstripCanvasWindow | null {
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
  const renderWidth = Math.max(0, clipWidth - contentInsetStartPx - contentInsetEndPx)
  const hostLeft = clipLeft + contentInsetStartPx
  const overscan = Math.max(0, overscanPx)
  const boundedStart = Math.max(0, Math.min(renderWidth, scrollLeft - overscan - hostLeft))
  const boundedEnd = Math.max(
    boundedStart,
    Math.min(renderWidth, scrollLeft + viewportWidth + overscan - hostLeft),
  )

  return {
    renderWidth,
    visibleStartPx: Math.floor(boundedStart),
    visibleEndPx: Math.ceil(boundedEnd),
  }
}

/**
 * Builds the real-pixel thumbnail grid for a bounded canvas window.
 *
 * Both the settled React render and the live zoom painter use this function so
 * the final interaction frame cannot be replaced by a differently sampled
 * filmstrip when settled content catches up.
 */
export function computeFilmstripCanvasTiles({
  frames,
  renderWidth,
  visibleStartPx,
  visibleEndPx,
  tileWidth,
  pixelsPerSecond,
  effectiveStart,
  effectiveEnd,
  speed,
  isReversed,
}: FilmstripCanvasTilesOptions): FilmstripCanvasTile[] {
  if (
    frames.length === 0 ||
    renderWidth <= 0 ||
    tileWidth <= 0 ||
    pixelsPerSecond <= 0 ||
    speed <= 0 ||
    effectiveEnd <= effectiveStart
  ) {
    return []
  }

  const geometry = computeFilmstripCanvasGeometry(renderWidth, visibleStartPx, visibleEndPx)
  if (geometry.width <= 0) return []

  const safeTileWidth = Math.max(1, tileWidth)
  const tileCount = Math.ceil(renderWidth / safeTileWidth)
  const startTile = Math.max(0, Math.floor(geometry.left / safeTileWidth))
  const endTile = Math.min(tileCount, Math.ceil((geometry.left + geometry.width) / safeTileWidth))
  const tileStride = getFilmstripTileStride(startTile, endTile)
  const pixelsPerSourceSecond = pixelsPerSecond / Math.max(0.0001, speed)

  const findClosestFrame = (targetTime: number): FilmstripFrame | null => {
    let lo = 0
    let hi = frames.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const frame = frames[mid]!
      if (frame.index < targetTime) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    const after = frames[Math.min(lo, frames.length - 1)]!
    const before = frames[Math.max(0, lo - 1)]!
    return Math.abs(before.index - targetTime) <= Math.abs(after.index - targetTime)
      ? before
      : after
  }

  const tiles: FilmstripCanvasTile[] = []
  for (let slot = startTile; slot < endTile; slot += tileStride) {
    const x = slot * safeTileWidth
    // Retain a full logical tile at the clip edge; the bounded canvas clips it.
    // This preserves cover-crop geometry for short clips and merged dense slots.
    const width = safeTileWidth * tileStride
    const centerX = x + width * 0.5
    const targetTime = isReversed
      ? effectiveEnd - centerX / pixelsPerSourceSecond
      : effectiveStart + centerX / pixelsPerSourceSecond
    const frame = findClosestFrame(targetTime)
    if (frame) {
      tiles.push({ slot, frame, x, width })
    }
  }
  return tiles
}

export interface CoverDrawRect {
  x: number
  y: number
  width: number
  height: number
}

export function computeCoverDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CoverDrawRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale

  return {
    x: (targetWidth - width) * 0.5,
    y: (targetHeight - height) * 0.5,
    width,
    height,
  }
}
