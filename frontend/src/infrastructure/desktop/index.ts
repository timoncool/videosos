/**
 * The desktop program around this window: when the page is served by the VideoSOS server, files the
 * editor makes are written to disk by the server (the system "Save as" dialog) instead of the browser's
 * downloads, and can be shown in the file manager.
 */

let desktop: Promise<boolean> | null = null

/** Whether this page runs inside VideoSOS. Asked once per page. */
export function isDesktop(): Promise<boolean> {
  desktop ??= fetch('/api/info', { cache: 'no-store' })
    .then(async (response) => response.ok && ((await response.json()) as { app?: string }).app === 'videosos')
    .catch(() => false)
  return desktop
}

export interface SavedFile {
  path: string | null
  cancelled: boolean
}

/** A save as the files panel shows it; `cancelled` means the person closed the "Save as" dialog. */
export interface SavingFile {
  id: string
  name: string
  state: 'saving' | 'done' | 'error' | 'cancelled'
  path?: string
  size?: number
  error?: string
}

const SAVING_EVENT = 'videosos:saving'

/** Every change to a save made in this window. */
export function onSaving(listener: (file: SavingFile) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<SavingFile>).detail)
  window.addEventListener(SAVING_EVENT, handler)
  return () => window.removeEventListener(SAVING_EVENT, handler)
}

function tell(file: SavingFile): void {
  window.dispatchEvent(new CustomEvent<SavingFile>(SAVING_EVENT, { detail: file }))
}

let saves = 0

/** Writes the file where the person chooses (`dialog`), beside another saved file, or into the exports folder. */
export async function saveToDisk(
  blob: Blob,
  name: string,
  options: { dialog?: boolean; beside?: string } = {},
): Promise<SavedFile> {
  const id = `${Date.now()}-${++saves}`
  tell({ id, name, state: 'saving', size: blob.size })
  try {
    const query = new URLSearchParams({ name, dialog: String(options.dialog ?? true) })
    if (options.beside) query.set('beside', options.beside)
    const response = await fetch(`/api/exports?${query}`, { method: 'PUT', body: blob })
    const body = (await response.json()) as { path?: string; cancelled?: boolean; error?: string }
    if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
    const saved = { path: body.path ?? null, cancelled: body.cancelled === true }
    tell(saved.cancelled || !saved.path
      ? { id, name, state: 'cancelled' }
      : { id, name: saved.path.split(/[\\/]/).pop() ?? name, state: 'done', path: saved.path, size: blob.size })
    return saved
  } catch (problem) {
    tell({ id, name, state: 'error', error: problem instanceof Error ? problem.message : String(problem) })
    throw problem
  }
}

/** Shows a saved file in the file manager. */
export async function revealOnDisk(path: string): Promise<void> {
  const response = await fetch('/api/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  }
}
