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

/** Writes the file where the person chooses (`dialog`), beside another saved file, or into the exports folder. */
export async function saveToDisk(
  blob: Blob,
  name: string,
  options: { dialog?: boolean; beside?: string } = {},
): Promise<SavedFile> {
  const query = new URLSearchParams({ name, dialog: String(options.dialog ?? true) })
  if (options.beside) query.set('beside', options.beside)
  const response = await fetch(`/api/exports?${query}`, { method: 'PUT', body: blob })
  const body = (await response.json()) as { path?: string; cancelled?: boolean; error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return { path: body.path ?? null, cancelled: body.cancelled === true }
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
