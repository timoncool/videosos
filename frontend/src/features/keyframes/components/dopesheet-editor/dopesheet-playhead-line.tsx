/**
 * Self-positioning unified playhead for the dope sheet timeline.
 *
 * The flag and full-height line are rendered by one element. During playback
 * this component updates its position directly so the editor does not need to
 * re-render on every frame.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import {
  mainTimelineScrubActiveRef,
  mainTimelineScrubHandoffFrameRef,
} from '@/shared/timeline/main-timeline-scrub'
import {
  TIMELINE_LIVE_SCROLL_EVENT,
  TIMELINE_SCRUB_VISUAL_FRAME_EVENT,
  getTimelineScrubViewportX,
  type TimelineScrubVisualFrameDetail,
} from '@/shared/timeline/live-scroll-sync'

function setTranslateXIfChanged(element: HTMLElement, left: number): void {
  const transform = `translate3d(${left}px, 0, 0)`
  if (element.style.transform !== transform) element.style.transform = transform
}

interface DopesheetPlayheadLineProps {
  /** Clip-relative playhead frame for paused seek and zoom updates. */
  relativeFrame: number
  /** Absolute timeline frame where the edited item starts. */
  itemFrom: number
  /** Item duration in frames. */
  totalFrames: number
  /** Whether live playback should stop at the edited clip's bounds. */
  clampToItemBounds?: boolean
  /** Whether the committed playhead should follow transient preview/skim frames. */
  followPreviewFrame?: boolean
  /** Local ruler ownership allows scrub previews without following ordinary hover skims. */
  localScrubActiveRef?: RefObject<boolean>
  /** Last local ruler frame held until the deferred editor prop catches up. */
  localScrubHandoffFrameRef?: RefObject<number | null>
  /** Convert a clip-relative frame to x within the timeline viewport. */
  frameToX: (frame: number) => number
  /** Exact shared Edit-axis mapper. Receives an absolute timeline frame. */
  globalFrameToX?: (globalFrame: number) => number
  /** Live scroll surface that should reposition this playhead before React commits. */
  positionSyncTargetRef?: RefObject<HTMLElement | null>
  /** Upper clamp for the playhead's left position. */
  maxLeft: number
  /** Pin the playhead to the visible viewport instead of letting its clip hide it. */
  clampToViewport?: boolean
  className?: string
}

interface PlayheadPositionState {
  itemFrom: number
  totalFrames: number
  relativeFrame: number
  clampToItemBounds: boolean
  followPreviewFrame: boolean
}

function clampRelativeFrame(frame: number, pos: PlayheadPositionState): number {
  if (!pos.clampToItemBounds) return frame
  const lastFrame = Math.max(0, (pos.totalFrames || 1) - 1)
  return Math.max(0, Math.min(lastFrame, frame))
}

function resolveScrubHandoffFrame(
  pos: PlayheadPositionState,
  currentFrame: number,
  previewFrame: number | null,
  isMainTimelineScrubbing: boolean,
): number | null {
  if (isMainTimelineScrubbing) {
    mainTimelineScrubHandoffFrameRef.current = previewFrame ?? currentFrame
    return null
  }

  const handoffFrame = mainTimelineScrubHandoffFrameRef.current
  if (handoffFrame === null) return null
  if (pos.itemFrom + pos.relativeFrame === handoffFrame) {
    mainTimelineScrubHandoffFrameRef.current = null
    return null
  }

  return clampRelativeFrame(handoffFrame - pos.itemFrom, pos)
}

function resolveLocalScrubHandoffFrame(
  pos: PlayheadPositionState,
  isLocalTimelineScrubbing: boolean,
  handoffFrameRef?: RefObject<number | null>,
): number | null {
  if (isLocalTimelineScrubbing || !handoffFrameRef) return null
  const handoffFrame = handoffFrameRef.current
  if (handoffFrame === null) return null
  if (pos.relativeFrame === handoffFrame) {
    handoffFrameRef.current = null
    return null
  }
  return clampRelativeFrame(handoffFrame, pos)
}

function shouldFollowTransientFrame(
  pos: PlayheadPositionState,
  isMainTimelineScrubbing: boolean,
  isLocalTimelineScrubbing: boolean,
): boolean {
  return pos.followPreviewFrame || isMainTimelineScrubbing || isLocalTimelineScrubbing
}

function resolveLiveRelativeFrame(
  pos: PlayheadPositionState,
  currentFrame: number,
  previewFrame: number | null,
  isPlaying: boolean,
  isMainTimelineScrubbing: boolean,
  followTransientFrame: boolean,
): number | null {
  const hasFollowedPreview = previewFrame !== null && followTransientFrame
  if (!isPlaying && !isMainTimelineScrubbing && !hasFollowedPreview) return null
  const frame = followTransientFrame ? (previewFrame ?? currentFrame) : currentFrame
  return clampRelativeFrame(frame - pos.itemFrom, pos)
}

