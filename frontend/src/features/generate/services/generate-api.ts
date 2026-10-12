/**
 * The VideoSOS server's generation routes: the model catalogue of OpenRouter,
 * fal and Runware, a model's form, the price before a run, jobs and keys.
 * Every failure carries the server's own message, which is shown as is.
 */

export type Provider = 'openrouter' | 'fal' | 'runware'

export type Task =
  | 'image'
  | 'image_edit'
  | 'video'
  | 'video_edit'
  | 'lip_sync'
  | 'upscale'
  | 'remove_background'
  | 'music'
  | 'speech'
  | 'sound'
  | 'transcribe'
  | 'text'

export const TASKS: Task[] = [
  'image',
  'image_edit',
  'video',
  'video_edit',
  'lip_sync',
  'upscale',
  'remove_background',
  'music',
  'speech',
  'sound',
  'transcribe',
  'text',
]

export const PROVIDERS: Provider[] = ['openrouter', 'fal', 'runware']

export const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  fal: 'fal',
  runware: 'Runware',
}

export interface ModelEntry {
  provider: Provider
  id: string
  name: string
  description: string
  tasks: Task[]
  created: number | null
  status: string
  price: string | null
  thumbnail: string | null
}

export type MediaKind = 'image' | 'video' | 'audio'

export type Role =
  | 'prompt'
  | 'negative_prompt'
  | 'duration'
  | 'resolution'
  | 'aspect'
  | 'size'
  | 'count'
  | 'seed'
  | 'voice'
  | 'first_frame'
  | 'last_frame'
  | 'reference'
  | 'source'
  | 'mask'
  | 'audio'

export interface Choice {
  value: unknown
  label: string
}

interface FieldBase {
  key: string
  label: string
  description?: string
  required: boolean
  default?: unknown
  advanced: boolean
  role?: Role
}

export type Field = FieldBase &
  (
    | { type: 'text' }
    | { type: 'textarea' }
    | { type: 'integer'; min: number | null; max: number | null }
    | { type: 'number'; min: number | null; max: number | null }
    | { type: 'boolean' }
    | { type: 'select'; options: Choice[] }
    | { type: 'media'; media: MediaKind; min: number; max: number; list: boolean }
    | { type: 'size'; options: Choice[]; width_key: string; height_key: string }
  )

export interface Rate {
  amount: number
  unit: string
  label: string | null
}

export interface ModelForm {
  provider: Provider
  id: string
  fields: Field[]
  price: { rates: Rate[]; note: string | null }
  delivery: 'sync' | 'async'
}

export interface ProviderStatus {
  models: number
  updated: number | null
  refreshing: boolean
  error: string | null
}

export interface CatalogAnswer {
  models: ModelEntry[]
  providers: Record<Provider, ProviderStatus>
  keys: Record<Provider, boolean>
}

/** A file named in a job's request. */
export type MediaRef = { media: string } | { job: string; index: number } | { file: string } | string

export interface OutputFile {
  index: number
  kind: 'image' | 'video' | 'audio' | 'text' | 'file'
  file: string
  mime: string
  size: number
  text?: string
}

export type JobStatus = 'queued' | 'sending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: string
  project_id: string | null
  provider: Provider
  model: string
  model_name: string
  task: Task | ''
  values: Record<string, unknown>
  status: JobStatus
  progress: number | null
  error: string | null
  estimate: number | null
  cost: number | null
  cost_source: 'provider' | 'estimate' | null
  outputs: OutputFile[]
  imported: string[]
  place: boolean
  origin: string
  created: number
  updated: number
}

export interface KeyState {
  provider: Provider
  set: boolean
  source: 'environment' | 'stored' | null
  variable: string
}

export interface Estimate {
  estimate: { usd: number; exact: boolean } | null
  note: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    cache: 'no-store',
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : typeof body === 'string' && body
          ? body
          : `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return body as T
}

export const generateApi = {
  catalog: (params: { task?: Task; provider?: Provider; q?: string }) => {
    const query = new URLSearchParams()
    if (params.task) query.set('task', params.task)
    if (params.provider) query.set('provider', params.provider)
    if (params.q) query.set('q', params.q)
    return request<CatalogAnswer>(`/api/catalog?${query}`)
  },
  refreshCatalog: (provider?: Provider) =>
    request<void>('/api/catalog/refresh', { method: 'POST', body: JSON.stringify({ provider }) }),
  form: (provider: Provider, id: string) =>
    request<{ form: ModelForm; entry: ModelEntry | null }>(
      `/api/catalog/form?${new URLSearchParams({ provider, id })}`,
    ),
  estimate: (provider: Provider, id: string, values: Record<string, unknown>, repeat: number) =>
    request<Estimate>('/api/catalog/estimate', {
      method: 'POST',
      body: JSON.stringify({ provider, id, values, repeat }),
    }),
  createJobs: (body: {
    provider: Provider
    model: string
    task: Task
    values: Record<string, unknown>
    project_id: string | null
    repeat: number
    place: boolean
  }) => request<{ jobs: Job[] }>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  jobs: (projectId: string | null) =>
    request<{ jobs: Job[] }>(`/api/jobs?${new URLSearchParams({ project: projectId ?? '' })}`),
  cancel: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  retry: (id: string) => request<{ jobs: Job[] }>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  remove: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  markImported: (id: string, mediaIds: string[]) =>
    request<Job>(`/api/jobs/${id}/imported`, { method: 'POST', body: JSON.stringify({ media_ids: mediaIds }) }),
  fileUrl: (id: string, index: number) => `/api/jobs/${id}/files/${index}`,
  keys: () => request<{ keys: KeyState[] }>('/api/keys'),
  storeKey: (provider: Provider, key: string | null) =>
    request<{ keys: KeyState[] }>(`/api/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ key }) }),
  checkKey: (provider: Provider) =>
    request<{ ok: boolean; balance?: number | null; error?: string }>(`/api/keys/${provider}/check`, {
      method: 'POST',
    }),
  spend: (projectId: string | null) =>
    request<{ total: number; today: number; providers: Array<{ provider: Provider; usd: number; jobs: number }> }>(
      `/api/spend?${new URLSearchParams({ project: projectId ?? '' })}`,
    ),
  settings: () => request<{ agent_daily_budget_usd: number | null }>('/api/settings'),
  storeSettings: (settings: { agent_daily_budget_usd: number | null }) =>
    request<{ agent_daily_budget_usd: number | null }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
}

export type ServerEvent =
  | { kind: 'hello' | 'resync' | 'catalog' }
  | { kind: 'job'; data: Job }
  | { kind: 'job_removed'; data: { id: string } }
  | { kind: 'keys' | 'settings'; data: unknown }
  | { kind: 'changed'; data: { what: string } }

type Listener = (event: ServerEvent) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null

/** One stream of server events per page, shared by every subscriber. */
export function onServerEvent(listener: Listener): () => void {
  listeners.add(listener)
  if (!source) {
    source = new EventSource('/api/events')
    source.onmessage = (message) => {
      let event: ServerEvent
      try {
        event = JSON.parse(message.data) as ServerEvent
      } catch {
        return
      }
      for (const each of listeners) each(event)
    }
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && source) {
      source.close()
      source = null
    }
  }
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount >= 1) return `$${amount.toFixed(2)}`
  const digits = Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(amount))))
  return `$${amount.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`
}
