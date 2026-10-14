/**
 * State of the generation panel: the chosen task, the model chosen for each
 * task, what was typed into each model's form, the jobs of the open project
 * and which providers have keys. The choices are kept by the server, as Dub
 * Studio keeps its launch form, so every window finds them; jobs and keys are
 * the server's too and are read from it.
 */

import { create } from 'zustand'
import { generateApi, type Job, type MediaKind, type MediaRef, type ModelForm, type Provider, type Role, type Task } from '../services/generate-api'
import type { PromptElement } from '../services/prompt-elements'
import type { Shot, Storyboard } from '../services/storyboard'
import type { CanvasGraph } from '../services/canvas-graph'

export interface ModelRef {
  provider: Provider
  id: string
}

export interface Persisted {
  task: Task
  modelByTask: Partial<Record<Task, ModelRef>>
  valuesByModel: Record<string, Record<string, unknown>>
  repeat: number
  placeOnTimeline: boolean
  /** Models pinned to the top of the picker, as `provider:id`. */
  favorites: string[]
  /** Prompts kept under a name, to be put into any form. */
  presets: PromptPreset[]
  /** What each `{{variable}}` of a prompt is filled with. */
  variables: Record<string, string>
  /** Other models each task's run goes to as well, at most two: the batch. */
  extraModelsByTask: Partial<Record<Task, ModelRef[]>>
  /** Characters, objects and places kept under a name with their pictures, named in a prompt as "@name". */
  elements: PromptElement[]
  /** Each project's storyboard: its script and shots with the jobs of their frames and clips. */
  storyboards: Record<string, Storyboard>
  /** The picture model the storyboard's frames come from and the video model of its clips. */
  storyboardModels: { image?: ModelRef; video?: ModelRef }
  /** Each project's node canvas. */
  canvases: Record<string, CanvasGraph>
  /** The HTML graphics made into clips, newest first, with their code to change and make again. */
  motionClips: MotionClip[]
}

export interface MotionClip {
  mediaId: string
  name: string
  html: string
  seconds: number
}

export interface PromptPreset {
  name: string
  text: string
}

const DEFAULTS: Persisted = { task: 'image', modelByTask: {}, valuesByModel: {}, repeat: 1, placeOnTimeline: false, favorites: [], presets: [], variables: {}, extraModelsByTask: {}, elements: [], storyboards: {}, storyboardModels: {}, canvases: {}, motionClips: [] }

let saving: ReturnType<typeof setTimeout> | null = null

/** The choices go to the server a moment after the last change, once they were read from it. */
function save(state: GenerateState): void {
  if (!state.choicesRead) return
  if (saving) clearTimeout(saving)
  saving = setTimeout(() => {
    saving = null
    generateApi
      .saveChoices({ ...persisted(useGenerateStore.getState()) })
      .catch((error: unknown) => useGenerateStore.getState().setServerError(error instanceof Error ? error.message : String(error)))
  }, 400)
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
  /** The choices were read from the server; until then nothing is written back over them. */
  choicesRead: boolean
  readChoices: (choices: Partial<Persisted>) => void
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
  toggleFavorite: (key: string) => void
  savePreset: (name: string, text: string) => void
  removePreset: (name: string) => void
  saveElement: (element: PromptElement) => void
  setStoryboard: (projectId: string, storyboard: Storyboard) => void
  updateShot: (projectId: string, id: string, change: Partial<Shot>) => void
  setStoryboardModel: (kind: 'image' | 'video', model: ModelRef) => void
  setCanvas: (projectId: string, graph: CanvasGraph) => void
  keepMotion: (clip: MotionClip) => void
  removeElement: (name: string) => void
  setVariable: (name: string, value: string) => void
  setExtraModels: (task: Task, models: ModelRef[]) => void
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
    favorites: state.favorites,
    presets: state.presets,
    variables: state.variables,
    extraModelsByTask: state.extraModelsByTask,
    elements: state.elements,
    storyboards: state.storyboards,
    storyboardModels: state.storyboardModels,
    canvases: state.canvases,
    motionClips: state.motionClips,
  }
}

export const useGenerateStore = create<GenerateState>()((set, get) => ({
  ...DEFAULTS,
  choicesRead: false,
  readChoices: (choices) => set({ ...DEFAULTS, ...choices, choicesRead: true }),
  jobs: [],
  keys: {},
  forms: {},
  serverError: null,
  pendingUse: null,
  useAs: (pendingUse) => {
    set({ pendingUse })
    if (pendingUse) {
      set({ task: pendingUse.task })
      save(get())
    }
  },
  setServerError: (serverError) => set({ serverError }),
  setTask: (task) => {
    set({ task })
    save(get())
  },
  setModel: (task, model) => {
    set({ modelByTask: { ...get().modelByTask, [task]: model } })
    save(get())
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
    save(get())
  },
  replaceValues: (model, values) => {
    set({ valuesByModel: { ...get().valuesByModel, [modelKey(model.provider, model.id)]: values } })
    save(get())
  },
  toggleFavorite: (key) => {
    const favorites = get().favorites
    set({ favorites: favorites.includes(key) ? favorites.filter((each) => each !== key) : [...favorites, key] })
    save(get())
  },
  savePreset: (name, text) => {
    set({ presets: [...get().presets.filter((preset) => preset.name !== name), { name, text }] })
    save(get())
  },
  removePreset: (name) => {
    set({ presets: get().presets.filter((preset) => preset.name !== name) })
    save(get())
  },
  setStoryboard: (projectId, storyboard) => {
    set({ storyboards: { ...get().storyboards, [projectId]: storyboard } })
    save(get())
  },
  updateShot: (projectId, id, change) => {
    const board = get().storyboards[projectId]
    if (!board) return
    set({ storyboards: { ...get().storyboards, [projectId]: { ...board, shots: board.shots.map((shot) => (shot.id === id ? { ...shot, ...change } : shot)) } } })
    save(get())
  },
  keepMotion: (clip) => {
    set({ motionClips: [clip, ...get().motionClips.filter((each) => each.mediaId !== clip.mediaId)].slice(0, 20) })
    save(get())
  },
  setCanvas: (projectId, graph) => {
    set({ canvases: { ...get().canvases, [projectId]: graph } })
    save(get())
  },
  setStoryboardModel: (kind, model) => {
    set({ storyboardModels: { ...get().storyboardModels, [kind]: model } })
    save(get())
  },
  saveElement: (element) => {
    set({ elements: [...get().elements.filter((each) => each.name !== element.name), element] })
    save(get())
  },
  removeElement: (name) => {
    set({ elements: get().elements.filter((each) => each.name !== name) })
    save(get())
  },
  setExtraModels: (task, models) => {
    set({ extraModelsByTask: { ...get().extraModelsByTask, [task]: models.slice(0, 2) } })
    save(get())
  },
  setVariable: (name, value) => {
    set({ variables: { ...get().variables, [name]: value } })
    save(get())
  },
  setRepeat: (repeat) => {
    set({ repeat: Math.min(8, Math.max(1, Math.round(repeat))) })
    save(get())
  },
  setPlaceOnTimeline: (placeOnTimeline) => {
    set({ placeOnTimeline })
    save(get())
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
