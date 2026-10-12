import type { TranscriptionEngine } from '../types'

// Transcription model load + compile is the dominant per-job cost: Parakeet's 1.24 GB
// encoder takes ~20s to compile on WebGPU, and even Whisper re-downloads/re-instantiates
// its pipeline if the worker is recreated each job. Keeping one worker per engine resident
// lets the worker reuse its already-compiled sessions across jobs (each worker early-returns
// on re-init when the model is unchanged). Workers are evicted after a period of inactivity
// so they don't hold model memory forever.

const IDLE_EVICT_MS = 120_000

const workerFactories: Record<TranscriptionEngine, () => Worker> = {
  whisper: () =>
    new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' }),
  parakeet: () =>
    new Worker(new URL('../workers/parakeet.worker.ts', import.meta.url), { type: 'module' }),
}

const workers: Partial<Record<TranscriptionEngine, Worker>> = {}
const idleTimers: Partial<Record<TranscriptionEngine, ReturnType<typeof setTimeout>>> = {}

function clearIdleTimer(engine: TranscriptionEngine): void {
  const timer = idleTimers[engine]
  if (timer !== undefined) {
    clearTimeout(timer)
    delete idleTimers[engine]
  }
}

/** Get the shared worker for an engine, creating it and cancelling any pending eviction. */
export function acquireTranscriptionWorker(engine: TranscriptionEngine): Worker {
  clearIdleTimer(engine)
  let worker = workers[engine]
  if (!worker) {
    worker = workerFactories[engine]()
    workers[engine] = worker
  }
  return worker
}

/** Mark an engine's worker idle: keep it warm briefly, then evict to free model memory. */
export function releaseTranscriptionWorker(engine: TranscriptionEngine): void {
  if (!workers[engine]) return
  clearIdleTimer(engine)
  idleTimers[engine] = setTimeout(() => disposeTranscriptionWorker(engine), IDLE_EVICT_MS)
}

/** Tear an engine's worker down immediately (errors, cancellation, explicit unload). */
export function disposeTranscriptionWorker(engine: TranscriptionEngine): void {
  clearIdleTimer(engine)
  workers[engine]?.terminate()
  delete workers[engine]
}
