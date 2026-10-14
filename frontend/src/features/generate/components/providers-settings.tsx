import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/shared/ui/cn'
import {
  formatUsd,
  generateApi,
  PROVIDER_LABELS,
  PROVIDERS,
  type KeyState,
  type Provider,
} from '../services/generate-api'
import { keyCheckText } from '../services/key-check-text'

const KEY_PAGES: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  fal: 'https://fal.ai/dashboard/keys',
  runware: 'https://my.runware.ai/keys',
}

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
      setMessage({ ok: answer.ok, text: keyCheckText(t, answer) })
    })

  return (
    <div
      className="space-y-1.5 rounded-lg border border-border p-3"
      data-testid={`provider-${state.provider}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{PROVIDER_LABELS[state.provider]}</span>
        <span
          className={cn('text-[11px]', state.set ? 'text-emerald-400' : 'text-muted-foreground')}
        >
          {state.set
            ? state.source === 'environment'
              ? t('settings.providers.fromEnv', { variable: state.variable })
              : t('settings.providers.stored')
            : t('settings.providers.none')}
        </span>
        <a
          href={KEY_PAGES[state.provider]}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground underline"
        >
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
              setMessage({ ok: answer.ok, text: keyCheckText(t, answer) })
            })
          }
        >
          {t('generate.keys.save')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={busy || !state.set}
          onClick={() => void check()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('settings.providers.check')}
        </Button>
        {state.set && state.source === 'stored' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            disabled={busy}
            onClick={() =>
              void run(async () => void (await generateApi.storeKey(state.provider, null)))
            }
          >
            {t('settings.providers.remove')}
          </Button>
        )}
      </div>
      {message && (
        <p className={cn('text-[11px]', message.ok ? 'text-emerald-400' : 'text-destructive')}>
          {message.text}
        </p>
      )}
    </div>
  )
}

interface Spend {
  total: number
  today: number
  providers: Array<{ provider: Provider; usd: number; jobs: number }>
}

/** Keys of the three providers and what was spent. */
export function ProvidersSettings() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<KeyState[]>([])
  const [spend, setSpend] = useState<Spend | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([generateApi.keys(), generateApi.spend(null)])
      .then(([keyAnswer, spendAnswer]) => {
        setKeys(keyAnswer.keys)
        setSpend(spendAnswer)
        setError(null)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
  }, [])

  useEffect(() => load(), [load])

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
            {t('settings.providers.spendLine', {
              today: formatUsd(spend.today),
              total: formatUsd(spend.total),
            })}
          </p>
          {spend.providers.map((each) => (
            <p key={each.provider} className="text-[11px] text-muted-foreground">
              {PROVIDER_LABELS[each.provider]}: {formatUsd(each.usd)} ·{' '}
              {t('settings.providers.jobs', { count: each.jobs })}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
