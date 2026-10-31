import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  hubChanged,
  refreshHub,
  resetInstall,
  setTelemetry,
  useHubState,
} from '../services/studio-hub'
import HubTelemetryPreview from './hub-telemetry-preview'

// Anonymous statistics: the switch, what is sent, a new install id and where the news came from.
export default function PrivacySection() {
  const { t, i18n } = useTranslation()
  const hub = useHubState(i18n.language)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tel = hub?.telemetry
  const run = (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    action()
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false)
        hubChanged()
      })
  }
  const btn =
    'px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[13px] hover:border-[var(--color-accent)] disabled:opacity-40'
  return (
    <div className="space-y-5 text-[13px]">
      <section className="space-y-3">
        <p className="leading-relaxed text-[var(--color-muted)]">{t('hub.why')}</p>
        {tel?.disabledByEnv ? (
          <p className="text-[var(--color-warn)]">{t('hub.byEnv')}</p>
        ) : (
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={Boolean(tel?.enabled)}
              disabled={!tel || busy}
              onChange={(e) => run(() => setTelemetry(e.target.checked, true))}
            />
            <span>{t('hub.checkbox')}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => setPreview(true)}>
            {t('hub.what')}
          </button>
          {tel?.install && (
            <button type="button" className={btn} disabled={busy} onClick={() => run(resetInstall)}>
              {t('hub.reset')}
            </button>
          )}
        </div>
      </section>
      <section className="space-y-2">
        <p className="text-[var(--color-muted)]">
          {hub?.source
            ? `${t('hub.feedSource')} ${hub.source} · ${new Date((hub.fetchedAt ?? 0) * 1000).toLocaleString(i18n.language)}`
            : t('hub.feedNever')}
        </p>
        <button type="button" className={btn} disabled={busy} onClick={() => run(refreshHub)}>
          {t('hub.refresh')}
        </button>
      </section>
      {error && (
        <p role="alert" className="text-[12px] text-[var(--color-warn)]">
          {error}
        </p>
      )}
      {preview && <HubTelemetryPreview onClose={() => setPreview(false)} />}
    </div>
  )
}
