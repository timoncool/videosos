import { cn } from '@/shared/ui/cn'

interface ShuttleIndicatorProps {
  active: boolean
  playbackRate: number
  className?: string
}

export function ShuttleIndicator({ active, playbackRate, className }: ShuttleIndicatorProps) {
  if (!active || playbackRate === 0) {
    return null
  }

  const reverse = playbackRate < 0
  const speed = Math.abs(playbackRate)
  const key = reverse ? 'J' : 'L'
  const direction = reverse ? '◀' : '▶'
  const label = `${reverse ? 'Reverse' : 'Forward'} shuttle ${speed}x`

  return (
    <output
      className={cn(
        'inline-flex h-5 min-w-[4.25rem] shrink-0 items-center justify-center gap-1 rounded border px-1.5',
        'font-mono text-[10px] font-semibold tabular-nums select-none',
        speed > 1
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'border-border bg-muted/50 text-muted-foreground',
        className,
      )}
      aria-label={label}
      title={label}
    >
      <span className="text-[9px] opacity-70">{key}</span>
      <span aria-hidden="true">{direction}</span>
      <span>{speed}×</span>
    </output>
  )
}
