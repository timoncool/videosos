import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useWaveform } from '@/features/preview/deps/timeline-utils'
import {
  getSourceWaveformSeekTime,
  sampleSourceWaveformAmplitudes,
} from './source-audio-waveform-utils'

const SOURCE_WAVEFORM_HEIGHT = 320
const SOURCE_WAVEFORM_OVERVIEW_HEIGHT = 34
const SOURCE_WAVEFORM_DIVIDER_HEIGHT = 1
const SOURCE_WAVEFORM_OVERVIEW_PPS = 64
const SOURCE_WAVEFORM_VERTICAL_PADDING = 5
const SOURCE_WAVEFORM_INSET_X = 8
const SOURCE_WAVEFORM_DETAIL_GAP = 8
const SOURCE_WAVEFORM_BOTTOM_INSET = 8
const SOURCE_WAVEFORM_DETAIL_WINDOW_SECONDS = 20
const SOURCE_WAVEFORM_MIN_DETAIL_WINDOW_RATIO = 0.12

interface SourceAudioWaveformProps {
  mediaId?: string
  src: string
  durationSeconds: number
  currentTimeSeconds: number
  onSeekSeconds?: (timeSeconds: number) => void
}

interface WaveformRegion {
  x: number
  width: number
  y: number
  height: number
  startTimeSeconds: number
  endTimeSeconds: number
}

