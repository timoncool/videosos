import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { formatTimecode } from '@/shared/utils/time-utils'

const FLAG_HEIGHT = 12

interface ImperativeBooleanSignal {
  readonly current: boolean
  subscribe: (listener: () => void) => () => void
}

interface ImperativeSignal {
  subscribe: (listener: () => void) => () => void
}

function isImperativelySuppressed(
  suppressRefs: ReadonlyArray<MutableRefObject<boolean>> | undefined,
  suppressSignal: ImperativeBooleanSignal | undefined,
): boolean {
  return (suppressRefs?.some((ref) => ref.current) ?? false) || (suppressSignal?.current ?? false)
}

function shouldHidePreviewScrubber({
  previewFrame,
  suppressed,
  suppressRefActive,
}: {
  previewFrame: number | null
  suppressed: boolean
  suppressRefActive: boolean
}): boolean {
  return previewFrame === null || suppressed || suppressRefActive
}

interface TimelinePreviewScrubberVisualProps {
  frameToPixels: (frame: number) => number
  fps: number
  inRuler?: boolean
  maxFrame?: number
  rulerOffset?: number
  showTooltip?: boolean
  suppressed?: boolean
  suppressRefs?: ReadonlyArray<MutableRefObject<boolean>>
  suppressSignal?: ImperativeBooleanSignal
  /** Reposition from the live mapper when external geometry changes. */
  repositionSignal?: ImperativeSignal
  /** Reposition from the live mapper whenever an external timeline scrolls. */
  positionSyncTargetRef?: RefObject<HTMLElement | null>
  zIndex?: number
}

/** Shared ghost playhead visual used by every Edit timeline surface. */
export function TimelinePreviewScrubberVisual({
  frameToPixels,
  fps,
  inRuler = false,
  maxFrame,
  rulerOffset = 0,
  showTooltip = true,
  suppressed = false,
  suppressRefs,
  suppressSignal,
  repositionSignal,
  positionSyncTargetRef,
  zIndex = 20,
}: TimelinePreviewScrubberVisualProps) {
  const scrubberRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const frameToPixelsRef = useRef(frameToPixels)
  const fpsRef = useRef(fps)
  const maxFrameRef = useRef(maxFrame)
  const suppressedRef = useRef(suppressed)
  const suppressStateRefsRef = useRef(suppressRefs)
  const suppressSignalRef = useRef(suppressSignal)
  // Positioning runs in a layout effect below, so these refs must already hold
  // this render's mapper. Updating them in a passive effect leaves the skim line
  // one zoom render behind.
  frameToPixelsRef.current = frameToPixels
  fpsRef.current = fps
  maxFrameRef.current = maxFrame
  suppressedRef.current = suppressed
  suppressStateRefsRef.current = suppressRefs
  suppressSignalRef.current = suppressSignal

  const updatePosition = useCallback((previewFrame: number | null) => {
    const node = scrubberRef.current
    if (!node) return
    if (
      shouldHidePreviewScrubber({
        previewFrame,
        suppressed: suppressedRef.current,
        suppressRefActive: isImperativelySuppressed(
          suppressStateRefsRef.current,
          suppressSignalRef.current,
        ),
      })
    ) {
      if (node.style.display !== 'none') node.style.display = 'none'
      return
    }

    let clampedFrame = Math.max(0, previewFrame ?? 0)
    if (maxFrameRef.current !== undefined) {
      clampedFrame = Math.min(clampedFrame, maxFrameRef.current)
    }

    // Preserve the exact mapped coordinate. The main timeline is a scrolled
    // content surface while the keyframe timeline is a fixed viewport surface;
    // rounding on different sides of scrollLeft makes their skim lines disagree
    // by a pixel during wheel zoom.
    const leftPosition = frameToPixelsRef.current(clampedFrame)
    if (node.style.display !== '') node.style.display = ''
    const transform = `translate3d(${leftPosition}px, 0, 0)`
    if (node.style.transform !== transform) node.style.transform = transform
    if (tooltipRef.current) {
      const timecode = formatTimecode(clampedFrame, fpsRef.current)
      if (tooltipRef.current.textContent !== timecode) tooltipRef.current.textContent = timecode
    }
  }, [])

  useEffect(() => {
    updatePosition(usePlaybackStore.getState().previewFrame)
    return usePlaybackStore.subscribe((state, previousState) => {
      if (state.previewFrame === previousState.previewFrame) return
      updatePosition(state.previewFrame)
    })
  }, [updatePosition])

  useEffect(() => {
    if (!suppressSignal) return
    return suppressSignal.subscribe(() => {
      updatePosition(usePlaybackStore.getState().previewFrame)
    })
  }, [suppressSignal, updatePosition])

  useEffect(() => {
    if (!repositionSignal) return
    return repositionSignal.subscribe(() => {
      updatePosition(usePlaybackStore.getState().previewFrame)
    })
  }, [repositionSignal, updatePosition])

  useEffect(() => {
    const target = positionSyncTargetRef?.current
    if (!target) return
    const reposition = () => updatePosition(usePlaybackStore.getState().previewFrame)
    target.addEventListener('scroll', reposition, { passive: true })
    return () => target.removeEventListener('scroll', reposition)
  }, [positionSyncTargetRef, updatePosition])

  useLayoutEffect(() => {
    updatePosition(usePlaybackStore.getState().previewFrame)
  }, [fps, frameToPixels, maxFrame, suppressed, updatePosition])

  useEffect(() => {
    const updateColor = (tool: string) => {
      const isRazor = tool === 'razor'
      const isRateStretch = tool === 'rate-stretch'
      const isTrimEdit = tool === 'trim-edit'
      const lineColor = isRazor
        ? 'rgba(239, 68, 68, 0.7)'
        : isRateStretch
          ? 'rgba(168, 85, 247, 0.7)'
          : isTrimEdit
            ? 'rgba(234, 179, 8, 0.7)'
            : 'rgba(255, 255, 255, 0.3)'
      const handleColor = isRazor
        ? 'rgba(239, 68, 68, 0.8)'
        : isRateStretch
          ? 'rgba(168, 85, 247, 0.8)'
          : isTrimEdit
            ? 'rgba(234, 179, 8, 0.8)'
            : 'rgba(255, 255, 255, 0.4)'

      if (lineRef.current) lineRef.current.style.backgroundColor = lineColor
      if (handleRef.current) handleRef.current.style.backgroundColor = handleColor
      updatePosition(usePlaybackStore.getState().previewFrame)
    }

    updateColor(useSelectionStore.getState().activeTool)
    return useSelectionStore.subscribe((state, previousState) => {
      if (state.activeTool !== previousState.activeTool) updateColor(state.activeTool)
    })
  }, [updatePosition])

  return (
    <div
      ref={scrubberRef}
      data-testid="timeline-preview-scrubber"
      className="absolute bottom-0 top-0 w-px"
      style={{ display: 'none', pointerEvents: 'none', zIndex }}
    >
      <div
        ref={lineRef}
        className="absolute bg-white/30"
        style={{
          top: inRuler ? rulerOffset + FLAG_HEIGHT : 0,
          bottom: 0,
          left: 0,
          right: 0,
        }}
      />

      {inRuler ? (
        <>
          <div
            ref={handleRef}
            className="absolute left-1/2 h-3 w-2 -translate-x-1/2 rounded-b-[2px] bg-white/40"
            style={{ top: rulerOffset }}
          />
          {showTooltip ? (
            <div
              ref={tooltipRef}
              className="absolute left-1/2 -top-[22px] -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-white"
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
