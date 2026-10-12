/**
 * LegacyMigrationErrors
 *
 * Surfaces per-store errors left over from a partial legacy-IDB migration.
 *
 * Context: `migrateFromLegacyIDB()` only sets the "migration complete"
 * marker when every record copied without error. Any per-store failures
 * are persisted to `.freecut-migration-errors.json` in the workspace so
 * the next launch can offer a targeted retry. Without this banner, a
 * user whose migration partially-failed would see the main migration
 * banner again and have to re-run everything blindly.
 *
 * Behavior:
 *  - On mount, read `getMigrationErrors()`. Empty → render nothing.
 *  - Non-empty → show a compact banner with the failure count, grouped
 *    by store, and a Retry button that re-runs the migration. Records
 *    that succeeded first time throw "already exists" and get pushed
 *    into the error list (caught per-store, harmless); records that
 *    previously failed get another shot.
 *  - On retry success (zero new errors), the migrate pipeline sets
 *    the migration marker and clears the error file; this component
 *    unmounts itself on next render.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/shared/logging/logger'
import {
  getMigrationErrors,
  migrateFromLegacyIDB,
  type MigrationReport,
} from '@/infrastructure/storage/legacy-idb'

const logger = createLogger('LegacyMigrationErrors')

type StoreError = MigrationReport['errors'][number]

interface Props {
  onRetried?: () => Promise<void> | void
}

type State =
  | { kind: 'checking' }
  | { kind: 'idle' }
  | { kind: 'show'; errors: StoreError[] }
  | { kind: 'running' }
  | { kind: 'dismissed' }

function groupByStore(errors: StoreError[]): Array<{ store: string; count: number }> {
  const counts = new Map<string, number>()
  for (const e of errors) {
    counts.set(e.store, (counts.get(e.store) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([store, count]) => ({ store, count }))
    .sort((a, b) => b.count - a.count)
}

export function LegacyMigrationErrors({ onRetried }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const errors = await getMigrationErrors()
        if (cancelled) return
        setState(errors.length > 0 ? { kind: 'show', errors } : { kind: 'idle' })
      } catch (error) {
        logger.warn('getMigrationErrors failed', error)
        if (!cancelled) setState({ kind: 'idle' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleRetry = useCallback(async () => {
    setState({ kind: 'running' })
    try {
      const report = await migrateFromLegacyIDB()
      if (report.errors.length === 0) {
        toast.success(t('projects.legacyMigrationErrors.retrySucceeded'))
        setState({ kind: 'idle' })
      } else {
        toast.warning(
          t('projects.legacyMigrationErrors.retryStillFailing', { count: report.errors.length }),
        )
        setState({ kind: 'show', errors: report.errors })
      }
      await onRetried?.()
    } catch (error) {
      logger.error('retry migration failed', error)
      toast.error(t('projects.legacyMigrationErrors.retryFailed'), {
        description: error instanceof Error ? error.message : t('projects.unknownError'),
      })
      // Fall back to whatever the persisted state looks like now.
      const errors = await getMigrationErrors()
      setState(errors.length > 0 ? { kind: 'show', errors } : { kind: 'idle' })
    }
  }, [onRetried, t])

  const grouped = useMemo(() => (state.kind === 'show' ? groupByStore(state.errors) : []), [state])

  if (state.kind === 'checking' || state.kind === 'idle' || state.kind === 'dismissed') {
    return null
  }

  if (state.kind === 'running') {
    return (
      <div className="panel-bg border border-border rounded-lg p-4 flex items-center gap-3 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>{t('projects.legacyMigrationErrors.retrying')}</span>
      </div>
    )
  }

  const total = state.errors.length

  return (
    <div className="panel-bg border border-yellow-500/40 rounded-lg p-4 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {t('projects.legacyMigrationErrors.failedCount', { count: total })}
          </div>
          <div className="text-muted-foreground text-xs mt-1">
            {grouped.map(({ store, count }) => `${count} ${store}`).join(', ')}.{' '}
            {t('projects.legacyMigrationErrors.retryHint')}
          </div>

          {expanded && (
            <ul className="mt-3 space-y-1 text-xs font-mono text-muted-foreground max-h-48 overflow-y-auto">
              {state.errors.map((e, i) => (
                <li key={`${e.store}-${e.id}-${i}`} className="truncate">
                  <span className="text-foreground">{e.store}</span>
                  <span className="mx-1">·</span>
                  <span>{e.id}</span>
                  <span className="mx-1">·</span>
                  <span>{e.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button size="sm" onClick={() => void handleRetry()} className="gap-2">
          <RefreshCw className="h-3 w-3" /> {t('projects.retry')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('projects.hideDetails') : t('projects.showDetails')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setState({ kind: 'dismissed' })}>
          {t('projects.dismiss')}
        </Button>
      </div>
    </div>
  )
}
