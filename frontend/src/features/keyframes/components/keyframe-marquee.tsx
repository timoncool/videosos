import { forwardRef, type CSSProperties } from 'react'
import { cn } from '@/shared/ui/cn'

export interface KeyframeMarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

export const KEYFRAME_MARQUEE_THRESHOLD = 2

const KEYFRAME_MARQUEE_CLASSNAME =
  'absolute border border-primary/70 bg-primary/20 pointer-events-none z-20'

interface KeyframeMarqueeOverlayProps {
  rect: KeyframeMarqueeRect | null
  /** Keep the node mounted so pointer hot paths can update it without React renders. */
  persistent?: boolean
  className?: string
  style?: CSSProperties
}

export const KeyframeMarqueeOverlay = forwardRef<HTMLDivElement, KeyframeMarqueeOverlayProps>(
  function KeyframeMarqueeOverlay({ rect, persistent = false, className, style }, ref) {
    if (!rect && !persistent) return null

    return (
      <div
        ref={ref}
        aria-hidden
        hidden={!rect}
        className={cn(KEYFRAME_MARQUEE_CLASSNAME, 'left-0 top-0 will-change-transform', className)}
        style={{
          transform: rect ? `translate3d(${rect.x}px, ${rect.y}px, 0)` : undefined,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          ...style,
        }}
      />
    )
  },
)

interface KeyframeSvgMarqueeProps {
  rect: KeyframeMarqueeRect | null
}

export function KeyframeSvgMarquee({ rect }: KeyframeSvgMarqueeProps) {
  if (!rect) return null

  return (
    <rect
      className="text-primary"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill="currentColor"
      fillOpacity={0.2}
      pointerEvents="none"
      stroke="currentColor"
      strokeOpacity={0.7}
      strokeWidth={1}
    />
  )
}
