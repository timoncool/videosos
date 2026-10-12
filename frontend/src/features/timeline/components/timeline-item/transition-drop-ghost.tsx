import { memo } from 'react'

interface TransitionDropGhostProps {
  ghost: {
    left: number
    width: number
    cutOffset: number
  } | null
}

export const TransitionDropGhost = memo(function TransitionDropGhost({
  ghost,
}: TransitionDropGhostProps) {
  if (!ghost) return null
  return (
    <div
      className="absolute inset-y-0 pointer-events-none overflow-hidden rounded-sm border border-slate-100/80 shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
      style={{
        left: `${ghost.left}px`,
        width: `${ghost.width}px`,
        zIndex: 35,
        background: 'rgba(248,250,252,0.08)',
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(248,250,252,0.08),rgba(255,255,255,0.02)_48%,rgba(255,255,255,0.02)_52%,rgba(248,250,252,0.08))]" />
      <div
        className="absolute top-0 bottom-0 w-px bg-slate-50/90"
        style={{ left: `${ghost.cutOffset}px` }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-white/60" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-slate-900/20" />
    </div>
  )
})
