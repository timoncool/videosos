import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getEditorProjectIdFromPathname,
  getEditorProjectReloadPathWithCacheBust,
  rememberLastEditorProjectId,
} from './last-editor-project'

describe('last editor project routing', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('reads the project id from an editor pathname', () => {
    expect(getEditorProjectIdFromPathname('/editor/project-123')).toBe('project-123')
    expect(getEditorProjectIdFromPathname('/projects')).toBeUndefined()
  })

  it('keeps an active editor URL when cache-busting an update reload', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123)
    window.history.replaceState({}, '', '/editor/project-123?view=timeline#clip')

    expect(getEditorProjectReloadPathWithCacheBust()).toBe(
      '/editor/project-123?view=timeline&__freecut_updated=123#clip',
    )
  })

  it('routes back to the last editor project when the update reload starts from the root page', () => {
    vi.spyOn(Date, 'now').mockReturnValue(456)
    rememberLastEditorProjectId('project-123')
    window.history.replaceState({}, '', '/?__freecut_updated=1780200314697')

    expect(getEditorProjectReloadPathWithCacheBust()).toBe(
      '/editor/project-123?__freecut_updated=456',
    )
  })

  it('does not route non-root update reloads to the last editor project', () => {
    vi.spyOn(Date, 'now').mockReturnValue(456)
    rememberLastEditorProjectId('project-123')
    window.history.replaceState({}, '', '/projects?__freecut_updated=1780200314697')

    expect(getEditorProjectReloadPathWithCacheBust()).toBe('/projects?__freecut_updated=456')
  })
})
