import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/shared/logging/logger'
import {
  formatEstimatedBytes,
  getLocalInferenceSummary,
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@/shared/state/local-inference'
import { cn } from '@/shared/ui/cn'

const log = createLogger('LocalInferenceUnloadControl')

type UnloadState = 'idle' | 'unloading' | 'done'

interface LocalInferenceUnloadControlProps {
  className?: string
  labelClassName?: string
  descriptionClassName?: string
  buttonClassName?: string
}

export function LocalInferenceUnloadControl({
  className,
  labelClassName,
  descriptionClassName,
  buttonClassName,
}: LocalInferenceUnloadControlProps) {
  const { t } = useTranslation()
  const runtimesById = useLocalInferenceStore((state) => state.runtimesById)
  const summary = useMemo(() => getLocalInferenceSummary(runtimesById), [runtimesById])
  const [unloadState, setUnloadState] = useState<UnloadState>('idle')
  const resetTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    },
    [],
  )

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
    }

    resetTimerRef.current = window.setTimeout(() => {
      setUnloadState('idle')
      resetTimerRef.current = null
    }, 2000)
  }, [])

  const description = useMemo(() => {
    if (!summary) {
      return t('projects.settings.localInference.noRuntimes')
    }

    const estimateLabel = formatEstimatedBytes(summary.totalEstimatedBytes)
    const detailParts = [
      summary.primaryLabel,
      summary.backendLabel,
      summary.activeJobs > 0
        ? t('projects.settings.localInference.activeJobs', { count: summary.activeJobs })
        : null,
      estimateLabel,
    ].filter(Boolean)

    return detailParts.join(' | ')
  }, [summary, t])

  const handleUnload = useCallback(async () => {
    if (!summary || summary.unloadableCount === 0 || unloadState === 'unloading') {
      return
    }

    setUnloadState('unloading')

    try {
      const unloadedCount = await localInferenceRuntimeRegistry.unloadAll()
      setUnloadState('done')
      toast.success(t('projects.settings.localInference.unloadedToast', { count: unloadedCount }))
      scheduleReset()
    } catch (error) {
      log.error('Failed to unload local inference runtimes', error)
      setUnloadState('idle')
      toast.error(t('projects.settings.localInference.unloadFailed'))
    }
  }, [scheduleReset, summary, unloadState, t])

  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <Label className={cn('text-sm', labelClassName)}>
          {t('projects.settings.localInference.unloadLabel')}
        </Label>
        <p className={cn('mt-0.5 text-xs text-muted-foreground', descriptionClassName)}>
          {description}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className={cn('h-8 w-28 shrink-0 gap-1.5', buttonClassName)}
        onClick={() => {
          void handleUnload()
        }}
        disabled={!summary || summary.unloadableCount === 0 || unloadState === 'unloading'}
      >
        {unloadState === 'unloading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {unloadState === 'done' && <Check className="h-3.5 w-3.5" />}
        {unloadState === 'idle' && <Trash2 className="h-3.5 w-3.5" />}
        {unloadState === 'unloading'
          ? t('projects.settings.localInference.unloading')
          : unloadState === 'done'
            ? t('projects.settings.localInference.unloaded')
            : t('projects.settings.localInference.unload')}
      </Button>
    </div>
  )
}
