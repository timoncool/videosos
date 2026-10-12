const LAST_EDITOR_PROJECT_ID_KEY = 'freecut-last-editor-project-id'

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getEditorProjectIdFromPathname(pathname: string): string | undefined {
  const projectId = pathname.match(/^\/editor\/([^/]+)/)?.[1]
  return projectId ? safeDecodeURIComponent(projectId) : undefined
}

export function rememberLastEditorProjectId(projectId: string): void {
  try {
    window.localStorage.setItem(LAST_EDITOR_PROJECT_ID_KEY, projectId)
  } catch {
    // Ignore restricted-storage failures so bootstrap/reload flows do not crash.
  }
}

function getLastEditorProjectId(): string | undefined {
  try {
    return window.localStorage.getItem(LAST_EDITOR_PROJECT_ID_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function getEditorProjectReloadPathWithCacheBust(): string {
  const nextUrl = new URL(window.location.href)
  const currentProjectId = getEditorProjectIdFromPathname(nextUrl.pathname)
  const projectId = currentProjectId ?? getLastEditorProjectId()

  if (projectId && !currentProjectId && (nextUrl.pathname === '/' || nextUrl.pathname === '')) {
    nextUrl.pathname = `/editor/${encodeURIComponent(projectId)}`
  }

  nextUrl.searchParams.set('__freecut_updated', Date.now().toString())
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
}
