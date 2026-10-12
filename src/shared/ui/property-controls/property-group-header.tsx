import { cn } from '@/shared/ui/cn'

interface PropertyGroupHeaderProps {
  children: React.ReactNode
  className?: string
}

/**
 * Full-width group header (uppercase, muted) shown above a group of controls —
 * e.g. Content / Title / Subtitle in the text panel, mirroring the In/Out/Loop
 * headers in the motion section. Use instead of a {@link PropertyRow} label when
 * the group wraps a mini-layout, so the controls get the full panel width rather
 * than sharing it with a left-gutter label.
 */
export function PropertyGroupHeader({ children, className }: PropertyGroupHeaderProps) {
  return (
    <div
      className={cn(
        // Pure text style — callers add their own vertical spacing.
        'text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}
