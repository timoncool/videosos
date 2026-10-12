import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { KeyframeMarqueeOverlay } from '../keyframe-marquee'
import { VerticalScrollbarOverlay } from '@/shared/ui/vertical-scrollbar-overlay'
import { PROPERTY_COLUMN_WIDTH, RULER_HEIGHT } from './dopesheet-constants'
import { DopesheetEmptyState } from './dopesheet-empty-state'

interface DopesheetSheetBodyProps {
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  hasRows: boolean
  emptyStateMessage: string
  showEmptyGuidance: boolean
  proceduralHint?: string
  rowElements: ReactNode
  marqueeOverlayRef: RefObject<HTMLDivElement | null>
  propertyColumnWidth?: number
  subtractRulerHeight?: boolean
  onTimelineBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}

interface MiddleRowPanState {
  startClientY: number
  startScrollTop: number
}

export function DopesheetSheetBody({
  scrollAreaRef,
  hasRows,
  emptyStateMessage,
  showEmptyGuidance,
  proceduralHint,
  rowElements,
  marqueeOverlayRef,
  propertyColumnWidth = PROPERTY_COLUMN_WIDTH,
  subtractRulerHeight = true,
  onTimelineBackgroundPointerDown,
}: DopesheetSheetBodyProps) {
  const middlePanRef = useRef<MiddleRowPanState | null>(null)

  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const finishMiddlePan = () => {
      if (!middlePanRef.current) return
      middlePanRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const beginMiddlePan = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (middlePanRef.current) return

      middlePanRef.current = {
        startClientY: event.clientY,
        startScrollTop: scrollArea.scrollTop,
      }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    const moveMiddlePan = (event: MouseEvent | PointerEvent) => {
      const pan = middlePanRef.current
      if (!pan) return
      event.preventDefault()
      event.stopPropagation()
      scrollArea.scrollTop = pan.startScrollTop - (event.clientY - pan.startClientY)
    }

    const preventMiddleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
    }

    scrollArea.addEventListener('pointerdown', beginMiddlePan, { capture: true })
    scrollArea.addEventListener('mousedown', beginMiddlePan, { capture: true })
    scrollArea.addEventListener('auxclick', preventMiddleAuxClick, { capture: true })
    window.addEventListener('pointermove', moveMiddlePan, { capture: true })
    window.addEventListener('mousemove', moveMiddlePan, { capture: true })
    window.addEventListener('pointerup', finishMiddlePan, { capture: true })
    window.addEventListener('pointercancel', finishMiddlePan, { capture: true })
    window.addEventListener('mouseup', finishMiddlePan, { capture: true })
    return () => {
      finishMiddlePan()
      scrollArea.removeEventListener('pointerdown', beginMiddlePan, { capture: true })
      scrollArea.removeEventListener('mousedown', beginMiddlePan, { capture: true })
      scrollArea.removeEventListener('auxclick', preventMiddleAuxClick, { capture: true })
      window.removeEventListener('pointermove', moveMiddlePan, { capture: true })
      window.removeEventListener('mousemove', moveMiddlePan, { capture: true })
      window.removeEventListener('pointerup', finishMiddlePan, { capture: true })
      window.removeEventListener('pointercancel', finishMiddlePan, { capture: true })
      window.removeEventListener('mouseup', finishMiddlePan, { capture: true })
    }
  }, [scrollAreaRef])

  return (
    <div
      data-testid="dopesheet-scroll-shell"
      className="relative"
      style={{
        height: subtractRulerHeight ? `calc(100% - ${RULER_HEIGHT}px)` : '100%',
      }}
    >
      <div
        ref={scrollAreaRef}
        data-testid="dopesheet-scroll-area"
        data-dopesheet-scroll-viewport
        className={
          subtractRulerHeight ? 'absolute inset-y-0 left-0 overflow-auto' : 'overflow-hidden'
        }
        style={{
          right: subtractRulerHeight ? 12 : 0,
          height: subtractRulerHeight ? undefined : '100%',
          scrollbarWidth: subtractRulerHeight ? 'none' : undefined,
        }}
      >
        {!hasRows ? (
          <DopesheetEmptyState
            showGuidance={showEmptyGuidance}
            fallbackMessage={emptyStateMessage}
            proceduralHint={proceduralHint}
          />
        ) : (
          <div className="relative min-h-full">
            <div
              data-testid="dopesheet-selection-surface"
              className="absolute inset-y-0 right-0 z-0"
              style={{ left: propertyColumnWidth }}
              onPointerDown={onTimelineBackgroundPointerDown}
            />
            <div className="relative z-10">{rowElements}</div>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-20"
              style={{ left: propertyColumnWidth }}
            >
              <KeyframeMarqueeOverlay ref={marqueeOverlayRef} rect={null} persistent />
            </div>
          </div>
        )}
      </div>
      {subtractRulerHeight ? (
        <VerticalScrollbarOverlay
          scrollRef={scrollAreaRef}
          ariaLabel="Keyframe timeline scrollbar"
          className="absolute inset-y-0 right-0 w-3 bg-background/80"
          testId="dopesheet-scrollbar"
        />
      ) : null}
    </div>
  )
}
