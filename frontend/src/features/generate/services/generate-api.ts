/**
 * The VideoSOS server's generation routes: the model catalogue of OpenRouter,
 * fal and Runware, a model's form, the price before a run, jobs and keys.
 * Every failure carries the server's own message, which is shown as is.
 */

import type { TFunction } from 'i18next'
import { onServerEvent } from '@/infrastructure/desktop/server-events'

export type Provider = 'openrouter' | 'fal' | 'runware' | 'local'

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

export const PROVIDERS: Provider[] = ['openrouter', 'fal', 'runware', 'local']

/** The cloud providers, each with its key; `local` is this computer and needs none. */
export type KeyedProvider = Exclude<Provider, 'local'>
export const KEYED_PROVIDERS: KeyedProvider[] = ['openrouter', 'fal', 'runware']

export const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  fal: 'fal',
  runware: 'Runware',
  local: 'Local',
}

export interface LocalModelState {
  id: string
  name: string
  task: 'image' | 'video'
  installed: boolean
  /** What is left to download. */
  download_bytes: number
  size_bytes: number
}

/** Generation on this computer: engine builds, models, the device and a download running. */
export interface LocalStatus {
  supported: boolean
  device: 'auto' | 'cuda' | 'vulkan' | 'cpu'
  device_in_use: 'cuda' | 'vulkan' | 'cpu' | null
  recommended: 'cuda' | 'vulkan' | 'cpu'
  gpu: string
  engines: { device: 'cuda' | 'vulkan' | 'cpu'; installed: boolean; download_bytes: number }[]
  ffmpeg: boolean
  models: LocalModelState[]
  loaded: { model: string; device: string } | null
  install: {
    what: string
    current: string | null
    downloaded: number
    total: number
    error: string | null
    installing: boolean
  }
}

export interface ModelEntry {
  provider: Provider
  id: string
  name: string
  description: string
  tasks: Task[]
  created: number | null
  status: string
  /** The provider's own price line, shown as is. */
  price: string | null
  /** Rates VideoSOS worked out itself, worded by the window: `second`, `character`, `token_in` and `token_out`. */
  rates?: Rate[]
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
    | { type: 'text'; max_length?: number }
    | { type: 'textarea'; max_length?: number }
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
export type MediaRef =
  | { media: string }
  | { job: string; index: number }
  | { file: string }
  | string

/** What was spent on finished generations, in total and broken down. */
export interface Spend {
  total: number
  today: number
  providers: Array<{ provider: Provider; usd: number; jobs: number }>
  tasks: Array<{ task: Task | ''; usd: number; jobs: number }>
  models: Array<{
    provider: Provider
    model: string
    model_name: string
    usd: number
    jobs: number
  }>
}

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
  /** What its results are called: the prompt's first words, or the model. */
  title: string
  task: Task | ''
  values: Record<string, unknown>
  status: JobStatus
  progress: number | null
  error: string | null
  /** What kind of failure it was: `no_key`, `refused`, `busy`, `network`, `provider_failed`, `lost_contact`, ... */
  error_code: string | null
  estimate: number | null
  cost: number | null
  cost_source: 'provider' | 'estimate' | null
  outputs: OutputFile[]
  imported: string[]
  place: boolean
  /** Where on the timeline the results go, in seconds; null puts them at the playhead on arrival. */
  place_at: number | null
  origin: string
  created: number
  updated: number
}

export interface KeyState {
  provider: KeyedProvider
  set: boolean
  source: 'environment' | 'stored' | null
  variable: string
}

