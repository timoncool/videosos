import { useEffect, useMemo, useRef, useState } from 'react'
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
  ScanEye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { toast } from 'sonner'
import { cn } from '@/shared/ui/cn'
import {
  formatUsd,
  generateApi,
  PROVIDER_LABELS,
  TASKS,
  type Job,
  type MediaRef,
  type Field,
  type ModelEntry,
  type KeyedProvider,
  type Task,
} from '../services/generate-api'
import { keyCheckText } from '../services/key-check-text'
import {
  assistantReadiness,
  modelKey,
  useGenerateStore,
  type ModelRef,
} from '../stores/generate-store'
import { SlideToEnable } from './slide-to-enable'
import { LocalModelPrompt } from './local-models-settings'
import { useLocalStatus } from '../hooks/use-local-status'

type CreateRequest = Parameters<typeof generateApi.createJobs>[0]
import { useProjectStore } from '../deps/editor'
import { FieldControl } from './field-control'
import { describeImage, improvePrompt } from '../services/prompt-assist'
import { fillVariables, variablesOf } from '../services/prompt-variables'
import { PromptPresets } from './prompt-presets'
import { PromptElements } from './prompt-elements'
import { applyElements } from '../services/prompt-elements'
import { GenerationHistory } from './generation-history'
import { ModelPicker } from './model-picker'
import { BatchModels, type BatchRun } from './batch-models'
import { carryValues } from '../services/batch-values'
import { useEstimate } from '../hooks/use-estimate'
import { fieldLabel, overLength, providerWords } from '../services/field-label'
import { playheadSeconds } from '../services/timeline-actions'

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

const KEY_PAGES: Record<KeyedProvider, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  fal: 'https://fal.ai/dashboard/keys',
  runware: 'https://my.runware.ai/keys',
}

