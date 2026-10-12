import { useCallback, useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const INSTALL_DISMISSED_UNTIL_KEY = 'freecut-pwa-install-dismissed-until'
const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandaloneDisplayMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isDismissed() {
  const dismissedUntil = Number(window.localStorage.getItem(INSTALL_DISMISSED_UNTIL_KEY) ?? 0)
  return Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()
}

export function PwaInstallPrompt() {
  const { t } = useTranslation()
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandaloneDisplayMode()) {
      return
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()

      if (isDismissed()) {
        return
      }

      setInstallPrompt(event as BeforeInstallPromptEvent)
      setVisible(true)
    }

    const handleAppInstalled = () => {
      window.localStorage.removeItem(INSTALL_DISMISSED_UNTIL_KEY)
      setVisible(false)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    window.localStorage.setItem(
      INSTALL_DISMISSED_UNTIL_KEY,
      String(Date.now() + INSTALL_DISMISS_MS),
    )
    setVisible(false)
  }, [])

  const install = useCallback(async () => {
    if (!installPrompt) {
      return
    }

    setVisible(false)
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice

    if (choice.outcome === 'dismissed') {
      dismiss()
    } else {
      window.localStorage.removeItem(INSTALL_DISMISSED_UNTIL_KEY)
    }

    setInstallPrompt(null)
  }, [dismiss, installPrompt])

  if (!visible || !installPrompt) {
    return null
  }

  return (
    <aside
      aria-label={t('appShell.installPrompt.label')}
      className="fixed bottom-4 left-4 z-50 w-[min(calc(100vw-2rem),360px)] rounded-lg border border-border bg-background/95 p-3 text-foreground shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-5">{t('appShell.installPrompt.title')}</div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {t('appShell.installPrompt.description')}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="h-8" onClick={install}>
              <Download className="h-3.5 w-3.5" />
              {t('appShell.installPrompt.install')}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={dismiss}>
              {t('appShell.installPrompt.notNow')}
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('appShell.installPrompt.dismiss')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}
