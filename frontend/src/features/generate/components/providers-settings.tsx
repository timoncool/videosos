import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/shared/ui/cn'
import { formatUsd, generateApi, PROVIDER_LABELS, PROVIDERS, type KeyState, type Provider } from '../services/generate-api'

const KEY_PAGES: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  fal: 'https://fal.ai/dashboard/keys',
  runware: 'https://my.runware.ai/keys',
}

const MCP_URL = `${window.location.origin.replace('localhost', '127.0.0.1')}/mcp`

function ProviderRow({ state, onChanged }: { state: KeyState; onChanged: () => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await work()
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const check = () =>
    run(async () => {
      const answer = await generateApi.checkKey(state.provider)
      setMessage(
        answer.ok
          ? {
              ok: true,
              text:
                answer.balance !== null && answer.balance !== undefined
                  ? t('generate.keys.okBalance', { balance: formatUsd(answer.balance) })
                  : t('generate.keys.ok'),
            }
          : { ok: false, text: answer.error ?? t('generate.keys.failed') },
      )
    })

  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3" data-testid={`provider-${state.provider}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{PROVIDER_LABELS[state.provider]}</span>
        <span className={cn('text-[11px]', state.set ? 'text-emerald-400' : 'text-muted-foreground')}>
          {state.set
            ? state.source === 'environment'
              ? t('settings.providers.fromEnv', { variable: state.variable })
              : t('settings.providers.stored')
            : t('settings.providers.none')}
        </span>
        <a href={KEY_PAGES[state.provider]} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground underline">
          {t('generate.keys.getOne', { provider: PROVIDER_LABELS[state.provider] })}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="flex gap-1.5">
        <Input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={state.set ? t('settings.providers.replace') : t('generate.keys.placeholder')}
          disabled={state.source === 'environment'}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="h-8"
          disabled={busy || !value.trim()}
          onClick={() =>
            void run(async () => {
              await generateApi.storeKey(state.provider, value.trim())
              setValue('')
              const answer = await generateApi.checkKey(state.provider)
              setMessage(answer.ok ? { ok: true, text: t('generate.keys.ok') } : { ok: false, text: answer.error ?? t('generate.keys.failed') })
            })
          }
        >
          {t('generate.keys.save')}
        </Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy || !state.set} onClick={() => void check()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('settings.providers.check')}
        </Button>
        {state.set && state.source === 'stored' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            disabled={busy}
            onClick={() => void run(async () => void (await generateApi.storeKey(state.provider, null)))}
          >
            {t('settings.providers.remove')}
          </Button>
        )}
      </div>
      {message && <p className={cn('text-[11px]', message.ok ? 'text-emerald-400' : 'text-destructive')}>{message.text}</p>}
    </div>
  )
}

interface Spend {
  total: number
  today: number
  providers: Array<{ provider: Provider; usd: number; jobs: number }>
}

/** Keys of the three providers, what was spent, the agents' daily limit and how to connect an agent. */
export function ProvidersSettings() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<KeyState[]>([])
  const [spend, setSpend] = useState<Spend | null>(null)
  const [budget, setBudget] = useState('')
  const [budgetSaved, setBudgetSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<boolean | null>(null)

  const load = useCallback(() => {
    Promise.all([generateApi.keys(), generateApi.spend(null), generateApi.settings()])
      .then(([keyAnswer, spendAnswer, settings]) => {
        setKeys(keyAnswer.keys)
        setSpend(spendAnswer)
        setBudget(settings.agent_daily_budget_usd === null ? '' : String(settings.agent_daily_budget_usd))
        setError(null)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    fetch('/v1/hub/state', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ telemetry: { enabled: boolean } }>)
      .then((state) => setTelemetry(state.telemetry.enabled))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  useEffect(() => load(), [load])

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const saveBudget = async () => {
    const trimmed = budget.trim().replace(',', '.')
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && !Number.isFinite(value)) return setError(t('settings.providers.badBudget'))
    try {
      await generateApi.storeSettings({ agent_daily_budget_usd: value })
      setBudgetSaved(true)
      setTimeout(() => setBudgetSaved(false), 1500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const claudeCommand = `claude mcp add --transport http videosos ${MCP_URL}`

  return (
    <div className="space-y-4" data-testid="providers-settings">
      <p className="text-xs text-muted-foreground">{t('settings.providers.intro')}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="space-y-2">
        {PROVIDERS.map((provider) => {
          const state = keys.find((each) => each.provider === provider)
          return state ? <ProviderRow key={provider} state={state} onChanged={load} /> : null
        })}
      </div>

      {spend && (
        <div className="space-y-1 rounded-lg border border-border p-3">
          <Label className="text-sm">{t('settings.providers.spend')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.providers.spendLine', { today: formatUsd(spend.today), total: formatUsd(spend.total) })}
          </p>
          {spend.providers.map((each) => (
            <p key={each.provider} className="text-[11px] text-muted-foreground">
              {PROVIDER_LABELS[each.provider]}: {formatUsd(each.usd)} · {t('settings.providers.jobs', { count: each.jobs })}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label className="text-sm">{t('settings.providers.agent')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.providers.agentHint')}</p>
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate rounded bg-secondary/50 px-2 py-1 text-[11px]">{claudeCommand}</code>
          <Button size="sm" variant="outline" className="h-7" onClick={() => copy(claudeCommand)}>
            {copied === claudeCommand ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate rounded bg-secondary/50 px-2 py-1 text-[11px]">{MCP_URL}</code>
          <Button size="sm" variant="outline" className="h-7" onClick={() => copy(MCP_URL)}>
            {copied === MCP_URL ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Label className="text-xs text-muted-foreground">{t('settings.providers.budget')}</Label>
          <Input
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            placeholder={t('settings.providers.noLimit')}
            className="h-7 w-24 text-xs"
          />
          <Button size="sm" variant="outline" className="h-7" onClick={() => void saveBudget()}>
            {budgetSaved ? <Check className="h-3.5 w-3.5" /> : t('generate.keys.save')}
          </Button>
        </div>
      </div>

      {telemetry !== null && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <Label className="text-sm">{t('settings.providers.statistics')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.providers.statisticsHint')}</p>
          </div>
          <Switch
            checked={telemetry}
            onCheckedChange={(enabled) => {
              setTelemetry(enabled)
              void fetch('/v1/hub/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled, acknowledge: true }),
              }).catch((reason: unknown) => setError(String(reason)))
            }}
          />
        </div>
      )}
    </div>
  )
}
