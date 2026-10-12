import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import {
  reverseConformService,
  type ReverseConformResult,
} from '../services/reverse-conform-service'
import { useReverseConformDialogStore } from '../stores/reverse-conform-dialog-store'
import { commitPreparedReverseItems } from '../stores/actions/item-actions'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'

const log = createLogger('ReverseConformDialog')

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function ReverseConformDialog() {
  const { t } = useTranslation()
  const request = useReverseConformDialogStore((state) => state.request)
  const close = useReverseConformDialogStore((state) => state.close)
  const useProxy = usePlaybackStore((state) => state.useProxy)
  const abortRef = useRef<AbortController | null>(null)
  const userCancelledRef = useRef(false)
  const [progress, setProgress] = useState(0)
  const [clipIndex, setClipIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  const clipCount = request?.videoItems.length ?? 0
  const title = error
    ? t('timeline.reverseConform.titleFailed')
    : isCancelling
      ? t('timeline.reverseConform.titleCancelling')
      : t('timeline.reverseConform.titlePreparing')
  const description = useMemo(() => {
    if (!request) return ''
    if (error) return error
    if (isCancelling) return t('timeline.reverseConform.cancellingDescription')
    const currentClip = Math.min(clipIndex + 1, clipCount)
    return t('timeline.reverseConform.progressDescription', {
      current: currentClip,
      total: clipCount,
    })
  }, [clipCount, clipIndex, error, isCancelling, request, t])

  useEffect(() => {
    if (!request) return

    const controller = new AbortController()
    abortRef.current = controller
    userCancelledRef.current = false
    setProgress(0)
    setClipIndex(0)
    setError(null)
    setIsCancelling(false)

    void (async () => {
      const results: ReverseConformResult[] = []
      try {
        for (let index = 0; index < request.videoItems.length; index += 1) {
          const item = request.videoItems[index]!
          setClipIndex(index)
          const result = await reverseConformService.prepareVideo(item, request.timelineFps, {
            quality: 'preview',
            useProxy,
            signal: controller.signal,
            onProgress: (clipProgress) => {
              const aggregate = ((index + clipProgress) / request.videoItems.length) * 100
              setProgress(Math.max(0, Math.min(99, aggregate)))
            },
          })
          results.push(result)
          setProgress(((index + 1) / request.videoItems.length) * 100)
        }

        if (controller.signal.aborted) return
        commitPreparedReverseItems(request.items, results)
        close(request.id)
      } catch (caught) {
        if (isAbortError(caught) || controller.signal.aborted) {
          // Only dismiss the request when the user explicitly cancelled.
          // Effect cleanup also aborts (e.g. StrictMode's mount→cleanup→mount
          // cycle); closing here would tear down the request the replacement
          // effect run is still working with.
          if (userCancelledRef.current) {
            close(request.id)
          }
          return
        }
        log.warn('Reverse conform dialog failed', { error: caught })
        setError(
          caught instanceof Error ? caught.message : t('timeline.reverseConform.couldNotPrepare'),
        )
      }
    })()

    return () => {
      controller.abort()
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }, [close, request, useProxy, t])

  const handleCancel = () => {
    setIsCancelling(true)
    userCancelledRef.current = true
    abortRef.current?.abort()
  }

  const handleCloseError = () => {
    close(request?.id)
  }

  return (
    <Dialog open={request !== null}>
      <DialogContent
        hideCloseButton
        className="max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {!error && (
          <div className="space-y-2">
            <Progress value={progress} />
            <div className="text-xs tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </div>
          </div>
        )}
        <DialogFooter>
          {error ? (
            <Button type="button" onClick={handleCloseError}>
              {t('common.close')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {t('common.cancel')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
