import { useCallback, useMemo, useRef, useEffect, memo } from 'react'

import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useInOutPoints } from '../hooks/use-in-out-points'
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { usePlaybackStore } from '@/shared/state/playback'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'
import { beginIoPointerDrag, IoRangeHandles } from '@/shared/timeline/io-range'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { pixelsToFrameNow } from '../utils/zoom-conversions'

// Matches the ruler's top IO lane height in timeline-markers.tsx.
const IO_LANE_HEIGHT = 12

/**
 * Timeline In/Out Markers — isolated in its own memo boundary so zoom-driven
 * position updates only re-render these 2 marker divs, not the parent ruler.
 * Handle grip/hit-area rendering (incl. collapse-safe sizing when the range is
 * narrow) lives in the shared `IoRangeHandles`; this component owns only the
 * Edit-workspace drag behavior + pixel positioning.
 */
export const TimelineInOutMarkers = memo(function TimelineInOutMarkers() {
  const { inPoint, outPoint, setInPoint, setOutPoint } = useInOutPoints()
  const fps = useTimelineSettingsStore((s) => s.fps)
  const { frameToPixels } = useTimelineCommittedZoomContext()

  const pixelsToFrameRef = useRef(pixelsToFrameNow)
  const setInPointRef = useRef(setInPoint)
  const setOutPointRef = useRef(setOutPoint)
  const fpsRef = useRef(fps)
  setInPointRef.current = setInPoint
  setOutPointRef.current = setOutPoint
  fpsRef.current = fps

  // Store active drag cleanup so we can tear down on unmount
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const startDrag = useCallback(
    (handle: 'in' | 'out') => (e: React.PointerEvent) => {
      const container = (e.currentTarget as HTMLElement).closest('.timeline-ruler')
      if (!container) return

      const setter = handle === 'in' ? setInPointRef : setOutPointRef
      const prevCursor = document.body.style.cursor
      const cleanup = beginIoPointerDrag(
        e,
        (clientX) => {
          const rect = container.getBoundingClientRect()
          const x = clientX - rect.left
          const frame = Math.max(0, pixelsToFrameRef.current(x))
          setter.current(frame)
          // Skim the preview to the boundary frame. Out is exclusive, so show the
          // last included frame (out - 1) rather than the frame just past it.
          const previewFrame =
            handle === 'out' ? Math.max(0, Math.round(frame) - 1) : Math.round(frame)
          usePlaybackStore.getState().setPreviewFrame(previewFrame)
          return formatTimecodeCompact(Math.round(frame), fpsRef.current)
        },
        () => {
          document.body.style.cursor = prevCursor
          previewScrubberSuppressRef.current = false
          usePlaybackStore.getState().setPreviewFrame(null)
          dragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'col-resize'
      // Keep the preview canvas refreshing but pin the ghost skimmer so it
      // doesn't chase the marker (matches the Color workspace IO drag).
      previewScrubberSuppressRef.current = true
      dragCleanupRef.current = cleanup
    },
    [],
  )

  // Tear down listeners if component unmounts mid-drag
  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )

  const handleInDown = useMemo(() => startDrag('in'), [startDrag])
  const handleOutDown = useMemo(() => startDrag('out'), [startDrag])

  const inPx = inPoint !== null ? frameToPixels(inPoint) : null
  const outPx = outPoint !== null ? frameToPixels(outPoint) : null
  const spanPx = inPx !== null && outPx !== null ? outPx - inPx : null

  return (
    <IoRangeHandles
      inLeft={inPx !== null ? `${inPx}px` : null}
      outLeft={outPx !== null ? `${outPx}px` : null}
      spanPx={spanPx}
      laneHeight={IO_LANE_HEIGHT}
      onInDragStart={handleInDown}
      onOutDragStart={handleOutDown}
    />
  )
})
