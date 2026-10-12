// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'

import {
  formatRouteErrorDetails,
  getProjectNotFoundError,
  getStorageFailureName,
  ProjectNotFoundError,
} from './route-error-cause'

describe('ProjectNotFoundError', () => {
  it('keeps stale editor links distinct from unrelated route failures', () => {
    const missingProject = new ProjectNotFoundError('project-123')

    expect(getProjectNotFoundError(missingProject)).toBe(missingProject)
    expect(missingProject.projectId).toBe('project-123')
    expect(missingProject.message).toBe('Project not found: project-123')
    expect(getProjectNotFoundError(new Error('Project not found: project-123'))).toBeNull()
  })
})

describe('getStorageFailureName', () => {
  // The whole point of attaching `cause` in workspace-fs: the DOMException name
  // is the diagnosis, and it reaches the screen only through this unwrapping.
  it('unwraps the DOMException name from a re-thrown Error cause', () => {
    const underlying = new DOMException('nope', 'NotSupportedError')
    const wrapped = new Error('Failed to load projects from workspace', { cause: underlying })

    expect(getStorageFailureName(wrapped)).toBe('NotSupportedError')
  })

  it('reads a DOMException thrown directly, without a wrapper', () => {
    expect(getStorageFailureName(new DOMException('denied', 'NotAllowedError'))).toBe(
      'NotAllowedError',
    )
  })

  // A plain cause must not be mistaken for a storage fault — that would offer
  // the user a "choose a different folder" button for an unrelated failure.
  it('returns null for an Error whose cause is not a DOMException', () => {
    expect(getStorageFailureName(new Error('boom', { cause: new Error('inner') }))).toBeNull()
    expect(getStorageFailureName(new Error('boom', { cause: 'NotAllowedError' }))).toBeNull()
  })

  it('returns null for an error with no cause, and for non-errors', () => {
    expect(getStorageFailureName(new Error('boom'))).toBeNull()
    expect(getStorageFailureName('NotAllowedError')).toBeNull()
    expect(getStorageFailureName(null)).toBeNull()
  })
})

describe('formatRouteErrorDetails', () => {
  it('includes the page and exact error message for a developer report', () => {
    const error = new ProjectNotFoundError('project-123')
    error.stack = 'ProjectNotFoundError: Project not found: project-123\n    at loader'

    expect(formatRouteErrorDetails(error, 'https://freecut.example/editor/project-123')).toBe(
      [
        'Page: https://freecut.example/editor/project-123',
        'Error: ProjectNotFoundError: Project not found: project-123',
        '',
        'Stack:',
        'ProjectNotFoundError: Project not found: project-123',
        '    at loader',
      ].join('\n'),
    )
  })
})
