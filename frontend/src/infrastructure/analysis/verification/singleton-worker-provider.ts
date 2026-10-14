import type { SceneVerificationProvider } from './types'

const IDLE_DISPOSE_MS = 60_000

interface CreateSingletonSceneVerificationProviderOptions<TId extends string> {
  id: TId
  label: string
  createWorker: () => Worker
}

export function createSingletonSceneVerificationProvider<TId extends string>({
  id,
  label,
  createWorker,
}: CreateSingletonSceneVerificationProviderOptions<TId>): SceneVerificationProvider & { id: TId } {
  let worker: Worker | null = null
  let idle: ReturnType<typeof setTimeout> | null = null

  const cancelIdle = () => {
    if (idle) clearTimeout(idle)
    idle = null
  }

  const resetWorker = () => {
    cancelIdle()
    if (!worker) return
    worker.terminate()
    worker = null
  }

  return {
    id,
    label,
    getWorker() {
      cancelIdle()
      if (!worker) {
        worker = createWorker()
      }
      return worker
    },
    resetWorker,
    // the model stays loaded for a while, so the next caption or cut check does not build it again
    disposeWorker() {
      if (!worker) return
      cancelIdle()
      idle = setTimeout(() => {
        idle = null
        if (!worker) return
        worker.postMessage({ type: 'dispose' })
        const currentWorker = worker
        worker = null
        setTimeout(() => currentWorker.terminate(), 500)
      }, IDLE_DISPOSE_MS)
    },
  }
}
