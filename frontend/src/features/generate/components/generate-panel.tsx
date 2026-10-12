import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AudioLines,
  Captions,
  ChevronDown,
  Clapperboard,
  Eraser,
  ExternalLink,
  FileText,
  Film,
  Image,
  ImagePlus,
  KeyRound,
  Loader2,
  Mic,
  Music,
  Sparkles,
  Volume2,
  WandSparkles,
  Undo2,
  ZoomIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/shared/ui/cn'
import {
  formatUsd,
  generateApi,
  PROVIDER_LABELS,
  TASKS,
  type Estimate,
  type Job,
  type ModelEntry,
  type Provider,
  type Task,
} from '../services/generate-api'
import { modelKey, useGenerateStore } from '../stores/generate-store'
import { useProjectStore } from '../deps/editor'
import { FieldControl } from './field-control'
import { improvePrompt } from '../services/prompt-assist'
import { JobCard } from './job-card'
import { ModelPicker } from './model-picker'

const NO_VALUES: Record<string, unknown> = {}

const TASK_ICONS: Record<Task, typeof Image> = {
  image: Image,
  image_edit: ImagePlus,
  video: Clapperboard,
  video_edit: Film,
  lip_sync: Mic,
  upscale: ZoomIn,
  remove_background: Eraser,
  music: Music,
  speech: AudioLines,
  sound: Volume2,
  transcribe: Captions,
  text: FileText,
}

const KEY_PAGES: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  fal: 'https://fal.ai/dashboard/keys',
  runware: 'https://my.runware.ai/keys',
}

