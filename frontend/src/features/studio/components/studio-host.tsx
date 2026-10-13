import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HubBars } from './hub-bars'
import ServerOffline from './server-offline'
import { useHubState } from '../services/studio-hub'
import { api } from '../services/studio-api'

const HEALTH_MS = 5000

/**
 * What every studio of the family shows over its window: the hub's strips at the top, and the "service is not
 * answering" screen when the program's service stops answering (a network failure, never a slow answer).
 */
export function StudioHost() {
  const { i18n } = useTranslation()
  const hub = useHubState(i18n.language.split('-')[0] ?? 'en')
  const [offline, setOffline] = useState(false)

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
    <>
      {hub && (
        <div className="pointer-events-auto fixed inset-x-0 top-0 z-[70]">
          <HubBars items={hub.items} />
        </div>
      )}
      {offline && (
        <div className="fixed inset-0 z-[80] flex bg-[var(--color-bg)]">
          <ServerOffline />
        </div>
      )}
    </>
  )
}
