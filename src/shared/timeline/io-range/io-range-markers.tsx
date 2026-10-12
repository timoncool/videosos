import { memo, type PointerEvent as ReactPointerEvent } from 'react'

import { cn } from '@/shared/ui/cn'
import { computeIoGripWidth, IO_HANDLE_COLOR, IO_HANDLE_WIDTH } from './io-range-geometry'

/**
 * Single source of truth for in/out (IO) range markers, shared by every
 * workspace that renders an IO bar: the Edit-workspace timeline ruler
 * (`timeline-in-out-markers` / `timeline-markers`), the Color/Animate
 * mini-timeline (`mini-timeline-io-lane`), and the source monitor
 * (`source-monitor`). Consolidating the grip/strip markup + geometry here means
 * a bug (e.g. handles overlapping into a solid block when the range collapses to
 * a few pixels at low zoom / short ranges) is fixed once, not three times.
 *
 * Positions are passed as CSS `left`/`width` strings so callers stay in whatever
 * coordinate space is natural (absolute px for the scrollable ruler, `%` for the
 * fixed-width lanes). The pixel span between in and out (`spanPx`) is passed
 * separately and used only to keep the two side grips from overlapping.
 */

const DEFAULT_HIT_WIDTH = 18
const DEFAULT_HIT_HEIGHT_EXTRA = 6

// Block the compatibility mousedown so mouse-driven scrub surfaces underneath
// (Edit ruler, source-monitor seek bar) don't also seek when a marker is
// grabbed. The real drag runs on pointerdown; pointer-driven scrub surfaces
// (mini-timeline) are stopped by the drag handler's own stopPropagation.
function blockMouseDown(e: { preventDefault: () => void; stopPropagation: () => void }) {
  e.preventDefault()
  e.stopPropagation()
}

/**
 * Extra `data-*` attributes for the positioned element. The Motion timeline uses
 * these to drive the strip/handles imperatively during a zoom or pan gesture,
 * before React re-renders with the settled viewport.
 */
type PositionDataset = Record<`data-${string}`, string>

interface IoRangeStripProps {
  /** CSS `left` of the strip within the caller's coordinate box. */
  left: string
  /** CSS `width` of the strip. */
  width: string
  /** Lane height in px. */
  height: number
  onDragStart?: (e: ReactPointerEvent) => void
  title?: string
  testId?: string
  className?: string
  /** Stacking order within the caller's lane. Defaults suit the Edit ruler; the
      mini-timeline passes lower values so the strip stays under its playhead. */
  zIndex?: number
  dataset?: PositionDataset
}

/**
 * The draggable range strip (slide the whole in/out range, preserving length).
 * Flat muted-gray bar — the blue accent lives on the handles.
 */
export const IoRangeStrip = memo(function IoRangeStrip({
  left,
  width,
  height,
  onDragStart,
  title,
  testId,
  className,
  zIndex = 11,
  dataset,
}: IoRangeStripProps) {
  return (
    <div
      data-testid={testId}
      {...dataset}
      title={title}
      className={cn('absolute', onDragStart && 'cursor-grab active:cursor-grabbing', className)}
      style={{
        left,
        width,
        top: 0,
        height,
        // Never let the bar vanish when the range is sub-pixel at low zoom.
        minWidth: 2,
        background: 'color-mix(in oklch, var(--muted-foreground) 82%, black)',
        border: '1px solid color-mix(in oklch, var(--muted-foreground) 70%, transparent)',
        borderRadius: 5,
        zIndex,
        pointerEvents: onDragStart ? 'auto' : 'none',
      }}
      onPointerDown={onDragStart}
      onMouseDown={onDragStart ? blockMouseDown : undefined}
    />
  )
})

interface HandleProps {
  side: 'in' | 'out'
  left: string
  gripWidth: number
  laneHeight: number
  hitWidth: number
  hitHeightExtra: number
  zIndex: number
  onDragStart?: (e: ReactPointerEvent) => void
  title?: string
  testId?: string
  dataset?: PositionDataset
}

