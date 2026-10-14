import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { fieldLabel } from '../services/field-label'
import { carryValues } from '../services/batch-values'
import { PROVIDER_LABELS, formatUsd, generateApi, type Field, type ModelForm, type Provider, type Task } from '../services/generate-api'
import { useEstimate } from '../hooks/use-estimate'
import { modelKey, useGenerateStore, type ModelRef } from '../stores/generate-store'
import { ModelPicker } from './model-picker'

const NO_MODELS: ModelRef[] = []

/** One more model's run of the batch: its values carried from the form, its price, and what it still lacks. */
export interface BatchRun {
  ref: ModelRef
  values: Record<string, unknown>
  usd: number | null
  exact: boolean
  missing: string[]
  error: string | null
}

function ExtraModel({ task, model, fields, values, repeat, keys, onRun, onRemove, onReplace }: {
  task: Task
  model: ModelRef
  fields: Field[]
  values: Record<string, unknown>
  repeat: number
  keys: Partial<Record<Provider, boolean>>
  onRun: (run: BatchRun) => void
  onRemove: () => void
  onReplace: (model: ModelRef) => void
}) {
  const { t } = useTranslation()
  const form = useGenerateStore((state) => state.forms[modelKey(model.provider, model.id)])
  const [formError, setFormError] = useState<string | null>(null)
  useEffect(() => {
    if (form) return
    generateApi.form(model.provider, model.id).then((answer) => useGenerateStore.getState().setForm(answer.form), (error: unknown) => setFormError(error instanceof Error ? error.message : String(error)))
  }, [form, model.provider, model.id])
  const carried = form ? carryValues(fields, values, form.fields) : {}
  const { estimate, error } = useEstimate(form ? model.provider : undefined, model.id, carried, repeat)
  const missing = (form?.fields ?? [])
    .filter((field) => field.required && field.default === undefined && (carried[field.key] === undefined || carried[field.key] === '' || (Array.isArray(carried[field.key]) && (carried[field.key] as unknown[]).length === 0)))
    .map((field) => fieldLabel(t, field))
  const key = JSON.stringify([carried, estimate, error, formError, form ? 1 : 0, missing, keys[model.provider]])
  useEffect(() => {
    const noKey = keys[model.provider] ? null : t('generate.batch.noKey', { provider: PROVIDER_LABELS[model.provider] })
    onRun({ ref: model, values: carried, usd: estimate?.estimate?.usd ?? null, exact: estimate?.estimate?.exact ?? false, missing, error: noKey ?? formError ?? error ?? (form ? null : t('generate.form.loading')) })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ModelPicker task={task} value={model} onChange={(entry) => onReplace({ provider: entry.provider, id: entry.id })} keys={keys} />
        </div>
        <button type="button" onClick={onRemove} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground" title={t('generate.batch.remove')} aria-label={t('generate.batch.remove')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        {estimate?.estimate ? `${estimate.estimate.exact ? '' : '≈'}${formatUsd(estimate.estimate.usd)}` : t('generate.cost.unknown')}
        {missing.length > 0 && <span className="text-destructive"> · {t('generate.batch.lacks', { fields: missing.join(', ') })}</span>}
        {!keys[model.provider] && <span className="text-destructive"> · {t('generate.batch.noKey', { provider: PROVIDER_LABELS[model.provider] })}</span>}
        {(formError ?? error) && <span className="text-destructive"> · {formError ?? error}</span>}
      </p>
    </div>
  )
}

/**
 * The batch, as the competitors' "models x variants": the same brief goes to up to two more models of the task,
 * each with its price, so the results stand side by side in the history.
 */
export function BatchModels({ task, form, values, repeat, keys, onRuns }: {
  task: Task
  form: ModelForm | undefined
  values: Record<string, unknown>
  repeat: number
  keys: Partial<Record<Provider, boolean>>
  onRuns: (runs: BatchRun[]) => void
}) {
  const { t } = useTranslation()
  const extras = useGenerateStore((state) => state.extraModelsByTask[task] ?? NO_MODELS)
  const [runs, setRuns] = useState<Record<string, BatchRun>>({})
  const ids = extras.map((each) => modelKey(each.provider, each.id))
  useEffect(() => {
    onRuns(ids.map((id) => runs[id]).filter((run): run is BatchRun => run !== undefined))
  }, [JSON.stringify([ids, runs])]) // eslint-disable-line react-hooks/exhaustive-deps
  const remove = (model: ModelRef) => {
    useGenerateStore.getState().setExtraModels(task, extras.filter((each) => !(each.provider === model.provider && each.id === model.id)))
    setRuns((current) => {
      const next = { ...current }
      delete next[modelKey(model.provider, model.id)]
      return next
    })
  }
  if (!form) return null
  return (
    <div className="space-y-2">
      {extras.map((model) => (
        <ExtraModel
          key={modelKey(model.provider, model.id)}
          task={task}
          model={model}
          fields={form.fields}
          values={values}
          repeat={repeat}
          keys={keys}
          onRun={(run) => setRuns((current) => ({ ...current, [modelKey(model.provider, model.id)]: run }))}
          onRemove={() => remove(model)}
          onReplace={(next) => {
            remove(model)
            useGenerateStore.getState().setExtraModels(task, [...extras.filter((each) => !(each.provider === model.provider && each.id === model.id)), next])
          }}
        />
      ))}
      {extras.length < 2 && (
        <AddModel task={task} keys={keys} onAdd={(model) => useGenerateStore.getState().setExtraModels(task, [...extras, model])} label={t('generate.batch.add')} />
      )}
    </div>
  )
}

function AddModel({ task, keys, onAdd, label }: { task: Task; keys: Partial<Record<Provider, boolean>>; onAdd: (model: ModelRef) => void; label: string }) {
  const [picking, setPicking] = useState(false)
  if (!picking) {
    return (
      <button type="button" onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <Plus className="h-3 w-3" />
        {label}
      </button>
    )
  }
  return (
    <ModelPicker
      task={task}
      value={undefined}
      keys={keys}
      autoSelect={false}
      onChange={(entry) => {
        onAdd({ provider: entry.provider, id: entry.id })
        setPicking(false)
      }}
    />
  )
}
