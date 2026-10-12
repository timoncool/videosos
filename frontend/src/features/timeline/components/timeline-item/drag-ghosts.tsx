import { forwardRef, memo } from 'react'

interface FollowerDragGhostProps {
  left: number
  width: number
}

/**
 * Ghost element for every item participating in an alt-drag, including the anchor.
 * Visibility and transform are controlled by the same RAF path so the whole
 * duplicate preview paints in lockstep.
 */
export const FollowerDragGhost = memo(
  forwardRef<HTMLDivElement, FollowerDragGhostProps>(function FollowerDragGhost(
    { left, width },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className="absolute inset-y-0 rounded border-2 border-dashed border-primary bg-primary/20 pointer-events-none z-50"
        style={{
          left: `${left}px`,
          width: `${width}px`,
          display: 'none',
        }}
      >
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shadow-md">
          +
        </div>
      </div>
    )
  }),
)