function Handle({
  side,
  left,
  gripWidth,
  laneHeight,
  hitWidth,
  hitHeightExtra,
  zIndex,
  onDragStart,
  title,
  testId,
  dataset,
}: HandleProps) {
  return (
    <div
      className="absolute top-0"
      title={title}
      {...dataset}
      style={{ left, width: 0, height: '100%', pointerEvents: 'none', zIndex }}
    >
      {/* Side grip — brighter blue pill, rounded outer corners, top sheen. Shrinks
          to half the range so the two grips meet rather than overlap when narrow. */}
      <div
        aria-hidden="true"
        data-testid={testId}
        data-motion-static-x
        className="absolute pointer-events-none"
        style={{
          top: 0,
          left: side === 'in' ? 0 : -gripWidth,
          width: gripWidth,
          height: laneHeight,
          borderRadius: side === 'in' ? '5px 1px 1px 5px' : '1px 5px 5px 1px',
          background: `linear-gradient(to bottom, color-mix(in oklch, ${IO_HANDLE_COLOR} 92%, white), color-mix(in oklch, ${IO_HANDLE_COLOR} 78%, black))`,
          boxShadow: `inset 0 1px 0 color-mix(in oklch, white 35%, transparent), 0 0 2px color-mix(in oklch, ${IO_HANDLE_COLOR} 45%, transparent)`,
        }}
      />

      {/* Wide invisible hit area, centered on the point, for easy grabbing. */}
      {onDragStart && (
        <div
          data-motion-static-x
          className="absolute pointer-events-auto"
          style={{
            top: 0,
            left: -hitWidth / 2,
            width: hitWidth,
            height: laneHeight + hitHeightExtra,
            cursor: 'col-resize',
            zIndex: 23,
          }}
          onPointerDown={onDragStart}
          onMouseDown={blockMouseDown}
        />
      )}
    </div>
  )
}

interface IoRangeHandlesProps {
  /** CSS `left` of the in point, or null when unset. */
  inLeft: string | null
  /** CSS `left` of the out point, or null when unset. */
  outLeft: string | null
  /** Pixel distance between in and out (for collapse-safe grip sizing). */
  spanPx: number | null
  laneHeight: number
  handleWidth?: number
  hitWidth?: number
  hitHeightExtra?: number
  onInDragStart?: (e: ReactPointerEvent) => void
  onOutDragStart?: (e: ReactPointerEvent) => void
  inTitle?: string
  outTitle?: string
  /** Prefix for `{prefix}-in-handle` / `{prefix}-out-handle` test ids. */
  testIdPrefix?: string
  inDataset?: PositionDataset
  outDataset?: PositionDataset
  /** Stacking order within the caller's lane (see {@link IoRangeStripProps}). */
  zIndex?: number
}

/**
 * The two collapse-safe in/out drag handles (grip + hit area each). Render after
 * {@link IoRangeStrip} so the grips paint above the bar.
 */
export const IoRangeHandles = memo(function IoRangeHandles({
  inLeft,
  outLeft,
  spanPx,
  laneHeight,
  handleWidth = IO_HANDLE_WIDTH,
  hitWidth = DEFAULT_HIT_WIDTH,
  hitHeightExtra = DEFAULT_HIT_HEIGHT_EXTRA,
  onInDragStart,
  onOutDragStart,
  inTitle,
  outTitle,
  testIdPrefix,
  inDataset,
  outDataset,
  zIndex = 22,
}: IoRangeHandlesProps) {
  const gripWidth = computeIoGripWidth(spanPx, handleWidth)
  return (
    <>
      {inLeft !== null && (
        <Handle
          side="in"
          left={inLeft}
          gripWidth={gripWidth}
          laneHeight={laneHeight}
          hitWidth={hitWidth}
          hitHeightExtra={hitHeightExtra}
          zIndex={zIndex}
          onDragStart={onInDragStart}
          title={inTitle}
          testId={testIdPrefix ? `${testIdPrefix}-in-handle` : undefined}
          dataset={inDataset}
        />
      )}
      {outLeft !== null && (
        <Handle
          side="out"
          left={outLeft}
          gripWidth={gripWidth}
          laneHeight={laneHeight}
          hitWidth={hitWidth}
          hitHeightExtra={hitHeightExtra}
          zIndex={zIndex}
          onDragStart={onOutDragStart}
          title={outTitle}
          testId={testIdPrefix ? `${testIdPrefix}-out-handle` : undefined}
          dataset={outDataset}
        />
      )}
    </>
  )
})
