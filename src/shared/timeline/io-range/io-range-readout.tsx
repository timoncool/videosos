import { memo } from 'react'
import { createPortal } from 'react-dom'
import { useIoRangeReadoutStore } from './io-range-readout-store'

/**
 * Floating readout shown at the cursor during an IO drag (mirrors the clip trim
 * readout / TransitionDragTooltip). Mount once, high in the tree — it portals to
 * `document.body` and positions in viewport coords, so a single instance covers
 * every IO surface (Edit ruler, mini-timeline, source monitor).
 */
export const IoDragReadout = memo(function IoDragReadout() {
  const readout = useIoRangeReadoutStore((s) => s.readout)
  if (!readout) return null

  // Matches the clip trim readout (TrimInfoOverlay) for a consistent look;
  // positioned centered above the cursor rather than anchored to a clip edge.
  return createPortal(
    <div
      className="pointer-events-none fixed z-[10000] min-w-[58px] rounded-sm bg-neutral-950/90 px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold leading-tight text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-white/15 tabular-nums"
      style={{
        left: readout.x,
        top: readout.y - 16,
        transform: 'translate(-50%, -100%)',
      }}
    >
      {readout.label}
    </div>,
    document.body,
  )
})
