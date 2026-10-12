import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/shared/ui/cn'
import { useRafCoalescedValue } from '../use-raf-coalesced-value'
import { clampZoomValue, setPointerCaptureSafely } from './dopesheet-utils'

export interface MiniZoomControlProps {
  icon: ReactNode
  label: string
  value: number
  disabled?: boolean
  onValueChange: (value: number) => void
  onReset?: () => void
}

export function MiniZoomControl({
  icon,
  label,
  value,
  disabled = false,
  onValueChange,
  onReset,
}: MiniZoomControlProps) {
  const trackRef = useRef<HTMLButtonElement | null>(null)
  const { queue: queueValueChange, flushNow: flushValueChange } =
    useRafCoalescedValue(onValueChange)

  const updateValueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) {
        return
      }

      const rect = track.getBoundingClientRect()
      const horizontalPadding = 4
      const usableWidth = Math.max(1, rect.width - horizontalPadding * 2)
      const nextValue = ((clientX - rect.left - horizontalPadding) / usableWidth) * 100
      queueValueChange(clampZoomValue(nextValue))
    },
    [queueValueChange],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || event.button !== 0) {
        return
      }

      event.preventDefault()
      setPointerCaptureSafely(event.currentTarget, event.pointerId)
      updateValueFromClientX(event.clientX)
    },
    [disabled, updateValueFromClientX],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) {
        return
      }

      updateValueFromClientX(event.clientX)
    },
    [disabled, updateValueFromClientX],
  )

  const handlePointerRelease = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      flushValueChange()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [flushValueChange],
  )

  const handleDoubleClick = useCallback(() => {
    // Commit any pointer value first so it cannot overwrite the reset on the
    // next animation frame.
    flushValueChange()
    onReset?.()
  }, [flushValueChange, onReset])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault()
        onValueChange(clampZoomValue(value - 5))
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault()
        onValueChange(clampZoomValue(value + 5))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onValueChange(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        onValueChange(100)
      }
    },
    [disabled, onValueChange, value],
  )

  const thumbLeft = `calc(4px + ${(clampZoomValue(value) / 100).toFixed(4)} * (100% - 8px))`

  return (
    <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-1 py-0.5">
      <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">{icon}</span>
      <button
        ref={trackRef}
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampZoomValue(value))}
        disabled={disabled}
        title={onReset ? `${label} - double-click to reset` : label}
        className={cn(
          'relative h-5 w-16 rounded-sm outline-none transition-colors',
          disabled ? 'cursor-default opacity-50' : 'cursor-ew-resize',
        )}
        onDoubleClick={onReset ? handleDoubleClick : undefined}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerRelease}
        onPointerCancel={handlePointerRelease}
      >
        <span className="pointer-events-none absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/45" />
        <span
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-400/80 bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: thumbLeft }}
        />
      </button>
    </div>
  )
}
