/**
 * Cause extraction for the router error screen.
 *
 * Lives apart from `route-error.tsx` so that file only exports components
 * (Fast Refresh requires it), and so the branching below — the only real logic
 * on that screen — is testable without rendering.
 */

/**
 * An editor URL can outlive the project it points to. Keep that expected
 * recovery case distinct from an application fault so the router can offer a
 * useful way back to the project library.
 */
export class ProjectNotFoundError extends Error {
  readonly projectId: string

  constructor(projectId: string) {
    super(`Project not found: ${projectId}`)
    this.name = 'ProjectNotFoundError'
    this.projectId = projectId
  }
}

export function getProjectNotFoundError(error: unknown): ProjectNotFoundError | null {
  return error instanceof ProjectNotFoundError ? error : null
}

/**
 * The DOMException name behind a route error, or null when there isn't one.
 *
 * Storage failures are re-thrown as a plain `Error` carrying the original
 * DOMException as `cause` (see `workspace-fs/projects.ts`), and the `name` —
 * NotAllowedError vs NotSupportedError vs NotFoundError — is the entire
 * diagnosis. A DOMException thrown directly is also accepted, so this keeps
 * working for callers that don't re-wrap.
 */
export function getStorageFailureName(error: unknown): string | null {
  if (error instanceof DOMException) return error.name
  if (error instanceof Error && error.cause instanceof DOMException) {
    return error.cause.name
  }
  return null
}

/** Diagnostic text intended for a bug report, not for the primary UI. */
export function formatRouteErrorDetails(error: unknown, pageUrl: string): string {
  if (!(error instanceof Error)) {
    return [`Page: ${pageUrl}`, `Error: ${String(error)}`].join('\n')
  }

  const lines = [`Page: ${pageUrl}`, `Error: ${error.name}: ${error.message}`]
  if (error.stack) lines.push('', 'Stack:', error.stack)
  return lines.join('\n')
}