export function DopesheetPlayheadLine({
  relativeFrame,
  itemFrom,
  totalFrames,
  clampToItemBounds = true,
  followPreviewFrame = true,
  localScrubActiveRef,
  localScrubHandoffFrameRef,
  frameToX,
  globalFrameToX,
  positionSyncTargetRef,
  maxLeft,
  clampToViewport = true,
  className,
}: DopesheetPlayheadLineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const posRef = useRef({
    frameToX,
    maxLeft,
    itemFrom,
    totalFrames,
    relativeFrame,
    clampToItemBounds,
    followPreviewFrame,
    globalFrameToX,
    clampToViewport,
  })
  posRef.current = {
    frameToX,
    maxLeft,
    itemFrom,
    totalFrames,
    relativeFrame,
    clampToItemBounds,
    followPreviewFrame,
    globalFrameToX,
    clampToViewport,
  }

  const clampLeft = (frame: number): number => {
    const pos = posRef.current
    const mappedX = pos.globalFrameToX
      ? pos.globalFrameToX(pos.itemFrom + frame)
      : pos.frameToX(frame)
    return pos.clampToViewport ? Math.max(0, Math.min(pos.maxLeft, mappedX)) : mappedX
  }

  const livePlaybackRelFrame = (): number | null => {
    const state = usePlaybackStore.getState()
    const pos = posRef.current
    const isMainTimelineScrubbing = mainTimelineScrubActiveRef.current
    const isLocalTimelineScrubbing = localScrubActiveRef?.current === true
    const followTransientFrame = shouldFollowTransientFrame(
      pos,
      isMainTimelineScrubbing,
      isLocalTimelineScrubbing,
    )

    const localHandoffFrame = resolveLocalScrubHandoffFrame(
      pos,
      isLocalTimelineScrubbing,
      localScrubHandoffFrameRef,
    )
    if (localHandoffFrame !== null) return localHandoffFrame

    const handoffFrame = resolveScrubHandoffFrame(
      pos,
      state.currentFrame,
      state.previewFrame,
      isMainTimelineScrubbing,
    )
    if (handoffFrame !== null) return handoffFrame
    return resolveLiveRelativeFrame(
      pos,
      state.currentFrame,
      state.previewFrame,
      state.isPlaying,
      isMainTimelineScrubbing,
      followTransientFrame,
    )
  }

  useLayoutEffect(() => {
    if (!ref.current) return
    // The local ruler drag owns the visual position until its queued scrub
    // frame catches up with a live edge-scroll. Reapplying settled props here
    // would briefly map the previous frame against the new scroll position.
    if (localScrubActiveRef?.current === true || mainTimelineScrubActiveRef.current) return
    const liveRelativeFrame = livePlaybackRelFrame()
    const x = clampLeft(liveRelativeFrame ?? posRef.current.relativeFrame)
    setTranslateXIfChanged(ref.current, x)
  })

  useEffect(() => {
    const update = () => {
      const liveRelativeFrame = livePlaybackRelFrame()
      const relativeFrame = liveRelativeFrame ?? posRef.current.relativeFrame
      if (ref.current) {
        setTranslateXIfChanged(ref.current, clampLeft(relativeFrame))
      }
    }
    const updateFromScroll = () => {
      // Edge scrolling broadcasts scrollLeft before the coalesced scrub frame.
      // Preserve the cursor-locked visual until the playback-store update.
      if (localScrubActiveRef?.current === true || mainTimelineScrubActiveRef.current) return
      update()
    }
    const updateFromScrubVisualFrame = (event: Event) => {
      const { viewportProgress } = (event as CustomEvent<TimelineScrubVisualFrameDetail>).detail
      if (!ref.current) return
      const viewportX = getTimelineScrubViewportX(viewportProgress, posRef.current.maxLeft)
      setTranslateXIfChanged(ref.current, viewportX)
    }
    const unsubscribe = usePlaybackStore.subscribe(update)
    const target = positionSyncTargetRef?.current
    target?.addEventListener('scroll', updateFromScroll, { passive: true })
    target?.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, updateFromScroll)
    target?.addEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, updateFromScrubVisualFrame)
    return () => {
      unsubscribe()
      target?.removeEventListener('scroll', updateFromScroll)
      target?.removeEventListener(TIMELINE_LIVE_SCROLL_EVENT, updateFromScroll)
      target?.removeEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, updateFromScrubVisualFrame)
    }
    // Positioning inputs are read from posRef so this subscription stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localScrubActiveRef, localScrubHandoffFrameRef, positionSyncTargetRef])

  return (
    <div ref={ref} data-testid="dopesheet-playhead-line" className={className}>
      <PlayheadMarks handle="flag" />
    </div>
  )
}
