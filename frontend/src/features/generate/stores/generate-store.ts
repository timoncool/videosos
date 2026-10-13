/**
 * State of the generation panel: the chosen task, the model chosen for each
 * task, what was typed into each model's form, the jobs of the open project
 * and which providers have keys. Choices survive a restart in localStorage;
 * jobs and keys are the server's and are read from it.
 */

import { create } from 'zustand'
import type { Job, MediaKind, MediaRef, ModelForm, Provider, Role, Task } from '../services/generate-api'

const STORAGE_KEY = 'videosos-generate'

interface ModelRef {
  provider: Provider
  id: string
}

interface Persisted {
  task: Task
  modelByTask: Partial<Record<Task, ModelRef>>
  valuesByModel: Record<string, Record<string, unknown>>
  repeat: number
  placeOnTimeline: boolean
}

function load(): Persisted {
  const fallback: Persisted = { task: 'image', modelByTask: {}, valuesByModel: {}, repeat: 1, placeOnTimeline: false }
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return fallback
    return { ...fallback, ...(JSON.parse(text) as Partial<Persisted>) }
  } catch {
    return fallback
  }
}

function save(state: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // a page without storage keeps its choices for this session only
  }
}

export function modelKey(provider: Provider, id: string): string {
  return `${provider}:${id}`
}

/** A result to be put into a slot of another task's form ("use as..."), applied once that form is open. */
export interface PendingUse {
  task: Task
  /** The slots it fits, best first; any slot of its kind when the model has none of these. */
  roles: Role[]
  kind: MediaKind
  ref: MediaRef
}

interface GenerateState extends Persisted {
  pendingUse: PendingUse | null
  useAs: (use: PendingUse | null) => void
  jobs: Job[]
  keys: Partial<Record<Provider, boolean>>
  forms: Record<string, ModelForm>
  /** Why the panel could not reach the server, shown above everything else. */
  serverError: string | null
  setServerError: (message: string | null) => void
  setTask: (task: Task) => void
  setModel: (task: Task, model: ModelRef) => void
  setValue: (model: ModelRef, key: string, value: unknown) => void
  replaceValues: (model: ModelRef, values: Record<string, unknown>) => void
  setRepeat: (repeat: number) => void
  setPlaceOnTimeline: (place: boolean) => void
  setJobs: (jobs: Job[]) => void
  upsertJob: (job: Job) => void
  removeJob: (id: string) => void
  setKeys: (keys: Partial<Record<Provider, boolean>>) => void
  setForm: (form: ModelForm) => void
}

function persisted(state: GenerateState): Persisted {
  return {
    task: state.task,
    modelByTask: state.modelByTask,
    valuesByModel: state.valuesByModel,
    repeat: state.repeat,
    placeOnTimeline: state.placeOnTimeline,
  }
}

export const useGenerateStore = create<GenerateState>()((set, get) => ({
  ...load(),
  jobs: [],
  keys: {},
  forms: {},
  serverError: null,
  pendingUse: null,
  useAs: (pendingUse) => {
    set({ pendingUse })
    if (pendingUse) {
      set({ task: pendingUse.task })
      save(persisted(get()))
    }
  },
  setServerError: (serverError) => set({ serverError }),
  setTask: (task) => {
    set({ task })
    save(persisted(get()))
  },
  setModel: (task, model) => {
    set({ modelByTask: { ...get().modelByTask, [task]: model } })
    save(persisted(get()))
  },
  setValue: (model, key, value) => {
    const id = modelKey(model.provider, model.id)
    const current = get().valuesByModel[id] ?? {}
    const next = { ...current }
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    } else {
      next[key] = value
    }
    set({ valuesByModel: { ...get().valuesByModel, [id]: next } })
    save(persisted(get()))
  },
  replaceValues: (model, values) => {
    set({ valuesByModel: { ...get().valuesByModel, [modelKey(model.provider, model.id)]: values } })
    save(persisted(get()))
  },
  setRepeat: (repeat) => {
    set({ repeat: Math.min(8, Math.max(1, Math.round(repeat))) })
    save(persisted(get()))
  },
  setPlaceOnTimeline: (placeOnTimeline) => {
    set({ placeOnTimeline })
    save(persisted(get()))
  },
  setJobs: (jobs) => set({ jobs }),
  upsertJob: (job) => {
    const jobs = get().jobs
    const index = jobs.findIndex((each) => each.id === job.id)
    if (index === -1) {
      set({ jobs: [job, ...jobs] })
    } else if (jobs[index]!.updated <= job.updated) {
      const next = jobs.slice()
      next[index] = job
      set({ jobs: next })
    }
  },
  removeJob: (id) => set({ jobs: get().jobs.filter((job) => job.id !== id) }),
  setKeys: (keys) => set({ keys }),
  setForm: (form) => set({ forms: { ...get().forms, [modelKey(form.provider, form.id)]: form } }),
}))
