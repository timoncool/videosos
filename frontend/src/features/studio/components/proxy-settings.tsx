import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Eye, EyeOff, Globe, Loader2, X } from 'lucide-react'

/**
 * The proxy for everything VideoSOS fetches from the internet (as in the music studios). The service routes each
 * request by what is saved here, at once and without a restart; the address is written in whatever form the proxy
 * seller gave it. "Check" asks the three providers through the proxy on the form before anything is saved.
 */

type Mode = 'system' | 'custom' | 'off'
type Kind = 'http' | 'https' | 'socks5' | 'socks4'

interface Settings {
  mode: Mode
  address: string | null
  kind: Kind
}

interface Probe {
  openrouter: boolean
  openrouter_error: string | null
  fal: boolean
  fal_error: string | null
  runware: boolean
  runware_error: string | null
}

const CONTROL =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50'

const KINDS: { id: Kind; label: string }[] = [
  { id: 'http', label: 'HTTP' },
  { id: 'https', label: 'HTTPS' },
  { id: 'socks5', label: 'SOCKS5' },
  { id: 'socks4', label: 'SOCKS4' },
]

function Segments<T extends string>({
  items,
  value,
  onPick,
}: {
  items: { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
}) {
  return (
    <div className="flex w-fit rounded-md border border-[var(--color-border)] p-0.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item.id)}
          className={`rounded px-3 py-1 text-[12px] font-semibold transition-colors ${value === item.id ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function ProxySettings() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('system')
  const [kind, setKind] = useState<Kind>('http')
  const [address, setAddress] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void fetch('/api/network/proxy')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((body: Settings & { problem?: string | null }) => {
        setMode(body.mode)
        setKind(body.kind)
        setAddress(body.address ?? '')
        // a saved address the service cannot read: requests go straight out until it is fixed here
        if (body.problem) setError(body.problem)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
  }, [])

  const form = (): Settings => ({ mode, kind, address: address.trim() || null })
  const changed = () => {
    setProbe(null)
    setSaved(false)
  }

  const send = async <T,>(path: string, method: 'PUT' | 'POST'): Promise<T> => {
    const response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form()),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(text || String(response.status))
    return JSON.parse(text) as T
  }

  const run = async (what: 'test' | 'save') => {
    setBusy(what)
    setError(null)
    setProbe(null)
    setSaved(false)
    try {
      if (what === 'test') setProbe(await send<Probe>('/api/network/proxy/test', 'POST'))
      else {
        await send('/api/network/proxy', 'PUT')
        setSaved(true)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const target = (name: string, ok: boolean, detail: string | null) => (
    <div className="flex items-start gap-2 text-[12px]" key={name}>
      {ok ? (
        <Check size={14} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
      ) : (
        <X size={14} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
      )}
      <span className="min-w-0">
        <span className="font-semibold">{name}</span>{' '}
        <span className={ok ? 'text-[var(--color-accent)]' : 'text-[var(--color-warn)]'}>
          {ok ? t('network.proxyReachable') : t('network.proxyUnreachable')}
        </span>
        {!ok && detail && (
          <span className="block break-words text-[11px] text-[var(--color-muted)]">{detail}</span>
        )}
      </span>
    </div>
  )

  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
      <h4 className="flex items-center gap-2 text-[13px] font-semibold">
        <Globe size={15} className="text-[var(--color-accent)]" /> {t('network.proxyTitle')}
      </h4>
      <p className="text-[12px] leading-5 text-[var(--color-muted)]">{t('network.proxyIntro')}</p>
      <Segments
        items={[
          { id: 'system', label: t('network.proxyModeSystem') },
          { id: 'custom', label: t('network.proxyModeCustom') },
          { id: 'off', label: t('network.proxyModeOff') },
        ]}
        value={mode}
        onPick={(id) => {
          setMode(id)
          changed()
        }}
      />
      {mode === 'custom' && (
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              {t('network.proxyKind')}
            </span>
            <Segments
              items={KINDS}
              value={kind}
              onPick={(id) => {
                setKind(id)
                changed()
              }}
            />
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-muted)]">
              {t('network.proxyKindHint')}
            </p>
          </div>
          <div>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              {t('network.proxyAddress')}
            </span>
            <div className="relative">
              <input
                type={reveal ? 'text' : 'password'}
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value)
                  changed()
                }}
                placeholder={t('network.proxyAddressPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className={`${CONTROL} mono pr-10`}
              />
              <button
                type="button"
                onClick={() => setReveal((value) => !value)}
                aria-label={reveal ? t('network.hide') : t('network.show')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-muted)]">
              {t('network.proxyAddressHint')}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run('test')}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-semibold hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {busy === 'test' && <Loader2 size={13} className="animate-spin" />}{' '}
          {t('network.proxyTest')}
        </button>
        <button
          type="button"
          onClick={() => void run('save')}
          disabled={busy !== null}
          className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-[12px] font-bold text-[var(--color-on-accent)] disabled:opacity-50"
        >
          {busy === 'save' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            t('network.proxySave')
          )}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-accent)]">
            <Check size={14} /> {t('network.proxySaved')}
          </span>
        )}
      </div>
      {probe && (
        <div className="space-y-1.5 rounded-md bg-[var(--color-surface)] p-3">
          {target('OpenRouter', probe.openrouter, probe.openrouter_error)}
          {target('fal', probe.fal, probe.fal_error)}
          {target('Runware', probe.runware, probe.runware_error)}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] px-3 py-2 text-[12px] text-[var(--color-warn)]"
        >
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </p>
      )}
      <p className="text-[11px] leading-4 text-[var(--color-muted)]">
        {t('network.proxyWindowNote')}
      </p>
    </section>
  )
}
