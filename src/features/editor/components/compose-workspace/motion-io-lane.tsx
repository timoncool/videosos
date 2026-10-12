import { memo, useCallback, useEffect, useRef, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  setInOutPointsWithoutHistory,
  setInPoint,
  setOutPoint,
  useMarkersStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  beginIoPointerDrag,
  IoRangeHandles,
  IoRangeStrip,
  useMeasuredWidth,
} from '@/shared/timeline/io-range'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'

/**
 * The Motion ruler's in/out (render range) lane — the same DaVinci-style IO bar
 * the Edit ruler and the Color/Animate mini-timeline render, wired to the
 * Motion time viewport.
 *
 * No state of its own: in/out live in the markers store, which the composition
 * navigation swaps on drill-in and persists onto the SubComposition, so marking
 * a range here marks *this comp's* range and the export dialog's sequence
 * picker renders exactly that window.
 *
 * Unlike the mini-timeline lane (whose axis is always the whole timeline) the
 * Motion axis is zoomable, so a point can sit outside the visible window: the
 * strip is clipped to the window and a handle whose frame is off-screen is not
 * drawn (there is nothing there to grab).
 */

export const MOTION_IO_LANE_HEIGHT = 12

interface MotionIoViewport {
  startFrame: number
  endFrame: number
}