interface WaveformCanvasSize {
  layoutWidth: number
  layoutHeight: number
  visualWidth: number
  visualHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getZoomWindow(durationSeconds: number, currentTimeSeconds: number) {
  if (durationSeconds <= 0) {
    return { start: 0, end: 0 }
  }

  const windowDuration = Math.min(
    durationSeconds,
    Math.max(
      durationSeconds * SOURCE_WAVEFORM_MIN_DETAIL_WINDOW_RATIO,
      SOURCE_WAVEFORM_DETAIL_WINDOW_SECONDS,
    ),
  )
  const safeCurrentTime = clamp(currentTimeSeconds, 0, durationSeconds)
  const start = clamp(
    safeCurrentTime - windowDuration / 2,
    0,
    Math.max(0, durationSeconds - windowDuration),
  )

  return {
    start,
    end: Math.min(durationSeconds, start + windowDuration),
  }
}

function drawWaveformRegion(
  context: CanvasRenderingContext2D,
  amplitudes: Float32Array,
  region: WaveformRegion,
  fillStyle: string | CanvasGradient,
  strokeStyle?: string,
) {
  const centerY = region.y + region.height / 2
  const maxWaveHeight = Math.max(1, region.height / 2 - SOURCE_WAVEFORM_VERTICAL_PADDING)
  const sampleScale = amplitudes.length > 0 ? amplitudes.length / Math.max(1, region.width) : 1

  context.fillStyle = fillStyle
  for (let x = 0; x < region.width; x += 1) {
    const sourceIndex = Math.min(amplitudes.length - 1, Math.floor(x * sampleScale))
    const waveHeight = Math.max(1, Math.round((amplitudes[sourceIndex] ?? 0) * maxWaveHeight))
    context.fillRect(region.x + x, Math.round(centerY - waveHeight), 1, waveHeight * 2)
  }

  if (strokeStyle) {
    context.strokeStyle = strokeStyle
    context.lineWidth = 1
    context.strokeRect(
      region.x + 0.5,
      region.y + 0.5,
      Math.max(0, region.width - 1),
      Math.max(0, region.height - 1),
    )
  }

  context.strokeStyle = 'rgba(255, 255, 255, 0.13)'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(region.x, Math.round(centerY) + 0.5)
  context.lineTo(region.x + region.width, Math.round(centerY) + 0.5)
  context.stroke()
}

function drawPlayhead(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  color = 'rgba(239, 68, 68, 0.98)',
) {
  context.strokeStyle = color
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(x + 0.5, y)
  context.lineTo(x + 0.5, y + height)
  context.stroke()
}

function drawOverviewWindow(
  context: CanvasRenderingContext2D,
  startX: number,
  endX: number,
  regionX: number,
  regionWidth: number,
  y: number,
  height: number,
) {
  const left = Math.round(startX) + 0.5
  const width = Math.max(1, Math.round(endX - startX))

  context.fillStyle = 'rgba(0, 0, 0, 0.22)'
  context.fillRect(regionX, y, Math.max(0, left - regionX), height)
  context.fillRect(left + width, y, Math.max(0, regionX + regionWidth - left - width), height)

  context.fillStyle = 'rgba(255, 255, 255, 0.11)'
  context.fillRect(left, y + 1.5, width, height - 3)

  context.strokeStyle = 'rgba(238, 238, 238, 0.7)'
  context.lineWidth = 1
  context.strokeRect(left, y + 1.5, width, height - 3)
}

function drawDetailGrid(context: CanvasRenderingContext2D, region: WaveformRegion) {
  context.strokeStyle = 'rgba(255, 255, 255, 0.065)'
  context.lineWidth = 1
  for (let i = 1; i < 4; i += 1) {
    const x = Math.round(region.x + (region.width * i) / 4) + 0.5
    context.beginPath()
    context.moveTo(x, region.y)
    context.lineTo(x, region.y + region.height)
    context.stroke()
  }
}

export function SourceAudioWaveform({
  mediaId,
  src,
  durationSeconds,
  currentTimeSeconds,
  onSeekSeconds,
}: SourceAudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<WaveformCanvasSize>({
    layoutWidth: 0,
    layoutHeight: SOURCE_WAVEFORM_HEIGHT,
    visualWidth: 0,
    visualHeight: SOURCE_WAVEFORM_HEIGHT,
  })
  const enabled = !!mediaId && !!src && durationSeconds > 0
  const { peaks, sampleRate, stereo, maxPeak, isLoading, error } = useWaveform({
    mediaId: mediaId ?? '',
    blobUrl: src || null,
    isVisible: enabled,
    enabled,
    deferDurationSec: durationSeconds,
    pixelsPerSecond: SOURCE_WAVEFORM_OVERVIEW_PPS,
    visibleSourceStartSec: 0,
    visibleSourceEndSec: durationSeconds,
  })

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      const layoutWidth = Math.max(0, Math.round(element.clientWidth || rect.width))
      const layoutHeight = Math.max(
        1,
        Math.round(element.clientHeight || rect.height || SOURCE_WAVEFORM_HEIGHT),
      )
      setSize({
        layoutWidth,
        layoutHeight,
        visualWidth: Math.max(0, Math.round(rect.width || layoutWidth)),
        visualHeight: Math.max(1, Math.round(rect.height || layoutHeight)),
      })
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  const detailWindow = useMemo(
    () => getZoomWindow(durationSeconds, currentTimeSeconds),
    [currentTimeSeconds, durationSeconds],
  )

  const overviewAmplitudes = useMemo(() => {
    if (!peaks || size.layoutWidth <= 0) return null

    return sampleSourceWaveformAmplitudes({
      peaks,
      sampleRate,
      stereo,
      durationSeconds,
      width: size.layoutWidth,
      maxPeak,
    })
  }, [durationSeconds, maxPeak, peaks, sampleRate, size.layoutWidth, stereo])

  const detailAmplitudes = useMemo(() => {
    if (!peaks || size.layoutWidth <= 0) return null

    return sampleSourceWaveformAmplitudes({
      peaks,
      sampleRate,
      stereo,
      durationSeconds,
      startTimeSeconds: detailWindow.start,
      endTimeSeconds: detailWindow.end,
      width: size.layoutWidth,
      maxPeak,
    })
  }, [
    detailWindow.end,
    detailWindow.start,
    durationSeconds,
    maxPeak,
    peaks,
    sampleRate,
    size.layoutWidth,
    stereo,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (
      !canvas ||
      !overviewAmplitudes ||
      !detailAmplitudes ||
      size.layoutWidth <= 0 ||
      size.layoutHeight <= 0 ||
      size.visualWidth <= 0 ||
      size.visualHeight <= 0
    ) {
      return
    }

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(size.visualWidth * dpr))
    canvas.height = Math.max(1, Math.round(size.visualHeight * dpr))
    canvas.style.width = `${size.layoutWidth}px`
    canvas.style.height = `${size.layoutHeight}px`

    const context = canvas.getContext('2d')
    if (!context) return

    const scaleX = (size.visualWidth / size.layoutWidth) * dpr
    const scaleY = (size.visualHeight / size.layoutHeight) * dpr
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    context.clearRect(0, 0, size.layoutWidth, size.layoutHeight)
    context.fillStyle = '#121316'
    context.fillRect(0, 0, size.layoutWidth, size.layoutHeight)

    const waveformX = SOURCE_WAVEFORM_INSET_X
    const waveformWidth = Math.max(1, size.layoutWidth - SOURCE_WAVEFORM_INSET_X * 2)

    const overviewRegion: WaveformRegion = {
      x: waveformX,
      width: waveformWidth,
      y: 0,
      height: SOURCE_WAVEFORM_OVERVIEW_HEIGHT,
      startTimeSeconds: 0,
      endTimeSeconds: durationSeconds,
    }
    const detailRegion: WaveformRegion = {
      x: waveformX,
      width: waveformWidth,
      y: SOURCE_WAVEFORM_OVERVIEW_HEIGHT + SOURCE_WAVEFORM_DETAIL_GAP,
      height: Math.max(
        1,
        size.layoutHeight -
          SOURCE_WAVEFORM_OVERVIEW_HEIGHT -
          SOURCE_WAVEFORM_DETAIL_GAP -
          SOURCE_WAVEFORM_BOTTOM_INSET,
      ),
      startTimeSeconds: detailWindow.start,
      endTimeSeconds: detailWindow.end,
    }

    context.fillStyle = '#202127'
    context.fillRect(0, 0, size.layoutWidth, SOURCE_WAVEFORM_OVERVIEW_HEIGHT)
    context.fillStyle = '#18191f'
    context.fillRect(0, detailRegion.y, size.layoutWidth, detailRegion.height)
    context.fillStyle = 'rgba(255, 255, 255, 0.08)'
    context.fillRect(
      0,
      SOURCE_WAVEFORM_OVERVIEW_HEIGHT,
      size.layoutWidth,
      SOURCE_WAVEFORM_DIVIDER_HEIGHT,
    )
    drawDetailGrid(context, detailRegion)

    const overviewGradient = context.createLinearGradient(0, 0, 0, overviewRegion.height)
    overviewGradient.addColorStop(0, 'rgba(180, 182, 186, 0.74)')
    overviewGradient.addColorStop(0.5, 'rgba(132, 134, 139, 0.92)')
    overviewGradient.addColorStop(1, 'rgba(180, 182, 186, 0.74)')

    const detailGradient = context.createLinearGradient(0, detailRegion.y, 0, size.layoutHeight)
    detailGradient.addColorStop(0, 'rgba(198, 199, 201, 0.94)')
    detailGradient.addColorStop(0.5, 'rgba(139, 140, 142, 0.98)')
    detailGradient.addColorStop(1, 'rgba(198, 199, 201, 0.94)')

    drawWaveformRegion(context, overviewAmplitudes, overviewRegion, overviewGradient)
    drawWaveformRegion(context, detailAmplitudes, detailRegion, detailGradient)

    const safeCurrentTime = clamp(currentTimeSeconds, 0, durationSeconds)
    const overviewPlayheadX =
      durationSeconds > 0
        ? overviewRegion.x + (safeCurrentTime / durationSeconds) * overviewRegion.width
        : 0
    const windowStartX =
      durationSeconds > 0
        ? overviewRegion.x + (detailWindow.start / durationSeconds) * overviewRegion.width
        : 0
    const windowEndX =
      durationSeconds > 0
        ? overviewRegion.x + (detailWindow.end / durationSeconds) * overviewRegion.width
        : 0

    drawOverviewWindow(
      context,
      windowStartX,
      windowEndX,
      overviewRegion.x,
      overviewRegion.width,
      0,
      SOURCE_WAVEFORM_OVERVIEW_HEIGHT,
    )
    drawPlayhead(context, overviewPlayheadX, 0, SOURCE_WAVEFORM_OVERVIEW_HEIGHT)
  }, [
    currentTimeSeconds,
    detailAmplitudes,
    detailWindow.end,
    detailWindow.start,
    durationSeconds,
    overviewAmplitudes,
    size.layoutHeight,
    size.layoutWidth,
    size.visualHeight,
    size.visualWidth,
  ])

