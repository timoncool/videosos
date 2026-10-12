import { useCallback, useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { withPerfMeasure } from '@/shared/logging/perf-marks'

interface VerticalScrollbarOverlayProps {
  scrollRef?: RefObject<HTMLDivElement | null>
  ariaLabel: string
  ariaControls?: string
  className?: string
  style?: CSSProperties
  layoutDependency?: unknown
  testId?: string
}

/** Shared imperative scrollbar used by timeline surfaces with hidden native rails. */
export function VerticalScrollbarOverlay({
  scrollRef,
  ariaLabel,
  ariaControls,
  className,
  style,
  layoutDependency,
  testId,
}: VerticalScrollbarOverlayProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const dragOffsetRef = useRef(0)
  const detachDragListenersRef = useRef<(() => void) | null>(null)
  const layoutRef = useRef({ thumbHeight: 0, maxThumbTravel: 0, overflowHeight: 0 })
  const railInset = 4

  const updateThumbLayout = useCallback(() => {
    const element = scrollRef?.current
    const rail = railRef.current
    const thumb = thumbRef.current
    if (!element || !rail || !thumb) return

    const clientHeight = element.clientHeight
    const scrollHeight = element.scrollHeight
    const overflowHeight = scrollHeight - clientHeight
    const railHeight = Math.max(0, rail.clientHeight - railInset * 2)
    const thumbHeight =
      overflowHeight > 0
        ? Math.min(railHeight, Math.max(24, (clientHeight / scrollHeight) * railHeight))
        : 0
    const maxThumbTravel = Math.max(0, railHeight - thumbHeight)
    const thumbTop = overflowHeight > 0 ? (element.scrollTop / overflowHeight) * maxThumbTravel : 0

    layoutRef.current = { thumbHeight, maxThumbTravel, overflowHeight }
    thumb.style.height = `${thumbHeight}px`
    thumb.style.top = `${railInset + thumbTop}px`
    thumb.style.display = thumbHeight > 0 ? '' : 'none'
  }, [scrollRef])

  const updateThumbPosition = useCallback(() => {
    const element = scrollRef?.current
    const thumb = thumbRef.current
    if (!element || !thumb) return

    const { maxThumbTravel, overflowHeight } = layoutRef.current
    if (overflowHeight <= 0 || maxThumbTravel <= 0) return
    thumb.style.top = `${railInset + (element.scrollTop / overflowHeight) * maxThumbTravel}px`
  }, [scrollRef])

  useEffect(() => {
    const element = scrollRef?.current
    if (!element) return

    let scrollFrameId = 0
    const scheduleThumbUpdate = () => {
      if (scrollFrameId !== 0) return
      scrollFrameId = window.requestAnimationFrame(() => {
        scrollFrameId = 0
        withPerfMeasure('tl.raf.scrollThumb', updateThumbPosition)
      })
    }
    const resizeObserver = new ResizeObserver(updateThumbLayout)
    resizeObserver.observe(element)
    const contentElement = element.firstElementChild
    if (contentElement instanceof HTMLElement) resizeObserver.observe(contentElement)
    element.addEventListener('scroll', scheduleThumbUpdate, { passive: true })
    updateThumbLayout()

    return () => {
      if (scrollFrameId !== 0) cancelAnimationFrame(scrollFrameId)
      element.removeEventListener('scroll', scheduleThumbUpdate)
      resizeObserver.disconnect()
    }
  }, [scrollRef, updateThumbLayout, updateThumbPosition])

  useEffect(() => {
    updateThumbLayout()
  }, [layoutDependency, updateThumbLayout])

  const syncScrollFromClientY = useCallback(
    (clientY: number) => {
      const rail = railRef.current
      const element = scrollRef?.current
      const { maxThumbTravel, overflowHeight } = layoutRef.current
      if (!rail || !element || maxThumbTravel <= 0 || overflowHeight <= 0) return
      const railRect = rail.getBoundingClientRect()
      const nextThumbTop = Math.max(
        0,
        Math.min(maxThumbTravel, clientY - railRect.top - dragOffsetRef.current),
      )
      element.scrollTop = (nextThumbTop / maxThumbTravel) * overflowHeight
    },
    [scrollRef],
  )

  const stopDragging = useCallback(() => {
    detachDragListenersRef.current?.()
    detachDragListenersRef.current = null
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => stopDragging, [stopDragging])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const thumbRect = thumbRef.current?.getBoundingClientRect()
      const startedOnThumb =
        !!thumbRect && event.clientY >= thumbRect.top && event.clientY <= thumbRect.bottom
      dragOffsetRef.current =
        startedOnThumb && thumbRect
          ? event.clientY - thumbRect.top
          : layoutRef.current.thumbHeight / 2
      syncScrollFromClientY(event.clientY)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault()
        syncScrollFromClientY(moveEvent.clientY)
      }
      const handlePointerUp = () => stopDragging()
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerUp, { passive: true })
      window.addEventListener('pointercancel', handlePointerUp, { passive: true })
      detachDragListenersRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
    },
    [stopDragging, syncScrollFromClientY],
  )

  return (
    <div
      data-testid={testId}
      className={className}
      style={style}
      role="scrollbar"
      aria-label={ariaLabel}
      aria-controls={ariaControls}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
    >
      <div ref={railRef} className="absolute inset-y-1 inset-x-0.5 rounded-sm bg-secondary/70">
        <div
          ref={thumbRef}
          className="absolute inset-x-0 cursor-grab rounded-sm bg-muted-foreground/55 transition-colors hover:bg-muted-foreground/70 active:cursor-grabbing active:bg-muted-foreground/75"
        />
      </div>
    </div>
  )
}