/** What the person allows agents: a daily spend and whether their timeline edits wait to be accepted. */
export interface AgentSettings {
  agent_daily_budget_usd: number | null
  agent_confirm_edits: boolean
  /** Who answers the window's assistant questions: a paid model of OpenRouter, or the agent connected over MCP. */
  assistant: '' | 'openrouter' | 'agent'
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
    place_at: number | null
  }) => request<{ jobs: Job[] }>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  jobs: (projectId: string | null) =>
    request<{ jobs: Job[] }>(`/api/jobs?${new URLSearchParams({ project: projectId ?? '' })}`),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancel: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  retry: (id: string) => request<{ jobs: Job[] }>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  remove: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  markImported: (id: string, mediaIds: string[]) =>
    request<Job>(`/api/jobs/${id}/imported`, {
      method: 'POST',
      body: JSON.stringify({ media_ids: mediaIds }),
    }),
  fileUrl: (id: string, index: number) => `/api/jobs/${id}/files/${index}`,
  keys: () => request<{ keys: KeyState[] }>('/api/keys'),
  /** What the panel was left at, kept by the server for every window. */
  choices: () => request<Record<string, unknown>>('/api/generate/choices'),
  saveChoices: (choices: Record<string, unknown>) =>
    request<null>('/api/generate/choices', { method: 'PUT', body: JSON.stringify(choices) }),
  storeKey: (provider: Provider, key: string | null) =>
    request<{ keys: KeyState[] }>(`/api/keys/${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ key }),
    }),
  localStatus: () => request<LocalStatus>('/api/local'),
  localInstall: (what: string) =>
    request<{ started: boolean; status: LocalStatus }>('/api/local/install', {
      method: 'POST',
      body: JSON.stringify({ what }),
    }),
  localRemove: (model: string) =>
    request<LocalStatus>(`/api/local/models/${encodeURIComponent(model)}`, { method: 'DELETE' }),
  localDevice: (device: LocalStatus['device']) =>
    request<LocalStatus>('/api/local/device', { method: 'PUT', body: JSON.stringify({ device }) }),
  localUnload: () =>
    request<{ freed: boolean; status: LocalStatus }>('/api/local/unload', { method: 'POST' }),
  checkKey: (provider: Provider) =>
    request<KeyCheck>(`/api/keys/${provider}/check`, {
      method: 'POST',
    }),
  spend: (projectId: string | null) =>
    request<Spend>(`/api/spend?${new URLSearchParams({ project: projectId ?? '' })}`),
  settings: () => request<AgentSettings>('/api/settings'),
  /** Whether an agent is connected to the MCP server: it called within ten minutes. */
  agentStatus: () =>
    request<{
      agent_connected: boolean
      agent_last_call: string | null
      agent_seconds_ago: number | null
    }>('/api/agent/status'),
  /** A question of the window's assistant put to the connected agent; answers with what it wrote. */
  askAgent: (question: {
    target: string
    instructions: string
    request: string
    images: MediaRef[]
    project_id: string | null
  }) =>
    request<{ answer: string }>('/api/assistant/ask', {
      method: 'POST',
      body: JSON.stringify(question),
    }),
  /** Only the settings given change; the others stay as kept. */
  storeSettings: (settings: Partial<AgentSettings>) =>
    request<AgentSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
}

export type ServerEvent =
  | { kind: 'hello' | 'resync' | 'catalog' }
  | { kind: 'job'; data: Job }
  | { kind: 'job_removed'; data: { id: string } }
  | { kind: 'keys' | 'settings' | 'local'; data: unknown }
  | { kind: 'changed'; data: { what: string } }

/** The server's events as the generation panel reads them. */
export function onGenerateEvent(listener: (event: ServerEvent) => void): () => void {
  return onServerEvent((event) => listener(event as ServerEvent))
}

/** A model's price line in the window's language: its own rates when VideoSOS worked them out, else the provider's words. */
export function priceLine(t: TFunction, entry: Pick<ModelEntry, 'price' | 'rates'>): string | null {
  const rate = (unit: string) => entry.rates?.find((each) => each.unit === unit)
  const second = rate('second')
  if (second)
    return (
      t('generate.rate.second', { price: formatUsd(second.amount) }) +
      (second.label ? ` · ${second.label}` : '')
    )
  const character = rate('character')
  if (character) return t('generate.rate.characters', { price: formatUsd(character.amount * 1000) })
  const input = rate('token_in')
  const output = rate('token_out')
  if (input && output)
    return t('generate.rate.tokens', {
      input: formatUsd(input.amount * 1e6),
      output: formatUsd(output.amount * 1e6),
    })
  return entry.price
}

/** A key checked with the provider: the account's balance when the provider tells it, what the key has spent. */
export interface KeyCheck {
  ok: boolean
  balance?: number | null
  spent?: number | null
  /** fal tells the balance only to an admin key. */
  balance_admin_only?: boolean
  error?: string
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0'
  if (amount >= 1) return `$${amount.toFixed(2)}`
  const digits = Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(amount))))
  return `$${amount.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`
}