function KeyPrompt({ provider }: { provider: KeyedProvider }) {
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
        message: keyCheckText(t, checked),
      })
      if (checked.ok) setValue('')
    } catch (error) {
      setState({
        busy: false,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return (
    <div
      className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2"
      data-testid="generate-key-prompt"
    >
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
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!value.trim() || state.busy}
          onClick={() => void save()}
        >
          {state.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('generate.keys.save')}
        </Button>
      </div>
      <a
        href={KEY_PAGES[provider]}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-amber-200 underline"
      >
        {t('generate.keys.getOne', { provider: PROVIDER_LABELS[provider] })}
        <ExternalLink className="h-3 w-3" />
      </a>
      {state.message && (
        <p className={cn('text-[11px]', state.ok ? 'text-emerald-300' : 'text-destructive')}>
          {state.message}
        </p>
      )}
    </div>
  )
}

export function GeneratePanel() {
  const { t, i18n } = useTranslation()
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const task = useGenerateStore((state) => state.task)
  const model = useGenerateStore((state) => state.modelByTask[state.task])
  const keys = useGenerateStore((state) => state.keys)
  const assistant = useGenerateStore((state) => state.assistant)
  const readiness = useGenerateStore(assistantReadiness)
  const canAssist = readiness === 'ready'
  const notReady = t(
    readiness === 'no_agent' ? 'generate.improve.noAgent' : 'generate.improve.needsKey',
  )
  const jobs = useGenerateStore((state) => state.jobs)
  const repeat = useGenerateStore((state) => state.repeat)
  const placeOnTimeline = useGenerateStore((state) => state.placeOnTimeline)
  const serverError = useGenerateStore((state) => state.serverError)
  const values = useGenerateStore((state) =>
    model ? (state.valuesByModel[modelKey(model.provider, model.id)] ?? NO_VALUES) : NO_VALUES,
  )
  const form = useGenerateStore((state) =>
    model ? state.forms[modelKey(model.provider, model.id)] : undefined,
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [improving, setImproving] = useState(false)
  const [improveError, setImproveError] = useState<string | null>(null)
  const [batchRuns, setBatchRuns] = useState<BatchRun[]>([])
  const batchBlocked = batchRuns.some((run) => run.missing.length > 0 || run.error !== null)
  const variables = useGenerateStore((state) => state.variables)
  const variableNames = useMemo(() => variablesOf(values), [values])
  const unfilled = variableNames.filter((name) => !variables[name]?.trim())
  // the picture a prompt can be written from: the first one put into any of the form's picture slots
  const firstImage = useMemo(() => {
    for (const field of form?.fields ?? []) {
      if (field.type !== 'media' || field.media !== 'image') continue
      const value = values[field.key]
      const first = Array.isArray(value) ? value[0] : value
      if (first !== undefined && first !== null && first !== '') return first as MediaRef
    }
    return null
  }, [form, values])
  const [previousPrompt, setPreviousPrompt] = useState<{ key: string; text: string } | null>(null)
  const elements = useGenerateStore((state) => state.elements)
  // what the run is sent with: variables filled, each "@element" named in the prompt brought in with its pictures
  const sent = useMemo(
    () => applyElements(form?.fields ?? [], fillVariables(values, variables), elements),
    [form, values, variables, elements],
  )
  const { estimate, error: estimateError } = useEstimate(
    model?.provider,
    model?.id,
    sent.values,
    repeat,
  )
  // the price of the whole batch: unknown while any of its runs is
  const total =
    estimate?.estimate && batchRuns.every((run) => run.usd !== null)
      ? estimate.estimate.usd + batchRuns.reduce((sum, run) => sum + (run.usd ?? 0), 0)
      : null
  const totalExact = (estimate?.estimate?.exact ?? false) && batchRuns.every((run) => run.exact)

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

  const pendingUse = useGenerateStore((state) => state.pendingUse)
  useEffect(() => {
    if (!pendingUse || pendingUse.task !== task || !model || !form) return
    const media = form.fields.filter((field) => field.type === 'media')
    const slot =
      pendingUse.roles
        .map((role) => media.find((field) => field.role === role))
        .find((field) => field !== undefined) ??
      media.find((field) => field.type === 'media' && field.media === pendingUse.kind)
    useGenerateStore.getState().useAs(null)
    if (!slot) {
      toast.error(t('generate.use.noSlot', { model: model.id }))
      return
    }
    useGenerateStore.getState().setValue(model, slot.key, [pendingUse.ref])
    toast.success(t('generate.use.placed', { field: slot.label }))
  }, [pendingUse, task, model, form, t])

  // another model of the task takes what the form held, field by meaning, where it has nothing of its own yet
  const carryFrom = useRef<{ to: string; fields: Field[]; values: Record<string, unknown> } | null>(
    null,
  )
  useEffect(() => {
    const carry = carryFrom.current
    if (!carry || !model || !form || carry.to !== modelKey(model.provider, model.id)) return
    carryFrom.current = null
    for (const [key, value] of Object.entries(
      carryValues(carry.fields, carry.values, form.fields),
    )) {
      if (values[key] === undefined) useGenerateStore.getState().setValue(model, key, value)
    }
  }, [model, form, values])

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
  const tooLong = useMemo(
    () =>
      fields.flatMap((field) => {
        const over = overLength(field, values[field.key])
        return over ? [{ field, ...over }] : []
      }),
    [fields, values],
  )
  const hasKey = model ? keys[model.provider] === true : false
  const local = useLocalStatus().status
  const localMissing =
    model?.provider === 'local' && !local?.models.find((each) => each.id === model.id)?.installed
  const blocked =
    !form ||
    !hasKey ||
    localMissing ||
    missing.length > 0 ||
    tooLong.length > 0 ||
    unfilled.length > 0 ||
    batchBlocked ||
    !projectId

  /** The runs Create sends now: the chosen model and every model of the batch. */
  const runsNow = (): CreateRequest[] => {
    if (!model) return []
    const placeAt = placeOnTimeline ? playheadSeconds() : null
    const run = (ref: ModelRef, runValues: Record<string, unknown>): CreateRequest => ({
      provider: ref.provider,
      model: ref.id,
      task,
      values: runValues,
      project_id: projectId,
      repeat,
      place: placeOnTimeline,
      place_at: placeAt,
    })
    return [run(model, sent.values), ...batchRuns.map((each) => run(each.ref, each.values))]
  }

  const send = async (runs: CreateRequest[]): Promise<string[]> => {
    const ids: string[] = []
    for (const request of runs) {
      const { jobs: created } = await generateApi.createJobs(request)
      for (const job of created) {
        useGenerateStore.getState().upsertJob(job)
        ids.push(job.id)
      }
    }
    return ids
  }

  const generate = async () => {
    if (!model) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const runs = runsNow()
      const ids = await send(runs)
      if (forever) {
        endless.current = runs
        setEndlessJobs((before) => [...before, ...ids])
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  // Without end, as YuE2 Studio's songs: the runs as they were when it started go again, each with a new seed and
  // into the library rather than onto the timeline, whenever fewer than two generations are at work; a failed one
  // stops it. A snapshot, so editing the form meanwhile does not change the next runs.
  const [forever, setForever] = useState(false)
  const endless = useRef<CreateRequest[] | null>(null)
  const [endlessJobs, setEndlessJobs] = useState<string[]>([])
  const seedKeys = useMemo(
    () => new Set(fields.filter((field) => field.role === 'seed').map((field) => field.key)),
    [fields],
  )
  const working = jobs.filter((job) => ['queued', 'sending', 'running'].includes(job.status)).length
  const endlessRuns = jobs.filter((job) => endlessJobs.includes(job.id))
  const endlessSpent = endlessRuns.reduce((sum, job) => sum + (job.cost ?? job.estimate ?? 0), 0)
  const endlessFailure = endlessRuns.find((job) => job.status === 'failed')

  const switchForever = (on: boolean) => {
    setForever(on)
    if (!on) {
      endless.current = null
      return
    }
    setEndlessJobs([])
    endless.current = runsNow()
  }

  useEffect(() => {
    if (!endlessFailure) return
    setForever(false)
    endless.current = null
    setSubmitError(endlessFailure.error ?? endlessFailure.status)
  }, [endlessFailure])

  useEffect(() => {
    const snapshot = endless.current
    if (!forever || !snapshot || submitting || working >= 2) return
    const again = snapshot.map((request) => ({
      ...request,
      place: false,
      place_at: null,
      values: Object.fromEntries(
        Object.entries(request.values).map(([key, value]) =>
          seedKeys.has(key) ? [key, Math.floor(Math.random() * 2_147_483_647)] : [key, value],
        ),
      ),
    }))
    setSubmitting(true)
    send(again)
      .then((ids) => setEndlessJobs((before) => [...before, ...ids]))
      .catch((error: unknown) => {
        setForever(false)
        endless.current = null
        setSubmitError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setSubmitting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forever, working, submitting])

  const reuse = (job: Job) => {
    const store = useGenerateStore.getState()
    if (job.task) store.setTask(job.task)
    const ref = { provider: job.provider, id: job.model }
    store.setModel((job.task || task) as Task, ref)
    store.replaceValues(ref, job.values)
  }

  const chooseModel = (entry: ModelEntry) => {
    if (form)
      carryFrom.current = { to: modelKey(entry.provider, entry.id), fields: form.fields, values }
    useGenerateStore.getState().setModel(task, { provider: entry.provider, id: entry.id })
  }

  return (
    // one column that scrolls as a whole: the form never shrinks to a slit, Create sticks to the bottom while the
    // form is in view and scrolls away once the history is read (screensdesign's review of AI video apps: every
    // decision visible before spending)
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="generate-panel">
      <div className="space-y-3 p-3">
        {serverError && (
          <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            {t('generate.serverError', { reason: serverError })}
          </p>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          {TASKS.map((each) => {
            const Icon = TASK_ICONS[each]
            return (
              <button
                key={each}
                type="button"
                onClick={() => useGenerateStore.getState().setTask(each)}
                data-testid={`generate-task-${each}`}
                aria-pressed={task === each}
                className={cn(
                  'flex h-[56px] flex-col items-center justify-start gap-1 rounded-md border px-1 pt-2 text-[11px] leading-[1.15] transition-colors',
                  task === each
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-overlay)] hover:text-[var(--color-text)]',
                )}
              >
                <Icon
                  className={cn('h-4 w-4 shrink-0', task === each && 'text-[var(--color-accent)]')}
                />
                <span className="flex h-[26px] items-center text-center">
                  <span className="line-clamp-2">{t(`generate.tasks.${each}`)}</span>
                </span>
              </button>
            )
          })}
        </div>

        <ModelPicker task={task} value={model} onChange={chooseModel} keys={keys} />
        <BatchModels
          task={task}
          form={form}
          values={fillVariables(values, variables)}
          repeat={repeat}
          keys={keys}
          onRuns={setBatchRuns}
        />

        {model && !hasKey && model.provider !== 'local' && <KeyPrompt provider={model.provider} />}
        {model?.provider === 'local' && localMissing && <LocalModelPrompt modelId={model.id} />}

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
                  onChange={(value) =>
                    useGenerateStore.getState().setValue(model, field.key, value)
                  }
                />
                {field.role === 'prompt' && task !== 'transcribe' && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      disabled={
                        improving ||
                        typeof values[field.key] !== 'string' ||
                        !(values[field.key] as string).trim() ||
                        !canAssist
                      }
                      title={canAssist ? t(`generate.improve.hint.${assistant}`) : notReady}
                      onClick={() => {
                        const original = values[field.key] as string
                        setImproving(true)
                        setImproveError(null)
                        improvePrompt(original, task, model.id)
                          .then((better) => {
                            setPreviousPrompt({ key: field.key, text: original })
                            useGenerateStore.getState().setValue(model, field.key, better)
                          })
                          .catch((error: unknown) =>
                            setImproveError(error instanceof Error ? error.message : String(error)),
                          )
                          .finally(() => setImproving(false))
                      }}
                      className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      {improving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <WandSparkles className="h-3 w-3" />
                      )}
                      {t('generate.improve.button')}
                    </button>
                    <PromptPresets
                      text={
                        typeof values[field.key] === 'string' ? (values[field.key] as string) : ''
                      }
                      onUse={(text) => useGenerateStore.getState().setValue(model, field.key, text)}
                    />
                    <PromptElements
                      fields={fields}
                      values={values}
                      onMention={(name) => {
                        const text =
                          typeof values[field.key] === 'string' ? (values[field.key] as string) : ''
                        useGenerateStore
                          .getState()
                          .setValue(
                            model,
                            field.key,
                            `${text}${text && !/\s$/.test(text) ? ' ' : ''}@${name} `,
                          )
                      }}
                    />
                    {firstImage && (
                      <button
                        type="button"
                        disabled={improving || !canAssist}
                        title={canAssist ? t(`generate.describe.hint.${assistant}`) : notReady}
                        onClick={() => {
                          const original =
                            typeof values[field.key] === 'string'
                              ? (values[field.key] as string)
                              : ''
                          setImproving(true)
                          setImproveError(null)
                          describeImage(firstImage, task, model.id, i18n.language)
                            .then((written) => {
                              setPreviousPrompt({ key: field.key, text: original })
                              useGenerateStore.getState().setValue(model, field.key, written)
                            })
                            .catch((error: unknown) =>
                              setImproveError(
                                error instanceof Error ? error.message : String(error),
                              ),
                            )
                            .finally(() => setImproving(false))
                        }}
                        className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        <ScanEye className="h-3 w-3" />
                        {t('generate.describe.button')}
                      </button>
                    )}
                    {previousPrompt?.key === field.key && (
                      <button
                        type="button"
                        onClick={() => {
                          useGenerateStore
                            .getState()
                            .setValue(model, field.key, previousPrompt.text)
                          setPreviousPrompt(null)
                        }}
                        className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Undo2 className="h-3 w-3" />
                        {t('generate.improve.undo')}
                      </button>
                    )}
                  </div>
                )}
                {field.role === 'prompt' && improveError && (
                  <p className="text-[11px] text-destructive">{improveError}</p>
                )}
                {field.role === 'prompt' && sent.left.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('generate.elements.left', {
                      names: sent.left.map((name) => `@${name}`).join(', '),
                    })}
                  </p>
                )}
                {field.role === 'prompt' && variableNames.length > 0 && (
                  <div
                    className="grid grid-cols-2 gap-2 rounded-md border border-border bg-secondary/20 p-2"
                    aria-label={t('generate.variables.title')}
                  >
                    {variableNames.map((name) => (
                      <label
                        key={name}
                        className="flex flex-col gap-1 text-[11px] text-muted-foreground"
                      >
                        <span className="font-mono">{`{{${name}}}`}</span>
                        <Input
                          value={variables[name] ?? ''}
                          onChange={(event) =>
                            useGenerateStore.getState().setVariable(name, event.target.value)
                          }
                          className="h-7 text-xs"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {more.length > 0 && (
              <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')}
                  />
                  {t('generate.form.more', { count: more.length })}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2.5 pt-2">
                  {more.map((field) => (
                    <FieldControl
                      key={field.key}
                      field={field}
                      value={values[field.key]}
                      onChange={(value) =>
                        useGenerateStore.getState().setValue(model, field.key, value)
                      }
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
            {form.price.note && (
              <p className="text-[11px] text-muted-foreground">
                {providerWords(t, form.price.note)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 space-y-2 border-y border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Switch
              checked={placeOnTimeline}
              onCheckedChange={(checked) => useGenerateStore.getState().setPlaceOnTimeline(checked)}
              aria-label={t('generate.placeOnTimeline')}
            />
            {t('generate.placeOnTimeline')}
          </label>
          <label
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title={t('generate.repeatHint')}
          >
            {t('generate.repeat')}
            <Input
              type="number"
              min={1}
              max={8}
              value={repeat}
              onChange={(event) =>
                useGenerateStore.getState().setRepeat(Number(event.target.value) || 1)
              }
              className="h-7 w-12 px-1 text-center text-xs"
            />
          </label>
        </div>
        <Button
          className="bg-brand h-9 w-full gap-2"
          disabled={blocked || submitting}
          onClick={() => void generate()}
          data-testid="generate-submit"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {t('generate.submit')}
          <span className="ml-auto text-xs opacity-80">
            {total !== null
              ? `${totalExact ? '' : '≈'}${formatUsd(total)}`
              : t('generate.cost.unknown')}
          </span>
        </Button>
        {(!blocked || forever) && (
          <SlideToEnable
            on={forever}
            onChange={switchForever}
            offLabel={t('generate.forever.slide')}
            title={t('generate.forever.hint')}
            stop={
              <>
                {t('generate.forever.stop')}
                <span className="font-normal opacity-90">
                  {t('generate.forever.counter', {
                    count: endlessJobs.length,
                    spent: formatUsd(endlessSpent),
                  })}
                </span>
              </>
            }
          />
        )}
        {missing.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {t('generate.form.missing', {
              fields: missing.map((field) => fieldLabel(t, field)).join(', '),
            })}
          </p>
        )}
        {unfilled.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {t('generate.variables.missing', { names: unfilled.join(', ') })}
          </p>
        )}
        {tooLong.map(({ field, count, max }) => (
          <p key={field.key} className="text-[11px] text-destructive">
            {t('generate.form.shorten', { field: fieldLabel(t, field), count, max })}
          </p>
        ))}
        {submitError && <p className="text-[11px] text-destructive">{submitError}</p>}
        {estimateError && (
          <p className="text-[11px] text-destructive">
            {t('generate.cost.failed', { reason: estimateError })}
          </p>
        )}
      </div>

      {jobs.length > 0 && <GenerationHistory jobs={jobs} projectId={projectId} onReuse={reuse} />}
    </div>
  )
}
