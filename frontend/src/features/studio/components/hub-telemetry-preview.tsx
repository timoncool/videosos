import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { telemetryPreview } from '../services/studio-hub'

// What is sent: exactly the report the program would send today.
export default function HubTelemetryPreview({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    telemetryPreview()
      .then((p) => setReport(p.report ? JSON.stringify(p.report, null, 2) : null))
      .catch((e: Error) => setError(e.message))
  }, [])
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center glass-scrim anim-fade"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('hub.what')}
        className="w-[min(92vw,600px)] max-h-[80vh] overflow-y-auto rounded-xl glass-panel anim-pop p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold">{t('hub.what')}</span>
          <button
            onClick={onClose}
            aria-label={t('news.close')}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--color-muted)] mb-3">{t('hub.why')}</p>
        {error && (
          <p role="alert" className="text-[12px] text-[var(--color-warn)]">
            {error}
          </p>
        )}
        {report ? (
          <pre className="mono text-[11px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 overflow-auto">
            {report}
          </pre>
        ) : (
          !error && <p className="text-[13px] text-[var(--color-muted)]">{t('hub.nothing')}</p>
        )}
      </div>
    </div>
  )
}
