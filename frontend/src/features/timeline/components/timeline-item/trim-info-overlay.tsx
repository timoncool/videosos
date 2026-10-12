import { useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Floating timecode readout shown above a clip edge during a trim gesture.
 *
 * Rendered into a body portal so it escapes the clip's `contain: paint` box and
 * is positioned against the live `getBoundingClientRect()` of `anchorRef`.
 * `measureKey` forces a reposition whenever the anchored geometry changes.
 */
export function TrimInfoOverlay({
  anchorRef,
  side,
  delta,
  duration,
  measureKey,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  side: 'start' | 'end'
  delta: string
  duration: string
  measureKey: string
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const x = side === 'start' ? rect.left : rect.right
    setPosition({
      x,
      y: Math.max(4, rect.top - 6),
    })
  }, [anchorRef, side])

  useLayoutEffect(() => {
    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [measureKey, updatePosition])

  if (!position) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10000] min-w-[58px] rounded-sm bg-neutral-950/90 px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold leading-tight text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-white/15 tabular-nums"
      style={{
        left: position.x,
        top: position.y,
        transform:
          side === 'start' ? 'translate(-2px, -100%)' : 'translate(calc(-100% + 2px), -100%)',
      }}
    >
      <div>{delta}</div>
      <div className="text-white/80">{duration}</div>
    </div>,
    document.body,
  )
}
