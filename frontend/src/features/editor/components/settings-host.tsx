import { lazy, Suspense, useEffect, useState } from 'react'
import { OPEN_SETTINGS_EVENT, parseSettingsTarget } from '../deps/studio'

const SettingsDialog = lazy(() => import('./settings-dialog').then((module) => ({ default: module.SettingsDialog })))

type Target = NonNullable<ReturnType<typeof parseSettingsTarget>>

/** The one settings window of the program, opened on a section from anywhere (`openSettings`). */
export function SettingsHost() {
  const [target, setTarget] = useState<Target | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (event: Event) => {
      const wanted = (event as CustomEvent<string>).detail
      const parsed = parseSettingsTarget(wanted)
      if (!parsed) {
        console.error(`[ERROR] the settings have no section "${wanted}"`)
        return
      }
      setTarget(parsed)
      setOpen(true)
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, show)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, show)
  }, [])
  if (!target) return null
  return (
    <Suspense fallback={null}>
      <SettingsDialog open={open} onOpenChange={setOpen} target={target} />
    </Suspense>
  )
}
