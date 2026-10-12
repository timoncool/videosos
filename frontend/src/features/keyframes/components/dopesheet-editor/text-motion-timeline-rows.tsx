import { memo, useCallback, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import { getTextMotionPreset } from '@/shared/typography/text-motion'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import type { TextMotionSlot } from '@/types/text-motion'

const DRAG_THRESHOLD_PX = 3

function getTimelineGridLineStyle(
  ticks: readonly number[],
  frameToX: (frame: number) => number,
): CSSProperties {
  const positions = ticks.map((frame) => Math.round(frameToX(frame)))
  const left = positions[0] ?? 0
  return {
    left,
    boxShadow: positions
      .slice(1)
      .map((position) => `${position - left}px 0 currentColor`)
      .join(', '),
  }
}

interface TextMotionTimelineRowsProps {
  bands: readonly TextMotionTimelineBand[]
  gridStyle: CSSProperties
  ticks: readonly number[]
  axisWidth: number
  frameToX: (frame: number) => number
  getPixelsPerFrame: () => number
  disabled: boolean
  onBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDurationDragStart?: () => void
  onDurationCommit?: (slot: TextMotionSlot, durationFrames: number) => void
  onDurationCancel?: () => void
  onOffsetDragStart?: () => void
  onOffsetCommit?: (slot: TextMotionSlot, offsetFrames: number) => void
  onOffsetCancel?: () => void
  onBandClick?: (slot: TextMotionSlot) => void
}

interface DurationDrag {
  pointerId: number
  slot: TextMotionSlot
  startX: number
  startDurationFrames: number
  currentDurationFrames: number
  started: boolean
}

interface OffsetDrag {
  pointerId: number
  slot: 'in' | 'out'
  startX: number
  startOffsetFrames: number
  currentOffsetFrames: number
  maxOffsetFrames: number
  started: boolean
}

function getMaxOffsetFrames(
  band: TextMotionTimelineBand,
  bands: readonly TextMotionTimelineBand[],
): number {
  const length = band.toFrame - band.fromFrame
  if (band.slot === 'in') {
    const outBand = bands.find((candidate) => candidate.slot === 'out')
    const boundary = outBand?.fromFrame ?? band.clipToFrame
    return Math.max(0, Math.floor(boundary - band.clipFromFrame - length))
  }
  if (band.slot === 'out') {
    const inBand = bands.find((candidate) => candidate.slot === 'in')
    const boundary = inBand?.toFrame ?? band.clipFromFrame
    return Math.max(0, Math.floor(band.clipToFrame - boundary - length))
  }
  return 0
}

export const TextMotionTimelineRows = memo(function TextMotionTimelineRows({
  bands,
  gridStyle,
  ticks,
  axisWidth,
  frameToX,
  getPixelsPerFrame,
  disabled,
  onBackgroundPointerDown,
  onDurationDragStart,
  onDurationCommit,
  onDurationCancel,
  onOffsetDragStart,
  onOffsetCommit,
  onOffsetCancel,
  onBandClick,
}: TextMotionTimelineRowsProps) {
  const { t } = useTranslation()
  const durationDragRef = useRef<DurationDrag | null>(null)
  const offsetDragRef = useRef<OffsetDrag | null>(null)
  const suppressClickRef = useRef(false)
  const [previewDurationBySlot, setPreviewDurationBySlot] = useState<
    Partial<Record<TextMotionSlot, number>>
  >({})
  const [previewOffsetBySlot, setPreviewOffsetBySlot] = useState<
    Partial<Record<TextMotionSlot, number>>
  >({})

  const beginDurationDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, band: TextMotionTimelineBand) => {
      if (disabled || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      suppressClickRef.current = false
      durationDragRef.current = {
        pointerId: event.pointerId,
        slot: band.slot,
        startX: event.clientX,
        startDurationFrames: band.durationFrames,
        currentDurationFrames: band.durationFrames,
        started: false,
      }
    },
    [disabled],
  )

  const moveDurationDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = durationDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const deltaX = event.clientX - drag.startX
      if (!drag.started) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) return
        drag.started = true
        onDurationDragStart?.()
      }
      const pixelsPerFrame = Math.max(getPixelsPerFrame(), Number.EPSILON)
      const deltaFrames = Math.round(deltaX / pixelsPerFrame)
      const directedDelta = drag.slot === 'out' ? -deltaFrames : deltaFrames
      const durationFrames = Math.max(1, drag.startDurationFrames + directedDelta)
      if (durationFrames === drag.currentDurationFrames) return
      drag.currentDurationFrames = durationFrames
      setPreviewDurationBySlot((previous) => ({ ...previous, [drag.slot]: durationFrames }))
    },
    [getPixelsPerFrame, onDurationDragStart],
  )

  const finishDurationDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
      const drag = durationDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      durationDragRef.current = null
      suppressClickRef.current = drag.started
      if (drag.started) {
        if (commit) {
          onDurationCommit?.(drag.slot, drag.currentDurationFrames)
        } else {
          onDurationCancel?.()
        }
      }
      setPreviewDurationBySlot((previous) => {
        if (previous[drag.slot] === undefined) return previous
        const next = { ...previous }
        delete next[drag.slot]
        return next
      })
    },
    [onDurationCancel, onDurationCommit],
  )

  const beginOffsetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, band: TextMotionTimelineBand) => {
      if (event.button !== 0) return
      if (band.slot === 'loop') {
        event.stopPropagation()
        return
      }
      if (disabled) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      suppressClickRef.current = false
      offsetDragRef.current = {
        pointerId: event.pointerId,
        slot: band.slot,
        startX: event.clientX,
        startOffsetFrames: band.offsetFrames,
        currentOffsetFrames: band.offsetFrames,
        maxOffsetFrames: getMaxOffsetFrames(band, bands),
        started: false,
      }
    },
    [bands, disabled],
  )

  const moveOffsetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = offsetDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const deltaX = event.clientX - drag.startX
      if (!drag.started) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) return
        drag.started = true
        onOffsetDragStart?.()
      }
      const pixelsPerFrame = Math.max(getPixelsPerFrame(), Number.EPSILON)
      const deltaFrames = Math.round(deltaX / pixelsPerFrame)
      const directedDelta = drag.slot === 'out' ? -deltaFrames : deltaFrames
      const offsetFrames = Math.min(
        drag.maxOffsetFrames,
        Math.max(0, drag.startOffsetFrames + directedDelta),
      )
      if (offsetFrames === drag.currentOffsetFrames) return
      drag.currentOffsetFrames = offsetFrames
      setPreviewOffsetBySlot((previous) => ({ ...previous, [drag.slot]: offsetFrames }))
    },
    [getPixelsPerFrame, onOffsetDragStart],
  )

  const finishOffsetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
      const drag = offsetDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      offsetDragRef.current = null
      suppressClickRef.current = drag.started
      if (drag.started) {
        if (commit) {
          onOffsetCommit?.(drag.slot, drag.currentOffsetFrames)
        } else {
          onOffsetCancel?.()
        }
      }
      setPreviewOffsetBySlot((previous) => {
        if (previous[drag.slot] === undefined) return previous
        const next = { ...previous }
        delete next[drag.slot]
        return next
      })
    },
    [onOffsetCancel, onOffsetCommit],
  )

  const getDurationDelta = (slot: TextMotionSlot) => {
    const band = bands.find((candidate) => candidate.slot === slot)
    if (!band) return 0
    return (previewDurationBySlot[slot] ?? band.durationFrames) - band.durationFrames
  }
  const getOffsetDelta = (slot: TextMotionSlot) => {
    const band = bands.find((candidate) => candidate.slot === slot)
    if (!band) return 0
    return (previewOffsetBySlot[slot] ?? band.offsetFrames) - band.offsetFrames
  }

  return bands.map((band) => {
    const previewDuration = previewDurationBySlot[band.slot] ?? band.durationFrames
    const durationDelta = previewDuration - band.durationFrames
    const previewOffset = previewOffsetBySlot[band.slot] ?? band.offsetFrames
    const offsetDelta = previewOffset - band.offsetFrames
    const previewFrom =
      band.slot === 'in'
        ? band.fromFrame + offsetDelta
        : band.slot === 'out'
          ? band.fromFrame - offsetDelta - durationDelta
          : band.fromFrame + getOffsetDelta('in') + getDurationDelta('in')
    const rawPreviewTo =
      band.slot === 'in'
        ? band.toFrame + offsetDelta + durationDelta
        : band.slot === 'out'
          ? band.toFrame - offsetDelta
          : band.toFrame - getOffsetDelta('out') - getDurationDelta('out')
    const previewTo = Math.max(previewFrom, rawPreviewTo)
    const left = frameToX(previewFrom)
    const width = Math.max(3, frameToX(previewTo) - left)
    const loopHandleFrame = Math.min(previewTo, previewFrom + previewDuration)
    const loopHandleLeft = frameToX(loopHandleFrame) - left
    const preset = getTextMotionPreset(band.presetId)
    const presetLabel = t(preset.labelKey)
    const slotLabel = band.slot.toUpperCase()
    const offsetLabel =
      band.slot !== 'loop' && previewOffset > 0 ? ` · offset ${previewOffset}f` : ''
    const title = `${slotLabel} · ${presetLabel} · ${previewDuration}f${offsetLabel} · ×${band.unitCount}`

    return (
      <div
        key={band.slot}
        data-testid={`edit-text-motion-row-${band.slot}`}
        className="grid w-full border-b border-border/60"
        style={gridStyle}
      >
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 overflow-hidden px-2 text-left text-[11px] hover:bg-muted/40"
          disabled={disabled}
          onClick={() => onBandClick?.(band.slot)}
          title={title}
        >
          <span className="w-8 shrink-0 font-medium text-sky-300">{slotLabel}</span>
          <span className="truncate text-muted-foreground">{presetLabel}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
            {previewDuration}f
          </span>
        </button>
        <div
          className="relative h-full overflow-hidden border-l border-border/60"
          onPointerDown={onBackgroundPointerDown}
        >
          <div
            data-motion-viewport-surface
            data-motion-viewport-edge-inset={0}
            data-motion-viewport-axis-width={axisWidth}
            className="absolute inset-0"
          >
            <div
              aria-hidden
              data-motion-grid-frames={ticks.join(',')}
              className="pointer-events-none absolute inset-y-0 w-px bg-current text-border/30"
              style={getTimelineGridLineStyle(ticks, frameToX)}
            />
            <div
              role="button"
              tabIndex={disabled ? -1 : 0}
              data-testid={`edit-text-motion-band-${band.slot}`}
              data-from-frame={previewFrom}
              data-to-frame={previewTo}
              data-dopesheet-from-frame={previewFrom}
              data-dopesheet-to-frame={previewTo}
              data-dopesheet-min-width={3}
              aria-label={title}
              aria-disabled={disabled}
              title={title}
              className={cn(
                'group absolute top-1/2 z-10 h-3 -translate-y-1/2 bg-transparent aria-disabled:cursor-default aria-disabled:opacity-50',
                band.slot === 'loop'
                  ? 'cursor-pointer'
                  : 'touch-none cursor-grab active:cursor-grabbing',
              )}
              style={{ left, width }}
              onPointerDown={(event) => beginOffsetDrag(event, band)}
              onPointerMove={moveOffsetDrag}
              onPointerUp={(event) => finishOffsetDrag(event, true)}
              onPointerCancel={(event) => finishOffsetDrag(event, false)}
              onClick={(event) => {
                event.stopPropagation()
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                onBandClick?.(band.slot)
              }}
              onKeyDown={(event) => {
                if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                onBandClick?.(band.slot)
              }}
            >
              <span
                aria-hidden
                data-testid={`edit-text-motion-band-${band.slot}-visual`}
                className="pointer-events-none absolute inset-0 rounded-[2px] bg-sky-400/40"
              />
              <button
                type="button"
                data-testid={`edit-text-motion-band-${band.slot}-handle`}
                aria-label={`${slotLabel} Text Animation duration handle`}
                title={`${slotLabel} duration · ${previewDuration}f`}
                disabled={disabled}
                className={cn(
                  'absolute inset-y-0 z-10 w-2 bg-transparent transition-colors enabled:cursor-ew-resize enabled:hover:bg-sky-100/10 disabled:cursor-default',
                  band.slot === 'out' && 'left-0',
                  band.slot === 'in' && 'right-0',
                )}
                style={
                  band.slot === 'loop'
                    ? {
                        left: loopHandleLeft,
                        transform: 'translateX(-50%)',
                      }
                    : undefined
                }
                data-dopesheet-relative-frame={band.slot === 'loop' ? loopHandleFrame : undefined}
                onPointerDown={(event) => beginDurationDrag(event, band)}
                onPointerMove={moveDurationDrag}
                onPointerUp={(event) => finishDurationDrag(event, true)}
                onPointerCancel={(event) => finishDurationDrag(event, false)}
                onClick={(event) => {
                  event.stopPropagation()
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  onBandClick?.(band.slot)
                }}
              >
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-y-0.5 w-px rounded-full bg-sky-100/80 shadow-[0_0_0_1px_rgba(2,132,199,0.22)] transition-colors group-hover:bg-sky-50',
                    band.slot === 'out'
                      ? 'left-0.5'
                      : band.slot === 'in'
                        ? 'right-0.5'
                        : 'left-1/2 -translate-x-1/2',
                  )}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  })
})