export const MotionIoLane = memo(function MotionIoLane({
  viewport,
  maxFrame,
  fps,
}: {
  viewport: MotionIoViewport
  /** Last frame the range may reach — the comp end, not the content extent. */
  maxFrame: number
  fps: number
}) {
  const { t } = useTranslation()
  const inPoint = useMarkersStore((s) => s.inPoint)
  const outPoint = useMarkersStore((s) => s.outPoint)

  const laneRef = useRef<HTMLDivElement>(null)
  // The lane positions via `%`, but the handles need the real visible span in px
  // so the two grips meet instead of overlapping when the range is narrow.
  const { width: laneWidth, measureRef } = useMeasuredWidth(laneRef)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const maxFrameRef = useRef(maxFrame)
  maxFrameRef.current = maxFrame
  const fpsRef = useRef(fps)
  fpsRef.current = fps
  const settersRef = useRef({ in: setInPoint, out: setOutPoint })
  settersRef.current = { in: setInPoint, out: setOutPoint }
  const inOutRef = useRef({ in: inPoint, out: outPoint })
  inOutRef.current = { in: inPoint, out: outPoint }

  // Tear down an in-flight drag if the lane unmounts mid-gesture.
  useEffect(() => () => dragCleanupRef.current?.(), [])

  const frameFromClientX = useCallback((clientX: number): number | null => {
    const lane = laneRef.current
    if (!lane) return null
    const rect = lane.getBoundingClientRect()
    if (rect.width <= 0) return null
    const { startFrame, endFrame } = viewportRef.current
    const frameRange = Math.max(1, endFrame - startFrame)
    const ratio = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(maxFrameRef.current, Math.round(startFrame + ratio * frameRange)))
  }, [])

  const startHandleDrag = useCallback(
    (side: 'in' | 'out') => (event: PointerEvent) => {
      const setFrame = settersRef.current[side]
      const prevCursor = document.body.style.cursor

      const cleanup = beginIoPointerDrag(
        event,
        (clientX) => {
          const frame = frameFromClientX(clientX)
          if (frame === null) return
          setFrame(frame)
          // Skim the preview to the boundary; out is exclusive, so show out - 1.
          usePlaybackStore
            .getState()
            .setPreviewFrame(side === 'out' ? Math.max(0, frame - 1) : frame)
          return formatTimecodeCompact(frame, fpsRef.current)
        },
        () => {
          document.body.style.cursor = prevCursor
          usePlaybackStore.getState().setPreviewFrame(null)
          dragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'col-resize'
      dragCleanupRef.current = cleanup
    },
    [frameFromClientX],
  )

  // Drag the strip body to slide the whole range, preserving its length. No
  // history per move (mirrors the Edit ruler and mini-timeline); mark dirty once
  // on release.
  const startRangeDrag = useCallback((event: PointerEvent) => {
    const { in: startIn, out: startOut } = inOutRef.current
    if (startIn === null || startOut === null) return
    const lane = laneRef.current
    if (!lane) return

    const startClientX = event.clientX
    const span = Math.max(1, startOut - startIn)
    const { startFrame, endFrame } = viewportRef.current
    const frameRange = Math.max(1, endFrame - startFrame)
    const prevCursor = document.body.style.cursor
    let lastIn = startIn

    const cleanup = beginIoPointerDrag(
      event,
      (clientX) => {
        const rect = lane.getBoundingClientRect()
        if (rect.width <= 0) return
        const frameDelta = Math.round(((clientX - startClientX) / rect.width) * frameRange)
        const maxIn = Math.max(0, maxFrameRef.current - span)
        const nextIn = Math.max(0, Math.min(startIn + frameDelta, maxIn))
        const label = `${formatTimecodeCompact(nextIn, fpsRef.current)} → ${formatTimecodeCompact(nextIn + span, fpsRef.current)}`
        if (nextIn === lastIn) return label
        lastIn = nextIn
        setInOutPointsWithoutHistory(nextIn, nextIn + span)
        // Preview follows the leading edge.
        usePlaybackStore.getState().setPreviewFrame(nextIn)
        return label
      },
      () => {
        document.body.style.cursor = prevCursor
        usePlaybackStore.getState().setPreviewFrame(null)
        useTimelineSettingsStore.getState().markDirty()
        dragCleanupRef.current = null
      },
    )
    if (!cleanup) return
    document.body.style.cursor = 'grabbing'
    dragCleanupRef.current = cleanup
  }, [])

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const toPercent = (frame: number) => ((frame - viewport.startFrame) / frameRange) * 100
  const inPercent = inPoint !== null ? toPercent(inPoint) : null
  const outPercent = outPoint !== null ? toPercent(outPoint) : null

  // Clipped to the visible window — the range may extend past either edge.
  const clippedStart = inPercent !== null ? Math.max(0, Math.min(100, inPercent)) : null
  const clippedEnd = outPercent !== null ? Math.max(0, Math.min(100, outPercent)) : null
  const hasRange = inPoint !== null && outPoint !== null && outPoint > inPoint
  const spanPx =
    clippedStart !== null && clippedEnd !== null
      ? ((clippedEnd - clippedStart) / 100) * laneWidth
      : null
  return (
    <div
      ref={measureRef}
      data-testid="motion-io-lane"
      className="pointer-events-none absolute inset-x-0 bottom-0"
      style={{ height: MOTION_IO_LANE_HEIGHT }}
    >
      <div aria-hidden="true" className="absolute inset-0 border-t border-border/60 bg-muted/25" />

      {hasRange && clippedStart !== null && clippedEnd !== null ? (
        <IoRangeStrip
          left={`${clippedStart}%`}
          width={`${clippedEnd - clippedStart}%`}
          height={MOTION_IO_LANE_HEIGHT}
          onDragStart={startRangeDrag}
          title={`${formatTimecodeCompact(inPoint ?? 0, fps)} → ${formatTimecodeCompact(outPoint ?? 0, fps)}`}
          testId="motion-io-strip"
          zIndex={1}
          dataset={{
            'data-from-frame': String(inPoint ?? 0),
            'data-to-frame': String(outPoint ?? 0),
            'data-motion-viewport-clamp': '',
          }}
        />
      ) : null}

      <IoRangeHandles
        inLeft={inPercent !== null ? `${inPercent}%` : null}
        outLeft={outPercent !== null ? `${outPercent}%` : null}
        spanPx={spanPx}
        laneHeight={MOTION_IO_LANE_HEIGHT}
        zIndex={2}
        onInDragStart={startHandleDrag('in')}
        onOutDragStart={startHandleDrag('out')}
        inTitle={t('editor.compose.inPoint')}
        outTitle={t('editor.compose.outPoint')}
        testIdPrefix="motion-io"
        inDataset={{
          'data-from-frame': String(inPoint ?? 0),
        }}
        outDataset={{
          'data-from-frame': String(outPoint ?? 0),
        }}
      />
    </div>
  )
})
