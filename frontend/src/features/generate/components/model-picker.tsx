import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, KeyRound, Loader2, RefreshCw, Star } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/shared/ui/cn'
import { generateApi, priceLine, PROVIDER_LABELS, PROVIDERS, type CatalogAnswer, type Job, type ModelEntry, type Provider, type Task } from '../services/generate-api'
import { modelKey, useGenerateStore } from '../stores/generate-store'

const NEW_DAYS = 45

function isNew(entry: ModelEntry): boolean {
  return !!entry.created && Date.now() / 1000 - entry.created < NEW_DAYS * 86400
}

export function ProviderBadge({ provider, className }: { provider: Provider; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-px text-[11px] font-medium uppercase tracking-wide',
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
  /** Without a model yet, take the first one with a key; off for a picker that adds a model by choice. */
  autoSelect?: boolean
}

export function ModelPicker({ task, value, onChange, keys, autoSelect = true }: ModelPickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<Provider | 'all'>('all')
  const [answer, setAnswer] = useState<CatalogAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const favorites = useGenerateStore((state) => state.favorites)
  const toggleFavorite = useGenerateStore((state) => state.toggleFavorite)
  const [typical, setTypical] = useState<Record<string, number>>({})

  // how long a model takes, as the median of this computer's finished runs of it (Krea shows speed in its picker)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    generateApi
      .jobs(null)
      .then(({ jobs }) => {
        if (!cancelled) setTypical(medianSeconds(jobs))
      })
      .catch((reason: unknown) => console.error('[ERROR] the run times were not read:', reason))
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    generateApi
      .catalog({ task })
      .then((result) => {
        if (cancelled) return
        setAnswer(result)
        setError(null)
        if (autoSelect && !value && result.models.length > 0) {
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
    const found = (answer?.models ?? []).filter(
      (entry) =>
        (provider === 'all' || entry.provider === provider) &&
        words.every((word) => `${entry.name} ${entry.id} ${entry.description}`.toLowerCase().includes(word)),
    )
    const pinned = (entry: ModelEntry) => (favorites.includes(modelKey(entry.provider, entry.id)) ? 0 : 1)
    return found.sort((a, b) => pinned(a) - pinned(b))
  }, [answer, provider, query, favorites])

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
            {selected && priceLine(t, selected) && <div className="truncate text-[11px] text-muted-foreground">{priceLine(t, selected)}</div>}
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
                  provider === each ? 'bg-[var(--color-overlay)] text-[var(--color-text)] shadow-sm' : 'text-muted-foreground hover:bg-secondary',
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
              <p key={each} className="text-[11px] text-destructive">
                {PROVIDER_LABELS[each]}: {answer.providers[each]?.error}
              </p>
            ))}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
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
            const key = modelKey(entry.provider, entry.id)
            const pinned = favorites.includes(key)
            const seconds = typical[key]
            const strength = firstSentence(entry.description)
            return (
              <div key={key} className={cn('group flex items-start gap-1 px-1.5 hover:bg-[var(--color-surface-2)]', active && 'bg-[var(--color-surface-2)]', entry.status !== 'live' && 'opacity-60')}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(entry)
                    setOpen(false)
                  }}
                  title={entry.id}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-1.5 py-1.5 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <ProviderBadge provider={entry.provider} />
                    <span className="truncate text-xs font-medium">{entry.name}</span>
                    {isNew(entry) && (
                      <span className="rounded bg-[var(--color-accent)]/15 px-1 text-[11px] text-[var(--color-accent)]">{t('generate.model.new')}</span>
                    )}
                    {entry.status !== 'live' && <span className="text-[11px] text-[var(--color-warn)]">{t('generate.model.deprecated')}</span>}
                    {!keys[entry.provider] && (
                      <KeyRound className="ml-auto h-3 w-3 shrink-0 text-[var(--color-warn)]" aria-label={t('generate.keys.missing')} />
                    )}
                  </div>
                  {strength && <div className="truncate text-[11px] text-[var(--color-muted)]">{strength}</div>}
                  <div className="tabnum flex gap-2 text-[11px] text-[var(--color-muted)]">
                    {priceLine(t, entry) && <span className="text-[var(--color-text)]/80">{priceLine(t, entry)}</span>}
                    {seconds !== undefined && <span>{t('generate.model.typicalTime', { time: formatSeconds(seconds, i18n.language) })}</span>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavorite(key)}
                  aria-pressed={pinned}
                  aria-label={pinned ? t('generate.model.unpin') : t('generate.model.pin')}
                  title={pinned ? t('generate.model.unpin') : t('generate.model.pin')}
                  className={cn(
                    'mt-1.5 shrink-0 rounded p-1 transition-opacity hover:bg-[var(--color-overlay)]',
                    pinned ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)] opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                  )}
                >
                  <Star className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} />
                </button>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The median time of finished runs of each model, in seconds, keyed `provider:id`. */
function medianSeconds(jobs: Job[]): Record<string, number> {
  const times: Record<string, number[]> = {}
  for (const job of jobs) {
    if (job.status !== 'done' || job.updated <= job.created) continue
    const key = modelKey(job.provider, job.model)
    ;(times[key] ??= []).push((job.updated - job.created) / 1000)
  }
  return Object.fromEntries(
    Object.entries(times).map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a - b)
      return [key, sorted[Math.floor(sorted.length / 2)] ?? 0]
    }),
  )
}

function formatSeconds(seconds: number, language: string): string {
  const minutes = seconds >= 90
  return new Intl.NumberFormat(language, { style: 'unit', unit: minutes ? 'minute' : 'second', unitDisplay: 'short' }).format(Math.round(minutes ? seconds / 60 : seconds))
}

/** What a model is good at, as its description opens. */
function firstSentence(text: string): string {
  const line = text.trim().split(/\n/)[0] ?? ''
  const end = line.search(/[.!?](\s|$)/)
  return (end > 0 ? line.slice(0, end + 1) : line).slice(0, 140)
}
