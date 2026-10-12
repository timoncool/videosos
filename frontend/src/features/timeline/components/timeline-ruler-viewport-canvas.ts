import { formatTimecode, secondsToFrames } from '@/shared/utils/time-utils'

interface TimelineRulerInterval {
  intervalInSeconds: number
  minorTicks: number
}

const MAX_VISIBLE_MINOR_MARKERS = 72
const MIN_MINOR_TICK_SPACING_PX = 14
const MAJOR_TICK_HEIGHT = 8
const MINOR_TICK_HEIGHT = 4

export function getTimelineRulerInterval(pixelsPerSecond: number): TimelineRulerInterval {
  if (pixelsPerSecond >= 180) return { intervalInSeconds: 15 / 30, minorTicks: 3 }
  if (pixelsPerSecond >= 120) return { intervalInSeconds: 25 / 30, minorTicks: 3 }
  if (pixelsPerSecond >= 80) return { intervalInSeconds: 1, minorTicks: 4 }
  if (pixelsPerSecond >= 50) return { intervalInSeconds: 2, minorTicks: 2 }
  if (pixelsPerSecond >= 24) return { intervalInSeconds: 5, minorTicks: 2 }
  if (pixelsPerSecond >= 12) return { intervalInSeconds: 10, minorTicks: 2 }
  if (pixelsPerSecond >= 4) return { intervalInSeconds: 30, minorTicks: 3 }
  if (pixelsPerSecond >= 2) return { intervalInSeconds: 60, minorTicks: 3 }
  if (pixelsPerSecond >= 1) return { intervalInSeconds: 120, minorTicks: 2 }
  if (pixelsPerSecond >= 0.5) return { intervalInSeconds: 300, minorTicks: 2 }
  if (pixelsPerSecond >= 0.2) return { intervalInSeconds: 600, minorTicks: 3 }
  return { intervalInSeconds: 1800, minorTicks: 2 }
}

function alignToDevicePixel(value: number, devicePixelRatio: number): number {
  return Math.round(value * devicePixelRatio) / devicePixelRatio
}

export function drawTimelineRulerViewportCanvas({
  canvas,
  scrollLeft,
  viewportWidth,
  canvasHeight,
  pixelsPerSecond,
  fps,
}: {
  canvas: HTMLCanvasElement
  scrollLeft: number
  viewportWidth: number
  canvasHeight: number
  pixelsPerSecond: number
  fps: number
}): void {
  if (viewportWidth <= 0 || canvasHeight <= 0 || pixelsPerSecond <= 0) return
  const context = canvas.getContext('2d')
  if (!context) return

  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const backingWidth = Math.max(1, Math.round(viewportWidth * devicePixelRatio))
  const backingHeight = Math.max(1, Math.round(canvasHeight * devicePixelRatio))
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth
    canvas.height = backingHeight
  }
  canvas.style.width = `${viewportWidth}px`
  canvas.style.height = `${canvasHeight}px`

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  context.clearRect(0, 0, viewportWidth, canvasHeight)

  const markerConfig = getTimelineRulerInterval(pixelsPerSecond)
  const markerWidth = markerConfig.intervalInSeconds * pixelsPerSecond
  if (markerWidth <= 0) return

  const firstIndex = Math.max(0, Math.floor(scrollLeft / markerWidth) - 1)
  const lastIndex = Math.ceil((scrollLeft + viewportWidth) / markerWidth) + 1
  const visibleMarkerCount = lastIndex - firstIndex + 1
  const minorSpacing = markerConfig.minorTicks > 0 ? markerWidth / markerConfig.minorTicks : 0
  const showMinorTicks =
    markerConfig.minorTicks > 0 &&
    visibleMarkerCount < MAX_VISIBLE_MINOR_MARKERS &&
    minorSpacing >= MIN_MINOR_TICK_SPACING_PX

  context.lineWidth = 1 / devicePixelRatio
  context.strokeStyle = 'rgba(255, 255, 255, 0.30)'
  context.beginPath()
  for (let index = firstIndex; index <= lastIndex; index++) {
    const x = alignToDevicePixel(index * markerWidth - scrollLeft, devicePixelRatio)
    if (x < -1 || x > viewportWidth + 1) continue
    context.moveTo(x, canvasHeight - MAJOR_TICK_HEIGHT)
    context.lineTo(x, canvasHeight)
  }
  context.stroke()

  if (showMinorTicks) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    context.beginPath()
    for (let index = firstIndex; index <= lastIndex; index++) {
      const majorX = index * markerWidth - scrollLeft
      for (let minorIndex = 1; minorIndex < markerConfig.minorTicks; minorIndex++) {
        const x = alignToDevicePixel(majorX + minorSpacing * minorIndex, devicePixelRatio)
        if (x < -1 || x > viewportWidth + 1) continue
        context.moveTo(x, canvasHeight - MINOR_TICK_HEIGHT)
        context.lineTo(x, canvasHeight)
      }
    }
    context.stroke()
  }

  context.fillStyle = 'rgba(255, 255, 255, 0.60)'
  const styles = getComputedStyle(canvas)
  context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
  context.textBaseline = 'top'
  for (let index = firstIndex; index <= lastIndex; index++) {
    const timeInSeconds = index * markerConfig.intervalInSeconds
    const x = index * markerWidth - scrollLeft
    if (x < -markerWidth || x > viewportWidth + 1) continue
    context.fillText(formatTimecode(secondsToFrames(timeInSeconds, fps), fps), x + 6, 2)
  }
}
