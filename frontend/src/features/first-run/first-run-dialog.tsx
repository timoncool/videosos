import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { isDesktop } from '@/infrastructure/desktop'
import { hubChanged } from './deps/studio'

interface HubState {
  telemetry: { enabled: boolean; acknowledged: boolean; disabledByEnv: boolean }
}

/**
 * Shown once, on the first start of the program: what VideoSOS is, where the provider keys go, and the
 * anonymous statistics choice. Statistics are sent only after this screen has shown its switch.
 */
export function FirstRunDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [statistics, setStatistics] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void isDesktop().then(async (desktop) => {
      if (!desktop) return
      try {
        const response = await fetch('/v1/hub/state', { cache: 'no-store' })
        if (!response.ok) return
        const state = (await response.json()) as HubState
        if (!state.telemetry.acknowledged && !state.telemetry.disabledByEnv) {
          setStatistics(state.telemetry.enabled)
          setOpen(true)
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })
  }, [])

  const start = async () => {
    try {
      const response = await fetch('/v1/hub/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: statistics, acknowledge: true }),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      hubChanged()
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && void start()}>
      <DialogContent className="max-w-lg" data-testid="first-run">
        <DialogHeader>
          <FreeCutLogo size="md" className="mb-2" />
          <DialogTitle>{t('firstRun.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t('firstRun.what')}</p>
          <p>{t('firstRun.keys')}</p>
          <p>{t('firstRun.agent')}</p>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch checked={statistics} onCheckedChange={setStatistics} aria-label={t('firstRun.statistics')} className="mt-0.5" />
            <span>
              <span className="block text-foreground">{t('firstRun.statistics')}</span>
              <span className="text-xs">{t('firstRun.statisticsHint')}</span>
            </span>
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <Button className="w-full" onClick={() => void start()}>
          {t('firstRun.start')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
