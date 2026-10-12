export class OperationQueueError extends Error {
  constructor(code, message, statusCode, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'OperationQueueError'
    this.code = code
    this.statusCode = statusCode
  }
}

const timeoutError = (kind, timeoutMs) =>
  new OperationQueueError(
    'OPERATION_TIMEOUT',
    `${kind} operation exceeded its ${timeoutMs}ms deadline`,
    504,
  )

function withDeadline(promise, timeoutMs, kind) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(kind, timeoutMs)), timeoutMs)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** A bounded, serial operation queue whose failed jobs recover before the next job starts. */
export class OperationQueue {
  #accepting = true
  #active = 0
  #waiting = 0
  #tail = Promise.resolve()
  #capacityWaiters = new Set()

  constructor({ maxQueueDepth, recover }) {
    if (!Number.isInteger(maxQueueDepth) || maxQueueDepth < 0) {
      throw new TypeError('maxQueueDepth must be a non-negative integer')
    }
    this.maxQueueDepth = maxQueueDepth
    this.recover = recover
  }

  get accepting() {
    return this.#accepting
  }

  get status() {
    return {
      accepting: this.#accepting,
      active: this.#active,
      waiting: this.#waiting,
      maxQueueDepth: this.maxQueueDepth,
    }
  }

  async waitForCapacity() {
    if (!this.#accepting) {
      throw new OperationQueueError('SERVICE_SHUTTING_DOWN', 'Service is shutting down', 503)
    }
    if (this.#active + this.#waiting < this.maxQueueDepth + 1) return
    await new Promise((resolve) => this.#capacityWaiters.add(resolve))
    if (!this.#accepting) {
      throw new OperationQueueError('SERVICE_SHUTTING_DOWN', 'Service is shutting down', 503)
    }
  }

  #notifyCapacity() {
    if (this.#accepting && this.#active + this.#waiting >= this.maxQueueDepth + 1) return
    const waiters = [...this.#capacityWaiters]
    this.#capacityWaiters.clear()
    waiters.forEach((resolve) => resolve())
  }

  enqueue(run, { timeoutMs, kind = 'browser' }) {
    if (!this.#accepting) {
      throw new OperationQueueError('SERVICE_SHUTTING_DOWN', 'Service is shutting down', 503)
    }
    if (this.#active + this.#waiting >= this.maxQueueDepth + 1) {
      throw new OperationQueueError('QUEUE_FULL', 'Browser operation queue is full', 429)
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive integer')
    }

    this.#waiting++
    const execute = async () => {
      this.#waiting--
      this.#active++
      try {
        const pending = Promise.resolve().then(run)
        // A timed-out page call keeps settling after the race. Always observe it.
        pending.catch(() => {})
        return await withDeadline(pending, timeoutMs, kind)
      } catch (error) {
        let recoveryError
        try {
          await this.recover?.(error)
        } catch (recoveryFailure) {
          recoveryError = recoveryFailure
        }
        if (recoveryError) {
          throw new OperationQueueError(
            'SESSION_RECOVERY_FAILED',
            'Browser session recovery failed',
            503,
            recoveryError,
          )
        }
        if (error instanceof OperationQueueError) throw error
        throw new OperationQueueError(
          'BROWSER_OPERATION_FAILED',
          `${kind} operation failed`,
          500,
          error,
        )
      } finally {
        this.#active--
        this.#notifyCapacity()
      }
    }

    const result = this.#tail.then(execute, execute)
    this.#tail = result.then(
      () => {},
      () => {},
    )
    return result
  }

  async shutdown(timeoutMs) {
    this.#accepting = false
    this.#notifyCapacity()
    await withDeadline(this.#tail, timeoutMs, 'shutdown').catch((error) => {
      if (error instanceof OperationQueueError && error.code === 'OPERATION_TIMEOUT') {
        throw new OperationQueueError(
          'SHUTDOWN_TIMEOUT',
          `Queue did not drain within ${timeoutMs}ms`,
          503,
          error,
        )
      }
      throw error
    })
  }
}
