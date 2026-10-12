import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/shared/ui/cn'
import { generateApi, PROVIDER_LABELS, PROVIDERS, type CatalogAnswer, type ModelEntry, type Provider, type Task } from '../services/generate-api'

const NEW_DAYS = 45

function isNew(entry: ModelEntry): boolean {
  return !!entry.created && Date.now() / 1000 - entry.created < NEW_DAYS * 86400
}

export function ProviderBadge({ provider, className }: { provider: Provider; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide',
        provider === 'openrouter' && 'bg-sky-500/15 text-sky-300',
        provider === 'fal' && 'bg-violet-500/15 text-violet-300',
        provider === 'runware' && 'bg-emerald-500/15 text-emerald-300',
        className,
      )}
    >
      {PROVIDER_LABELS[provider]}
    </span>
  )
}

interface ModelPickerProps {
  task: Task
  value: { provider: Provider; id: string } | undefined
  onChange: (entry: ModelEntry) => void
  keys: Partial<Record<Provider, boolean>>
}

export function ModelPicker({ task, value, onChange, keys }: ModelPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<Provider | 'all'>('all')
  const [answer, setAnswer] = useState<CatalogAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    generateApi
      .catalog({ task })
      .then((result) => {
        if (cancelled) return
        setAnswer(result)
        setError(null)
        if (!value && result.models.length > 0) {
          const withKey = result.models.find((entry) => result.keys[entry.provider] && entry.status === 'live')
          onChange(withKey ?? result.models[0]!)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // the catalogue is read again when the task changes or the picker opens
  }, [task, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => answer?.models.find((entry) => entry.provider === value?.provider && entry.id === value?.id),
    [answer, value],
  )

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (answer?.models ?? []).filter(
      (entry) =>
        (provider === 'all' || entry.provider === provider) &&
        words.every((word) => `${entry.name} ${entry.id} ${entry.description}`.toLowerCase().includes(word)),
    )
  }, [answer, provider, query])

  const refreshing = PROVIDERS.some((each) => answer?.providers[each]?.refreshing)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="generate-model-picker"
          className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-left hover:bg-secondary/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {value && <ProviderBadge provider={value.provider} />}
              <span className="truncate text-xs font-medium">
                {selected?.name ?? value?.id ?? (loading ? t('generate.model.loading') : t('generate.model.choose'))}
              </span>
            </div>
            {selected?.price && <div className="truncate text-[10px] text-muted-foreground">{selected.price}</div>}
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <div className="space-y-2 border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('generate.model.search')}
            className="h-7 text-xs"
          />
          <div className="flex items-center gap-1">
            {(['all', ...PROVIDERS] as const).map((each) => (
              <button
                key={each}
                type="button"
                onClick={() => setProvider(each)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px]',
                  provider === each ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                {each === 'all' ? t('generate.model.all') : PROVIDER_LABELS[each]}
                {each !== 'all' && answer && (
                  <span className="ml-1 opacity-60">
                    {answer.models.filter((entry) => entry.provider === each).length}
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              title={t('generate.model.refresh')}
              onClick={() => {
                void generateApi.refreshCatalog().catch((reason: unknown) => setError(String(reason)))
              }}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </button>
          </div>
          {answer &&
            PROVIDERS.filter((each) => answer.providers[each]?.error).map((each) => (
              <p key={each} className="text-[10px] text-destructive">
                {PROVIDER_LABELS[each]}: {answer.providers[each]?.error}
              </p>
            ))}
          {error && <p className="text-[10px] text-destructive">{error}</p>}
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1">
          {loading && !answer && (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('generate.model.loading')}
            </div>
          )}
          {answer && shown.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">{t('generate.model.none')}</p>
          )}
          {shown.map((entry) => {
            const active = entry.provider === value?.provider && entry.id === value?.id
            return (
              <button
                key={`${entry.provider}:${entry.id}`}
                type="button"
                onClick={() => {
                  onChange(entry)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-secondary/60',
                  active && 'bg-secondary',
                  entry.status !== 'live' && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <ProviderBadge provider={entry.provider} />
                  <span className="truncate text-xs font-medium">{entry.name}</span>
                  {isNew(entry) && (
                    <span className="rounded bg-primary/20 px-1 text-[9px] text-primary">{t('generate.model.new')}</span>
                  )}
                  {entry.status !== 'live' && (
                    <span className="text-[9px] text-amber-400">{t('generate.model.deprecated')}</span>
                  )}
                  {!keys[entry.provider] && (
                    <KeyRound className="ml-auto h-3 w-3 shrink-0 text-amber-400" aria-label={t('generate.keys.missing')} />
                  )}
                </div>
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{entry.id}</span>
                  {entry.price && <span className="ml-auto shrink-0">{entry.price}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
