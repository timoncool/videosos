import { useLayoutEffect, useRef, type RefObject } from 'react'
import { TIMELINE_LIVE_SCROLL_EVENT } from '@/shared/timeline/live-scroll-sync'
import { RULER_HEIGHT } from './dopesheet-constants'
import {
  formatDopesheetRulerCanvasLabel,
  getDopesheetRulerTickLayout,
} from './dopesheet-live-ruler-layout'

interface DopesheetLiveRulerCanvasProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>
  getLivePixelsPerSecond?: () => number
  fallbackPixelsPerSecond: number
  fps: number
  rulerUnit: 'frames' | 'seconds'
}

function alignToDevicePixel(value: number, devicePixelRatio: number): number {
  return Math.round(value * devicePixelRatio) / devicePixelRatio
}

export function DopesheetLiveRulerCanvas({
  scrollContainerRef,
  getLivePixelsPerSecond,
  fallbackPixelsPerSecond,
  fps,
  rulerUnit,
}: DopesheetLiveRulerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const scrollContainer = scrollContainerRef.current
    if (!canvas || !scrollContainer) return

    let drawFrame: number | null = null

    const draw = () => {
      drawFrame = null
      const width = canvas.clientWidth
      const height = canvas.clientHeight || RULER_HEIGHT
      if (width <= 0 || height <= 0) return
      const context = canvas.getContext('2d')
      if (!context) return

      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const backingWidth = Math.max(1, Math.round(width * devicePixelRatio))
      const backingHeight = Math.max(1, Math.round(height * devicePixelRatio))
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }

      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)

      const livePixelsPerSecond = getLivePixelsPerSecond?.()
      const pixelsPerSecond =
        livePixelsPerSecond !== undefined &&
        Number.isFinite(livePixelsPerSecond) &&
        livePixelsPerSecond > 0
          ? livePixelsPerSecond
          : fallbackPixelsPerSecond
      const pixelsPerFrame = pixelsPerSecond / Math.max(fps, 1)
      const scrollLeft = scrollContainer.scrollLeft
      const layout = getDopesheetRulerTickLayout({
        scrollLeft,
        viewportWidth: width,
        pixelsPerSecond,
        fps,
      })
      const styles = getComputedStyle(canvas)
      const rulerColor = styles.color
      const axisOffset = -1
      const frameToX = (frame: number) => frame * pixelsPerFrame - scrollLeft + axisOffset

      context.strokeStyle = rulerColor
      context.lineWidth = 1 / devicePixelRatio
      context.globalAlpha = 0.22
      context.beginPath()
      const firstMinorFrame =
        Math.floor(layout.firstMajorFrame / layout.minorStepFrames) * layout.minorStepFrames
      for (
        let frame = firstMinorFrame;
        frame <= layout.lastMajorFrame;
        frame += layout.minorStepFrames
      ) {
        const majorIndex = frame / layout.majorStepFrames
        if (Math.abs(majorIndex - Math.round(majorIndex)) < 0.0001) continue
        const x = alignToDevicePixel(frameToX(frame), devicePixelRatio)
        if (x < -1 || x > width + 1) continue
        context.moveTo(x, height - 4)
        context.lineTo(x, height)
      }
      context.stroke()

      context.globalAlpha = 0.45
      context.beginPath()
      for (
        let frame = layout.firstMajorFrame;
        frame <= layout.lastMajorFrame;
        frame += layout.majorStepFrames
      ) {
        const x = alignToDevicePixel(frameToX(frame), devicePixelRatio)
        if (x < -1 || x > width + 1) continue
        context.moveTo(x, height - 8)
        context.lineTo(x, height)
      }
      context.stroke()

      context.globalAlpha = 1
      context.fillStyle = rulerColor
      context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
      context.textBaseline = 'bottom'
      for (
        let frame = layout.firstMajorFrame;
        frame <= layout.lastMajorFrame;
        frame += layout.majorStepFrames
      ) {
        const x = alignToDevicePixel(frameToX(frame), devicePixelRatio)
        if (x < -1 || x > width + 1) continue
        context.fillText(formatDopesheetRulerCanvasLabel(frame, fps, rulerUnit), x + 4, height - 8)
      }
    }

    const scheduleDraw = () => {
      if (drawFrame !== null) return
      drawFrame = requestAnimationFrame(draw)
    }

    draw()
    scrollContainer.addEventListener('scroll', scheduleDraw, { passive: true })
    scrollContainer.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, scheduleDraw)
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleDraw)
    resizeObserver?.observe(canvas)

    return () => {
      scrollContainer.removeEventListener('scroll', scheduleDraw)
      scrollContainer.removeEventListener(TIMELINE_LIVE_SCROLL_EVENT, scheduleDraw)
      resizeObserver?.disconnect()
      if (drawFrame !== null) cancelAnimationFrame(drawFrame)
    }
  }, [fallbackPixelsPerSecond, fps, getLivePixelsPerSecond, rulerUnit, scrollContainerRef])

  return (
    <canvas
      ref={canvasRef}
      data-dopesheet-live-ruler-canvas
      data-motion-ruler-surface
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-[10px] text-muted-foreground"
    />
  )
}