  const seekFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const timeSeconds = getSourceWaveformSeekTime({
        clientX: event.clientX,
        clientY: event.clientY,
        rect,
        durationSeconds,
        detailStartTimeSeconds: detailWindow.start,
        detailEndTimeSeconds: detailWindow.end,
        overviewHeight: SOURCE_WAVEFORM_OVERVIEW_HEIGHT,
      })
      onSeekSeconds?.(timeSeconds)
    },
    [detailWindow.end, detailWindow.start, durationSeconds, onSeekSeconds],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!onSeekSeconds) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      seekFromPointer(event)
    },
    [onSeekSeconds, seekFromPointer],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!onSeekSeconds || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      event.preventDefault()
      seekFromPointer(event)
    },
    [onSeekSeconds, seekFromPointer],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onSeekSeconds) return
      const stepSeconds = event.shiftKey ? 5 : 1
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onSeekSeconds(clamp(currentTimeSeconds - stepSeconds, 0, durationSeconds))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onSeekSeconds(clamp(currentTimeSeconds + stepSeconds, 0, durationSeconds))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onSeekSeconds(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        onSeekSeconds(durationSeconds)
      }
    },
    [currentTimeSeconds, durationSeconds, onSeekSeconds],
  )

  const showUnavailable = !enabled || !!error || (!isLoading && (!peaks || peaks.length === 0))
  const showWaveform = overviewAmplitudes && detailAmplitudes && !showUnavailable

  return (
    <div
      ref={containerRef}
      data-testid="source-audio-waveform"
      aria-label="Source monitor audio waveform overview and zoom window"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, durationSeconds)}
      aria-valuenow={clamp(currentTimeSeconds, 0, Math.max(0, durationSeconds))}
      tabIndex={onSeekSeconds ? 0 : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      className="relative h-full w-full touch-none cursor-crosshair select-none overflow-hidden bg-[#121316]"
    >
      <div
        data-testid="source-audio-waveform-overview"
        className="pointer-events-none absolute inset-x-0 top-0 h-10"
      />
      <div
        data-testid="source-audio-waveform-zoom"
        className="pointer-events-none absolute inset-x-0 bottom-0 top-[42px]"
      />
      {showWaveform ? <canvas ref={canvasRef} className="relative z-10 block" /> : null}
      {!showWaveform && !showUnavailable ? (
        <div className="absolute inset-0 flex flex-col gap-px" aria-hidden="true">
          <div className="flex h-10 items-center justify-center gap-1 px-4">
            {Array.from({ length: 64 }, (_, index) => (
              <div
                key={index}
                className="w-0.5 bg-zinc-400/40"
                style={{ height: `${22 + ((index * 11) % 54)}%` }}
              />
            ))}
          </div>
          <div className="flex flex-1 items-center justify-center gap-1 px-4">
            {Array.from({ length: 96 }, (_, index) => (
              <div
                key={index}
                className="w-1 bg-zinc-400/35"
                style={{ height: `${24 + ((index * 17) % 68)}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
      {showUnavailable ? (
        <>
          <div className="absolute inset-x-4 top-5 h-px bg-zinc-400/30" />
          <div className="absolute inset-x-4 top-1/2 h-px bg-zinc-400/25" />
        </>
      ) : null}
    </div>
  )
}
