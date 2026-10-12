export interface WaveformRenderWindowOptions {
  renderWidth: number
  visibleWidth?: number
  visibleStartRatio?: number
  visibleEndRatio?: number
  /** Hard redraw budget, normally viewport width plus prefetch margins. */
  maxWindowWidth?: number
}

export interface WaveformRenderWindow {
  visibleStartPx: number
  visibleEndPx: number
}

export function computeWaveformRenderWindow({
  renderWidth,
  visibleWidth = renderWidth,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  maxWindowWidth = Number.POSITIVE_INFINITY,
}: WaveformRenderWindowOptions): WaveformRenderWindow {
  const safeRenderWidth = Math.max(0, renderWidth)
  const safeVisibleWidth = Math.max(0, Math.min(visibleWidth, safeRenderWidth))
  const clampedStartRatio = Math.max(0, Math.min(1, visibleStartRatio))
  const clampedEndRatio = Math.max(clampedStartRatio, Math.min(1, visibleEndRatio))

  const rawStart = Math.max(0, Math.floor(safeVisibleWidth * clampedStartRatio))
  const rawEnd = Math.min(safeRenderWidth, Math.ceil(safeVisibleWidth * clampedEndRatio))
  const safeMaxWindowWidth = Math.max(0, maxWindowWidth)
  if (rawEnd - rawStart <= safeMaxWindowWidth) {
    return {
      visibleStartPx: rawStart,
      visibleEndPx: rawEnd,
    }
  }

  const cappedWidth = Math.min(safeRenderWidth, Math.ceil(safeMaxWindowWidth))
  const center = (rawStart + rawEnd) / 2
  const visibleStartPx = Math.max(
    0,
    Math.min(safeRenderWidth - cappedWidth, Math.floor(center - cappedWidth / 2)),
  )

  return {
    visibleStartPx,
    visibleEndPx: visibleStartPx + cappedWidth,
  }
}
