import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSonner } from 'sonner'
import { HubBars } from './hub-bars'
import { HubPopup } from './hub-popup'
import FilesPanel from './files-panel'
import ResourceMonitor from './resource-monitor'
import { TopBar, type TopBarPlace } from './top-bar'
import ServerOffline from './server-offline'
import { hubChanged, showsNow, useHubState, type HubButton } from '../services/studio-hub'
import { openNews, openSettings } from '../services/settings-nav'
import { api } from '../services/studio-api'
import { noteMessage } from '../services/journal'

const HEALTH_MS = 5000

/**
 * What every studio of the family shows over its window: the hub's strips at the top, and the "service is not
 * answering" screen when the program's service stops answering (a network failure, never a slow answer).
 */
export function StudioHost({ children, go }: { children: ReactNode; go: (place: TopBarPlace) => void }) {
  const { i18n } = useTranslation()
  const hub = useHubState(i18n.language.split('-')[0] ?? 'en')
  const [offline, setOffline] = useState(false)
  // a message shown for a moment stays readable in the journal
  const { toasts } = useSonner()
  const noted = useRef(new Set<string | number>())
  useEffect(() => {
    for (const toast of toasts) {
      if (noted.current.has(toast.id) || toast.type === 'loading' || typeof toast.title !== 'string') continue
      noted.current.add(toast.id)
      noteMessage(typeof toast.description === 'string' ? `${toast.title} ${toast.description}` : toast.title, toast.type ?? '')
    }
  }, [toasts])
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const started = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [view, setView] = useState(() => screenOf(window.location.pathname))

  // Notices wait for the first-run screen to be answered, and their delays count from then, as in the studios.
  const ready = Boolean(hub && (hub.telemetry.acknowledged || hub.telemetry.disabledByEnv))
  useEffect(() => {
    if (!ready) return
    started.current = Date.now()
    setElapsed(0)
  }, [ready])
  // Popups stay in the hub's test channel (STUDIO_HUB_TEST=1) until they are released.
  const popups = ready && hub?.test ? hub.items.filter((item) => item.kind === 'popup') : []
  const nextDelay = popups.reduce<number | null>((next, item) => (item.rules.delay_s > elapsed && (next === null || item.rules.delay_s < next) ? item.rules.delay_s : next), null)
  useEffect(() => {
    if (nextDelay === null) return
    const timer = window.setTimeout(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), Math.max(0, started.current + nextDelay * 1000 - Date.now()) + 50)
    return () => window.clearTimeout(timer)
  }, [nextDelay])
  useEffect(() => {
    const follow = () => setView(screenOf(window.location.pathname))
    const timer = window.setInterval(follow, 1000)
    window.addEventListener('popstate', follow)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('popstate', follow)
    }
  }, [])
  const popup = popups.find((item) => !closed.has(item.id) && showsNow(item, elapsed, view))
  const close = (id: string) => {
    setClosed((previous) => new Set(previous).add(id))
    hubChanged()
  }
  const openTarget = (target: NonNullable<HubButton['target']>) => {
    if (target === 'news') openNews()
    else openSettings(target === 'update' ? 'about' : 'providers')
  }

  useEffect(() => {
    let alive = true
    const check = () =>
      void api.serverReachable().then((reachable) => {
        if (alive) setOffline(!reachable)
      })
    const timer = window.setInterval(check, HEALTH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      {hub && ready && <HubBars items={hub.items} />}
      <TopBar go={go} />
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
      <ResourceMonitor />
      <FilesPanel />
      {popup && <HubPopup item={popup} onClose={() => close(popup.id)} onOpen={openTarget} />}
      {offline && (
        <div className="fixed inset-0 z-[80] flex bg-[var(--color-bg)]">
          <ServerOffline />
        </div>
      )}
    </div>
  )
}

/** The screen a notice may be meant for, by the window's address. */
function screenOf(path: string): string {
  return path.startsWith('/editor') ? 'editor' : 'projects'
}
