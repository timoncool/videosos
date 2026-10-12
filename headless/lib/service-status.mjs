import crypto from 'node:crypto'

const publicError = (error) => ({
  code: error?.code ?? 'INTERNAL_ERROR',
})

function normalizeProgress(value) {
  if (!value || typeof value !== 'object') return null
  const progress = Number(value.progress)
  const currentFrame = Number(value.currentFrame)
  const totalFrames = Number(value.totalFrames)
  return {
    ...(typeof value.phase === 'string' ? { phase: value.phase } : {}),
    ...(Number.isFinite(progress) ? { progress: Math.max(0, Math.min(100, progress)) } : {}),
    ...(Number.isInteger(currentFrame) && currentFrame >= 0 ? { currentFrame } : {}),
    ...(Number.isInteger(totalFrames) && totalFrames >= 0 ? { totalFrames } : {}),
  }
}

/** Process-local observability for the synchronous service API. */
export class ServiceStatus {
  #activeOperations = new Map()
  #lastOperation = null
  #state = 'starting'

  constructor({ now = () => Date.now(), instanceId = crypto.randomUUID() } = {}) {
    this.now = now
    this.instanceId = instanceId
    this.startedAt = now()
  }

  ready() {
    this.#state = 'ready'
  }

  draining() {
    this.#state = 'draining'
  }

  stopped() {
    this.#state = 'stopped'
  }

  reportProgress(progress) {
    const active = [...this.#activeOperations.values()].findLast(
      (operation) => operation.kind === 'render',
    )
    if (!active) return
    active.progress = normalizeProgress(progress)
    active.updatedAt = this.now()
  }

  async track(kind, operation) {
    const active = {
      id: crypto.randomUUID(),
      kind,
      state: 'running',
      startedAt: this.now(),
      updatedAt: this.now(),
      progress: null,
    }
    this.#activeOperations.set(active.id, active)
    try {
      const result = await operation()
      this.#lastOperation = {
        ...active,
        state: 'succeeded',
        finishedAt: this.now(),
        updatedAt: this.now(),
      }
      return result
    } catch (error) {
      this.#lastOperation = {
        ...active,
        state: 'failed',
        error: publicError(error),
        finishedAt: this.now(),
        updatedAt: this.now(),
      }
      throw error
    } finally {
      this.#activeOperations.delete(active.id)
    }
  }

  snapshot(queue) {
    const now = this.now()
    const activeOperations = [...this.#activeOperations.values()].map((operation) =>
      structuredClone(operation),
    )
    return {
      instanceId: this.instanceId,
      state: this.#state,
      startedAt: this.startedAt,
      uptimeMs: Math.max(0, now - this.startedAt),
      queue,
      activeOperation: activeOperations.at(-1) ?? null,
      activeOperations,
      lastOperation: this.#lastOperation ? structuredClone(this.#lastOperation) : null,
    }
  }
}
