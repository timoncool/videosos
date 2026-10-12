/**
 * Router-level error screen.
 *
 * Route loaders fail before a component mounts, so the router owns their
 * recovery UI. Expected failures such as a stale project link get a specific
 * path forward, while technical details stay available through a copy action
 * instead of taking over the screen.
 */

import { useEffect, useRef, useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  FileQuestion,
  FolderOpen,
  RefreshCw,
} from 'lucide-react'

import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/shared/logging/logger'
import {
  ensureKnownWorkspaceForCurrent,
  getWorkspaceHandleRecord,
  removeKnownWorkspace,
} from '@/infrastructure/storage/handles-db'
import {
  formatRouteErrorDetails,
  getProjectNotFoundError,
  getStorageFailureName,
} from './route-error-cause'

const logger = createLogger('RouteError')

/** Known DOMException names get a plain-language explanation; others don't. */
const CAUSE_EXPLANATION_KEYS: Record<string, string> = {
  NotAllowedError: 'app.routeError.causePermission',
  NotFoundError: 'app.routeError.causeMissing',
  NotSupportedError: 'app.routeError.causeUnsupported',
  SecurityError: 'app.routeError.causePermission',
}

export function RouteErrorScreen({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const [isSwitchingFolder, setIsSwitchingFolder] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const projectNotFound = getProjectNotFoundError(error)
  const failureName = getStorageFailureName(error)
  const explanationKey = failureName ? CAUSE_EXPLANATION_KEYS[failureName] : undefined
  const title = projectNotFound
    ? t('app.routeError.projectNotFoundTitle')
    : t('app.routeError.title')
  const description = projectNotFound
    ? t('app.routeError.projectNotFoundDescription')
    : explanationKey
      ? t(explanationKey)
      : t('app.routeError.description')

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    },
    [],
  )

  const handleRetry = () => {
    reset()
    void router.invalidate()
  }

  const handleCopyDetails = async () => {
    try {
      await navigator.clipboard.writeText(formatRouteErrorDetails(error, window.location.href))
      setCopyStatus('copied')
    } catch (cause) {
      logger.error('Failed to copy route error details', cause)
      setCopyStatus('failed')
    }

    if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    copyResetTimer.current = setTimeout(() => setCopyStatus('idle'), 2000)
  }

  /**
   * Forget the active workspace so `WorkspaceGate` reverts to its pick-folder
   * state on the next render. This only deletes the handle registry record,
   * never the user's files.
   */
  const handleChooseDifferentFolder = async () => {
    setIsSwitchingFolder(true)
    try {
      await ensureKnownWorkspaceForCurrent()
      const record = await getWorkspaceHandleRecord()
      if (record?.activeWorkspaceId) {
        await removeKnownWorkspace(record.activeWorkspaceId)
      }
      window.location.reload()
    } catch (cause) {
      logger.error('Failed to release the active workspace', cause)
      setIsSwitchingFolder(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <div className="w-full max-w-md">
        <FreeCutLogo variant="full" size="md" className="mb-6 justify-center" />

        <main className="rounded-2xl border border-border/80 bg-card/70 px-6 py-8 text-center shadow-2xl shadow-black/20 backdrop-blur-sm sm:px-8">
          <div
            className={
              projectNotFound
                ? 'mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary'
                : 'mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive'
            }
          >
            {projectNotFound ? (
              <FileQuestion className="h-8 w-8" />
            ) : (
              <AlertTriangle className="h-8 w-8" />
            )}
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {description}
          </p>

          <div className="mt-7 flex flex-col-reverse justify-center gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleRetry}>
              <RefreshCw />
              {t('app.errorBoundary.tryAgain')}
            </Button>

            {projectNotFound ? (
              <Button asChild>
                <Link to="/projects">
                  <ArrowLeft />
                  {t('app.routeError.backToProjects')}
                </Link>
              </Button>
            ) : (
              <Button onClick={() => window.location.reload()}>
                {t('app.errorBoundary.reloadPage')}
              </Button>
            )}
          </div>

          {failureName && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              disabled={isSwitchingFolder}
              onClick={handleChooseDifferentFolder}
            >
              <FolderOpen />
              {t('projects.workspaceGate.chooseDifferentFolder')}
            </Button>
          )}

          <div className="mt-6 border-t border-border/70 pt-5">
            <p className="text-xs leading-5 text-muted-foreground">
              {t('app.routeError.supportHint')}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1"
              aria-live="polite"
              onClick={() => void handleCopyDetails()}
            >
              {copyStatus === 'copied' ? <Check /> : <Copy />}
              {copyStatus === 'copied'
                ? t('app.routeError.detailsCopied')
                : copyStatus === 'failed'
                  ? t('app.routeError.copyFailed')
                  : t('app.routeError.copyDetails')}
            </Button>
          </div>
        </main>
      </div>
    </div>
  )
}
