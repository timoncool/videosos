/**
 * The server's routes for videos by their links (yt-dlp): the tool, a link's probe and the downloads. A refusal
 * carries a code the window words in its language, the server's detail and a hint, as Dub Studio's do.
 */

export type UrlQuality = 'best' | '1080' | '720' | '480' | 'audio'

export interface UrlTool {
  supported: boolean
  ready: boolean
  missing: string[]
  download_bytes: number
  ffmpeg_from_path: boolean
  install: { installing: boolean; current: string | null; downloaded: number; total: number; error: string | null }
  ytdlp: {
    version: string
    pinned_version: string
    updated: boolean
    latest: string | null
    checked_at: number
    update_available: boolean
    updating: boolean
    last_error: string | null
    last_error_code: string | null
  }
}

export interface UrlProbe {
  url: string
  title: string
  duration: number | null
  thumbnail_data: string | null
  uploader: string | null
  extractor: string | null
  max_height: number | null
  has_video: boolean
  has_audio: boolean
  qualities: UrlQuality[]
  expected_bytes: number | null
}

export interface UrlFetch {
  id: string
  url: string
  quality: UrlQuality
  cookies: boolean
  project_id: string
  status: 'downloading' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  phase: 'probe' | 'download' | 'merge' | 'extract' | 'done'
  title: string | null
  duration: number | null
  downloaded: number
  total: number | null
  speed_bps: number
  eta_s: number | null
  file: string | null
  mime: string | null
  imported: string[]
  error_code: string | null
  error: string | null
  hint: string | null
}

/** A refusal of the link routes: its code, the server's detail and what to do. */
export class UrlError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail || code)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    cache: 'no-store',
  })
  if (response.status === 204) return null as T
  const text = await response.text()
  if (!response.ok) {
    const json = response.headers.get('content-type')?.includes('application/json')
    const body = json ? (JSON.parse(text) as { error?: string; detail?: string }) : {}
    throw new UrlError(body.error ?? `http_${response.status}`, body.detail ?? text)
  }
  return JSON.parse(text) as T
}

const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const urlApi = {
  tool: () => call<UrlTool>('/api/url/tool'),
  install: () => post<{ started: boolean; status: UrlTool }>('/api/url/tool/install'),
  update: () => post<{ started: boolean; status: UrlTool }>('/api/url/tool/update'),
  probe: (url: string, cookiesText: string | null) => post<UrlProbe>('/api/url/probe', { url, cookies_text: cookiesText }),
  start: (body: { url: string; quality: UrlQuality; project_id: string; cookies_text: string | null }) => post<UrlFetch>('/api/url/fetches', body),
  list: () => call<{ fetches: UrlFetch[] }>('/api/url/fetches'),
  cancel: (id: string) => post<UrlFetch>(`/api/url/fetches/${encodeURIComponent(id)}/cancel`),
  resume: (id: string) => post<UrlFetch>(`/api/url/fetches/${encodeURIComponent(id)}/resume`),
  forget: (id: string) => call<null>(`/api/url/fetches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  imported: (id: string, media: string[]) => post<UrlFetch>(`/api/url/fetches/${encodeURIComponent(id)}/imported`, { media }),
  fileUrl: (id: string) => `/api/url/fetches/${encodeURIComponent(id)}/file`,
}
