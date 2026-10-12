import { useLayoutEffect, useRef } from 'react'
import type {
  MotionPickWhipOverlaySnapshot,
  MotionPickWhipPresentation,
} from '@/shared/hooks/use-pick-whip-drag'

function getOverlayGeometry(drag: MotionPickWhipOverlaySnapshot) {
  const controlDistance = Math.max(48, Math.abs(drag.currentX - drag.startX) * 0.45)
  return {
    color: drag.valid
      ? 'rgb(251 146 60)'
      : drag.rejectionMessage
        ? 'rgb(248 113 113)'
        : 'rgb(148 163 184)',
    clipWidth: Math.max(0, drag.clipBounds.right - drag.clipBounds.left),
    clipHeight: Math.max(0, drag.clipBounds.bottom - drag.clipBounds.top),
    path: `M ${drag.startX} ${drag.startY} C ${drag.startX + controlDistance} ${drag.startY}, ${drag.currentX - controlDistance} ${drag.currentY}, ${drag.currentX} ${drag.currentY}`,
  }
}

const FEEDBACK_MAX_WIDTH = 280
const FEEDBACK_HEIGHT = 34
const FEEDBACK_GAP = 12
const FEEDBACK_VIEWPORT_INSET = 8

function getFeedbackPosition(drag: MotionPickWhipOverlaySnapshot) {
  const availableWidth = Math.max(
    0,
    drag.clipBounds.right - drag.clipBounds.left - FEEDBACK_VIEWPORT_INSET * 2,
  )
  const width = Math.min(FEEDBACK_MAX_WIDTH, availableWidth)
  const minLeft = drag.clipBounds.left + FEEDBACK_VIEWPORT_INSET
  const maxLeft = Math.max(minLeft, drag.clipBounds.right - width - FEEDBACK_VIEWPORT_INSET)
  const left = Math.min(maxLeft, Math.max(minLeft, drag.currentX + FEEDBACK_GAP))
  const below = drag.currentY + FEEDBACK_GAP
  const above = drag.currentY - FEEDBACK_HEIGHT - FEEDBACK_GAP
  const top =
    below + FEEDBACK_HEIGHT <= drag.clipBounds.bottom - FEEDBACK_VIEWPORT_INSET
      ? below
      : Math.max(drag.clipBounds.top + FEEDBACK_VIEWPORT_INSET, above)
  return { left, top, width }
}

export function PickWhipOverlay({
  presentation,
  testId,
}: {
  presentation: MotionPickWhipPresentation
  testId: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const circleRef = useRef<SVGCircleElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const initialDrag = presentation.current
  const initialGeometry = getOverlayGeometry(initialDrag)
  const initialFeedbackPosition = getFeedbackPosition(initialDrag)

  useLayoutEffect(
    () =>
      presentation.subscribe((drag) => {
        const svg = svgRef.current
        const path = pathRef.current
        const circle = circleRef.current
        const feedback = feedbackRef.current
        if (!svg || !path || !circle || !feedback) return
        const geometry = getOverlayGeometry(drag)
        const feedbackPosition = getFeedbackPosition(drag)
        svg.setAttribute(
          'viewBox',
          `${drag.clipBounds.left} ${drag.clipBounds.top} ${geometry.clipWidth} ${geometry.clipHeight}`,
        )
        svg.style.left = `${drag.clipBounds.left}px`
        svg.style.top = `${drag.clipBounds.top}px`
        svg.style.width = `${geometry.clipWidth}px`
        svg.style.height = `${geometry.clipHeight}px`
        path.setAttribute('d', geometry.path)
        path.setAttribute('stroke', geometry.color)
        if (drag.valid) path.removeAttribute('stroke-dasharray')
        else path.setAttribute('stroke-dasharray', '4 4')
        circle.setAttribute('cx', String(drag.currentX))
        circle.setAttribute('cy', String(drag.currentY))
        circle.setAttribute('fill', geometry.color)
        feedback.textContent = drag.rejectionMessage ?? ''
        feedback.style.display = drag.rejectionMessage ? 'block' : 'none'
        feedback.style.left = `${feedbackPosition.left}px`
        feedback.style.top = `${feedbackPosition.top}px`
        feedback.style.width = `${feedbackPosition.width}px`
      }),
    [presentation],
  )

  return (
    <>
      <svg
        ref={svgRef}
        className="pointer-events-none fixed z-[100] overflow-hidden"
        aria-hidden="true"
        data-testid={testId}
        viewBox={`${initialDrag.clipBounds.left} ${initialDrag.clipBounds.top} ${initialGeometry.clipWidth} ${initialGeometry.clipHeight}`}
        style={{
          left: initialDrag.clipBounds.left,
          top: initialDrag.clipBounds.top,
          width: initialGeometry.clipWidth,
          height: initialGeometry.clipHeight,
        }}
      >
        <path
          ref={pathRef}
          d={initialGeometry.path}
          fill="none"
          stroke={initialGeometry.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={initialDrag.valid ? undefined : '4 4'}
        />
        <circle
          ref={circleRef}
          cx={initialDrag.currentX}
          cy={initialDrag.currentY}
          r="4"
          fill={initialGeometry.color}
        />
      </svg>
      <div
        ref={feedbackRef}
        role="status"
        aria-live="polite"
        data-testid={`${testId}-feedback`}
        className="pointer-events-none fixed z-[101] rounded-md border border-red-400/40 bg-background/95 px-2 py-1.5 text-[10px] font-medium leading-tight text-red-300 shadow-lg backdrop-blur-sm"
        style={{
          display: initialDrag.rejectionMessage ? 'block' : 'none',
          left: initialFeedbackPosition.left,
          top: initialFeedbackPosition.top,
          width: initialFeedbackPosition.width,
        }}
      >
        {initialDrag.rejectionMessage}
      </div>
    </>
  )
}