function KeyPrompt({ provider }: { provider: Provider }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [state, setState] = useState<{ busy: boolean; message: string | null; ok: boolean }>({
    busy: false,
    message: null,
    ok: false,
  })
  const save = async () => {
    setState({ busy: true, message: null, ok: false })
    try {
      await generateApi.storeKey(provider, value)
      const checked = await generateApi.checkKey(provider)
      setState({
        busy: false,
        ok: checked.ok,
        message: checked.ok
          ? checked.balance !== null && checked.balance !== undefined
            ? t('generate.keys.okBalance', { balance: formatUsd(checked.balance) })
            : t('generate.keys.ok')
          : (checked.error ?? t('generate.keys.failed')),
      })
      if (checked.ok) setValue('')
    } catch (error) {
      setState({ busy: false, ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2" data-testid="generate-key-prompt">
      <p className="flex items-center gap-1.5 text-[11px] text-amber-100">
        <KeyRound className="h-3.5 w-3.5" />
        {t('generate.keys.needed', { provider: PROVIDER_LABELS[provider] })}
      </p>
      <div className="flex gap-1">
        <Input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('generate.keys.placeholder')}
          className="h-7 text-xs"
        />
        <Button size="sm" className="h-7 text-xs" disabled={!value.trim() || state.busy} onClick={() => void save()}>
          {state.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('generate.keys.save')}
        </Button>
      </div>
      <a
        href={KEY_PAGES[provider]}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[10px] text-amber-200 underline"
      >
        {t('generate.keys.getOne', { provider: PROVIDER_LABELS[provider] })}
        <ExternalLink className="h-3 w-3" />
      </a>
      {state.message && (
        <p className={cn('text-[10px]', state.ok ? 'text-emerald-300' : 'text-destructive')}>{state.message}</p>
      )}
    </div>
  )
}

function useEstimate(provider: Provider | undefined, id: string | undefined, values: Record<string, unknown>, repeat: number) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify([provider, id, values, repeat])
  useEffect(() => {
    if (!provider || !id) return
    let cancelled = false
    const timer = setTimeout(() => {
      generateApi
        .estimate(provider, id, values, repeat)
        .then((answer) => {
          if (cancelled) return
          setEstimate(answer)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (cancelled) return
          setEstimate(null)
          setError(reason instanceof Error ? reason.message : String(reason))
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { estimate, error }
}

export function GeneratePanel() {
  const { t } = useTranslation()
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const task = useGenerateStore((state) => state.task)
  const model = useGenerateStore((state) => state.modelByTask[state.task])
  const keys = useGenerateStore((state) => state.keys)
  const jobs = useGenerateStore((state) => state.jobs)
  const repeat = useGenerateStore((state) => state.repeat)
  const placeOnTimeline = useGenerateStore((state) => state.placeOnTimeline)
  const serverError = useGenerateStore((state) => state.serverError)
  const values = useGenerateStore((state) => (model ? (state.valuesByModel[modelKey(model.provider, model.id)] ?? NO_VALUES) : NO_VALUES))
  const form = useGenerateStore((state) => (model ? state.forms[modelKey(model.provider, model.id)] : undefined))
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [improving, setImproving] = useState(false)
  const [improveError, setImproveError] = useState<string | null>(null)
  const [previousPrompt, setPreviousPrompt] = useState<{ key: string; text: string } | null>(null)
  const { estimate, error: estimateError } = useEstimate(model?.provider, model?.id, values, repeat)

  useEffect(() => {
    if (!model) return
    let cancelled = false
    setFormError(null)
    setFormLoading(true)
    generateApi
      .form(model.provider, model.id)
      .then(({ form: loaded }) => {
        if (!cancelled) useGenerateStore.getState().setForm(loaded)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFormError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setFormLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [model?.provider, model?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fields = useMemo(() => form?.fields ?? [], [form])
  const main = fields.filter((field) => !field.advanced)
  const more = fields.filter((field) => field.advanced)
  const missing = useMemo(
    () =>
      fields.filter((field) => {
        if (!field.required || field.default !== undefined) return false
        const value = values[field.key]
        return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
      }),
    [fields, values],
  )
  const hasKey = model ? keys[model.provider] === true : false

  const generate = async () => {
    if (!model) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { jobs: created } = await generateApi.createJobs({
        provider: model.provider,
        model: model.id,
        task,
        values,
        project_id: projectId,
        repeat,
        place: placeOnTimeline,
      })
      for (const job of created) useGenerateStore.getState().upsertJob(job)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const reuse = (job: Job) => {
    const store = useGenerateStore.getState()
    if (job.task) store.setTask(job.task)
    const ref = { provider: job.provider, id: job.model }
    store.setModel((job.task || task) as Task, ref)
    store.replaceValues(ref, job.values)
  }

  const chooseModel = (entry: ModelEntry) => {
    useGenerateStore.getState().setModel(task, { provider: entry.provider, id: entry.id })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="generate-panel">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {serverError && (
          <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            {t('generate.serverError', { reason: serverError })}
          </p>
        )}
        <div className="grid grid-cols-4 gap-1">
          {TASKS.map((each) => {
            const Icon = TASK_ICONS[each]
            return (
              <button
                key={each}
                type="button"
                onClick={() => useGenerateStore.getState().setTask(each)}
                data-testid={`generate-task-${each}`}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] leading-tight transition-colors',
                  task === each
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary/50',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="text-center">{t(`generate.tasks.${each}`)}</span>
              </button>
            )
          })}
        </div>

        <ModelPicker task={task} value={model} onChange={chooseModel} keys={keys} />

        {model && !hasKey && <KeyPrompt provider={model.provider} />}

        {formLoading && !form && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('generate.form.loading')}
          </div>
        )}
        {formError && <p className="text-[11px] text-destructive">{formError}</p>}

        {form && model && (
          <div className="space-y-2.5">
            {main.map((field) => (
              <div key={field.key} className="space-y-1">
                <FieldControl
                  field={field}
                  value={values[field.key]}
                  onChange={(value) => useGenerateStore.getState().setValue(model, field.key, value)}
                />
                {field.role === 'prompt' && task !== 'transcribe' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={improving || typeof values[field.key] !== 'string' || !(values[field.key] as string).trim() || !keys.openrouter}
                      title={keys.openrouter ? t('generate.improve.hint') : t('generate.improve.needsKey')}
                      onClick={() => {
                        const original = values[field.key] as string
                        setImproving(true)
                        setImproveError(null)
                        improvePrompt(original, task, model.id)
                          .then((better) => {
                            setPreviousPrompt({ key: field.key, text: original })
                            useGenerateStore.getState().setValue(model, field.key, better)
                          })
                          .catch((error: unknown) => setImproveError(error instanceof Error ? error.message : String(error)))
                          .finally(() => setImproving(false))
                      }}
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      {improving ? <Loader2 className="h-3 w-3 animate-spin" /> : <WandSparkles className="h-3 w-3" />}
                      {t('generate.improve.button')}
                    </button>
                    {previousPrompt?.key === field.key && (
                      <button
                        type="button"
                        onClick={() => {
                          useGenerateStore.getState().setValue(model, field.key, previousPrompt.text)
                          setPreviousPrompt(null)
                        }}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <Undo2 className="h-3 w-3" />
                        {t('generate.improve.undo')}
                      </button>
                    )}
                  </div>
                )}
                {field.role === 'prompt' && improveError && <p className="text-[10px] text-destructive">{improveError}</p>}
              </div>
            ))}
            {more.length > 0 && (
              <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')} />
                  {t('generate.form.more', { count: more.length })}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2.5 pt-2">
                  {more.map((field) => (
                    <FieldControl
                      key={field.key}
                      field={field}
                      value={values[field.key]}
                      onChange={(value) => useGenerateStore.getState().setValue(model, field.key, value)}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
            {form.price.note && <p className="text-[10px] text-muted-foreground">{form.price.note}</p>}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Switch
              checked={placeOnTimeline}
              onCheckedChange={(checked) => useGenerateStore.getState().setPlaceOnTimeline(checked)}
            />
            {t('generate.placeOnTimeline')}
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={t('generate.repeatHint')}>
            {t('generate.repeat')}
            <Input
              type="number"
              min={1}
              max={8}
              value={repeat}
              onChange={(event) => useGenerateStore.getState().setRepeat(Number(event.target.value) || 1)}
              className="h-6 w-12 px-1 text-center text-xs"
            />
          </label>
        </div>
        <Button
          className="h-9 w-full gap-2"
          disabled={!form || !hasKey || submitting || missing.length > 0 || !projectId}
          onClick={() => void generate()}
          data-testid="generate-submit"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t('generate.submit')}
          <span className="ml-auto text-xs opacity-80">
            {estimate?.estimate
              ? `${estimate.estimate.exact ? '' : '≈'}${formatUsd(estimate.estimate.usd)}`
              : t('generate.cost.unknown')}
          </span>
        </Button>
        {missing.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {t('generate.form.missing', { fields: missing.map((field) => field.label).join(', ') })}
          </p>
        )}
        {submitError && <p className="text-[11px] text-destructive">{submitError}</p>}
        {estimateError && (
          <p className="text-[10px] text-destructive">{t('generate.cost.failed', { reason: estimateError })}</p>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="max-h-[45%] min-h-0 space-y-2 overflow-y-auto border-t border-border p-3">
          <h3 className="text-[11px] font-medium text-muted-foreground">{t('generate.history', { count: jobs.length })}</h3>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onReuse={reuse} />
          ))}
        </div>
      )}
    </div>
  )
}
