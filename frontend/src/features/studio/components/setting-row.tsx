import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** A table of settings, as Dub Studio's sections have them: hairline rows on a quiet surface. */
export function SettingsTable({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)] bg-[var(--color-surface-2)]/40">
      {children}
    </div>
  )
}

/**
 * One row of a settings table (Dub Studio's SettingSwitch, with any control on the right): an icon, the name, what
 * it does, and the control; `below` holds what belongs to the row under it, such as a result line.
 */
export function SettingRow({
  icon: Icon,
  label,
  hint,
  children,
  below,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  children?: ReactNode
  below?: ReactNode
}) {
  const labelId = useId()
  return (
    <div className="px-3 py-2.5" role="group" aria-labelledby={labelId}>
      <div className="flex items-center gap-3">
        <Icon size={15} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-[13px] font-medium text-[var(--color-text)]">
            {label}
          </div>
          {hint && <div className="text-[11px] leading-snug text-[var(--color-muted)]">{hint}</div>}
        </div>
        {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
      {below && <div className="mt-2 pl-[27px]">{below}</div>}
    </div>
  )
}
