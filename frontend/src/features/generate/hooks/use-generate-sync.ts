import { useEffect } from 'react'
import { generateApi, onGenerateEvent, type Provider } from '../services/generate-api'
import { importFinished } from '../services/result-importer'
import { useGenerateStore, type Persisted } from '../stores/generate-store'
import { emitUiSound } from '@/shared/ui/ui-sound'

function report(error: unknown): void {
  useGenerateStore.getState().setServerError(error instanceof Error ? error.message : String(error))
}

async function loadKeys(): Promise<void> {
  const { keys } = await generateApi.keys()
  const set: Partial<Record<Provider, boolean>> = {}
  for (const key of keys) set[key.provider] = key.set
  useGenerateStore.getState().setKeys(set)
}

const LEGACY_KEY = 'videosos-generate'

/**
 * Reads what the panel was left at. VideoSOS 2.0.0 kept it in the window's storage: found there while the
 * server has nothing, it moves to the server once and leaves the window.
 */
export function useGenerateChoices(): void {
  useEffect(() => {
    void (async () => {
      const kept = await generateApi.choices()
      const legacy = Object.keys(kept).length === 0 ? localStorage.getItem(LEGACY_KEY) : null
      if (legacy) {
        const moved = JSON.parse(legacy) as Partial<Persisted>
        useGenerateStore.getState().readChoices(moved)
        await generateApi.saveChoices({ ...moved })
        localStorage.removeItem(LEGACY_KEY)
        return
      }
      useGenerateStore.getState().readChoices(kept as Partial<Persisted>)
    })().catch(report)
  }, [])
}

/**
 * Keeps the panel in step with the server for the open project: its jobs, the
 * keys, and every change the server announces (a job moved, a key was set).
 * Finished results are imported as they arrive.
 */
export function useGenerateSync(projectId: string | null): void {
  useEffect(() => {
    let cancelled = false
    const store = useGenerateStore.getState()
    store.setJobs([])
    void generateApi
      .jobs(projectId)
      .then(({ jobs }) => {
        if (cancelled) return
        useGenerateStore.getState().setServerError(null)
        useGenerateStore.getState().setJobs(jobs.filter((job) => job.project_id === projectId))
        importFinished(jobs)
      })
      .catch(report)
    void loadKeys().catch(report)
    const unsubscribe = onGenerateEvent((event) => {
      if (event.kind === 'job') {
        if (event.data.project_id === projectId) {
          // a generation that ends while the window follows it sounds, as a finished job does in Dub Studio
          const before = useGenerateStore
            .getState()
            .jobs.find((job) => job.id === event.data.id)?.status
          if (before && before !== event.data.status) {
            if (event.data.status === 'done') emitUiSound('confirm')
            if (event.data.status === 'failed') emitUiSound('error')
          }
          useGenerateStore.getState().upsertJob(event.data)
          importFinished([event.data])
        }
      } else if (event.kind === 'job_removed') {
        useGenerateStore.getState().removeJob(event.data.id)
      } else if (event.kind === 'keys') {
        void loadKeys().catch(report)
      } else if (event.kind === 'resync') {
        void generateApi
          .jobs(projectId)
          .then(({ jobs }) => {
            if (!cancelled)
              useGenerateStore
                .getState()
                .setJobs(jobs.filter((job) => job.project_id === projectId))
          })
          .catch(report)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [projectId])
}
