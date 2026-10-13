import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wifi } from 'lucide-react'

interface NetworkStatus {
  enabled: boolean
  key: string | null
  listening: boolean
  addresses: string[]
  port: number | null
}

/**
 * VideoSOS from another computer's browser (as in the music studios): off by default, on with a key. The address
 * is bound when the program starts, so a change asks for a restart.
 */
export function NetworkAccess() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/network')
      .then((response) => (response.ok ? (response.json() as Promise<NetworkStatus>) : Promise.reject(new Error(String(response.status)))))
      .then(setStatus)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  const change = async (body: { enabled?: boolean; new_key?: boolean }) => {
    setError(null)
    try {
      const response = await fetch('/api/network', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const answer = (await response.json().catch(() => null)) as (NetworkStatus & { error?: string }) | null
      if (!response.ok) throw new Error(answer?.error || `HTTP ${response.status}`)
      setStatus(answer)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  if (!status) return error ? <p role="alert" className="text-[12px] text-[var(--color-warn)]">{error}</p> : null
  const links = status.key && status.port ? status.addresses.map((address) => `http://${address}:${status.port}/?key=${status.key}`) : []
  const restart = status.enabled !== status.listening
  const button = 'shrink-0 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:border-[var(--color-accent)]'
  return (
    <section className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
      <label className="flex items-center gap-2 text-[13px] font-semibold">
        <input
          type="checkbox"
          checked={status.enabled}
          onChange={(event) => void change({ enabled: event.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <Wifi size={15} className="text-[var(--color-accent-2)]" />
        {t('network.access')}
      </label>
      <p className="text-[12px] leading-5 text-[var(--color-muted)]">{t('network.accessHint')}</p>
      {restart && <p className="text-[12px] text-[var(--color-warn)]">{t('network.accessRestart')}</p>}
      {status.enabled && status.key && (
        <div className="space-y-1.5 rounded-md border border-[var(--color-border)] p-2 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[var(--color-muted)]">{t('network.accessKey')}</span>
            <code className="mono min-w-0 flex-1 truncate">{status.key}</code>
            <button type="button" onClick={() => void change({ new_key: true })} className={button}>
              {t('network.accessNewKey')}
            </button>
          </div>
          {links.map((link) => (
            <div key={link} className="flex items-center gap-2">
              <code className="mono min-w-0 flex-1 truncate text-[var(--color-muted)]">{link}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(link).catch((reason: unknown) => setError(String(reason)))} className={button}>
                {t('agent.copy')}
              </button>
            </div>
          ))}
          <p className="text-[var(--color-muted)]">{t('network.accessInternet')}</p>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-[var(--color-warn)]">{error}</p>}
    </section>
  )
}
