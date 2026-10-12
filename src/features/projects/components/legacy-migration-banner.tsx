import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Database, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createLogger } from '@/shared/logging/logger'
import {
  deleteLegacyIDB,
  getMigrationStatus,
  hasLegacyData,
  migrateFromLegacyIDB,
  type MigrationProgress,
  type MigrationReport,
} from '@/infrastructure/storage/legacy-idb'

const logger = createLogger('LegacyMigrationBanner')

interface Props {
  onMigrated?: () => Promise<void> | void
}

type State =
  | { kind: 'checking' }
  | { kind: 'idle' }
  | { kind: 'prompt' }
  | { kind: 'running'; progress: MigrationProgress | null }
  | { kind: 'done'; report: MigrationReport }
  | { kind: 'dismissed' }

/**
 * Clamp to [0, 100] for the progress bar. A `total` of 0 (no work) maps to
 * full progress so the bar doesn't appear stuck at 0 while the finalizing
 * step runs against an empty legacy DB.
 */
function computePercent(progress: MigrationProgress | null): number {
  if (!progress) return 0
  if (progress.total === 0) return 100
  const pct = (progress.processed / progress.total) * 100
  return Math.max(0, Math.min(100, pct))
}

export function LegacyMigrationBanner({ onMigrated }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The progress callback fires rapidly (once per write). We keep a ref
  // so React batches updates via a single setState per tick without
  // stale-closure hazards.
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await getMigrationStatus()
        if (status.migrated) {
          if (!cancelled) setState({ kind: 'idle' })
          return
        }
        const has = await hasLegacyData()
        if (cancelled) return
        setState({ kind: has ? 'prompt' : 'idle' })
      } catch (error) {
        logger.warn('detect legacy data failed', error)
        if (!cancelled) setState({ kind: 'idle' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleMigrate = useCallback(async () => {
    setState({ kind: 'running', progress: null })
    try {
      const report = await migrateFromLegacyIDB({
        onProgress: (progress) => {
          // Only update while the banner is in the running state. If the
          // user has navigated away (component unmounts) the state setter
          // is a no-op; the ref guard avoids a needless state flip if a
          // late progress event arrives after the run resolved.
          if (stateRef.current.kind !== 'running') return
          setState({ kind: 'running', progress })
        },
      })
      setState({ kind: 'done', report })
      toast.success(
        t('projects.legacyMigration.migratedToast', {
          projects: report.projects,
          media: report.media,
        }),
      )
      await onMigrated?.()
    } catch (error) {
      logger.error('Migration failed', error)
      toast.error(t('projects.legacyMigration.migrationFailed'), {
        description: error instanceof Error ? error.message : t('projects.unknownError'),
      })
      setState({ kind: 'prompt' })
    }
  }, [onMigrated, t])

  const handleDeleteLegacy = useCallback(async () => {
    try {
      await deleteLegacyIDB()
      toast.success(t('projects.legacyMigration.storageCleared'))
      setState({ kind: 'dismissed' })
    } catch (error) {
      logger.error('Failed to delete legacy IDB', error)
      toast.error(t('projects.legacyMigration.storageClearFailed'), {
        description: error instanceof Error ? error.message : t('projects.unknownError'),
      })
    } finally {
      setConfirmDelete(false)
    }
  }, [t])

  if (state.kind === 'checking' || state.kind === 'idle' || state.kind === 'dismissed') {
    return null
  }

  if (state.kind === 'running') {
    const { progress } = state
    const percent = computePercent(progress)
    // Show label from progress if available; fall back to a generic line
    // during the brief gap before the first tick arrives.
    const label = progress?.phaseLabel ?? t('projects.legacyMigration.preparing')
    const countsLine = progress
      ? t('projects.legacyMigration.counts', {
          processed: progress.processed,
          total: progress.total,
        })
      : null

    return (
      <div
        className="panel-bg border border-border rounded-lg p-4 space-y-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <Database className="h-4 w-4 animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{label}</div>
            <div className="text-muted-foreground text-xs mt-0.5">
              {t('projects.legacyMigration.runningHint')}
            </div>
          </div>
          <div className="text-xs font-mono tabular-nums text-muted-foreground shrink-0">
            {Math.round(percent)}%
          </div>
        </div>
        <Progress
          value={percent}
          className="h-2"
          aria-label={label}
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
        {countsLine && (
          <div className="text-xs text-muted-foreground font-mono tabular-nums">{countsLine}</div>
        )}
      </div>
    )
  }

  if (state.kind === 'done') {
    const { report } = state
    return (
      <>
        <div className="panel-bg border border-border rounded-lg p-4 text-sm space-y-2">
          <div className="flex items-start gap-3">
            <Database className="h-4 w-4 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium">{t('projects.legacyMigration.completeTitle')}</div>
              <div className="text-muted-foreground text-xs mt-1">
                {t('projects.legacyMigration.completeSummary', {
                  projects: report.projects,
                  media: report.media,
                  thumbnails: report.thumbnails,
                  transcripts: report.transcripts,
                })}
                {report.errors.length > 0 &&
                  ` · ${t('projects.legacyMigration.errorsLogged', { count: report.errors.length })}`}
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3 w-3" /> {t('projects.legacyMigration.deleteStorage')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setState({ kind: 'dismissed' })}>
              {t('projects.dismiss')}
            </Button>
          </div>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('projects.legacyMigration.deleteStorageConfirmTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                <Trans
                  i18nKey="projects.legacyMigration.deleteStorageConfirmDescription"
                  components={{ code: <span className="font-mono" /> }}
                />
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleDeleteLegacy()}>
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  // prompt
  return (
    <div className="panel-bg border border-border rounded-lg p-4 text-sm">
      <div className="flex items-start gap-3">
        <Database className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <div className="flex-1">
          <div className="font-medium">{t('projects.legacyMigration.promptTitle')}</div>
          <div className="text-muted-foreground text-xs mt-1">
            {t('projects.legacyMigration.promptDescription')}
          </div>
        </div>
        <Button size="sm" onClick={() => void handleMigrate()}>
          {t('projects.legacyMigration.migrate')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setState({ kind: 'dismissed' })}>
          {t('projects.later')}
        </Button>
      </div>
    </div>
  )
}
