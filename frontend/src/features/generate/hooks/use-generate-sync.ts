import { useEffect } from 'react'
import { generateApi, onServerEvent, type Provider } from '../services/generate-api'
import { importFinished } from '../services/result-importer'
import { useGenerateStore } from '../stores/generate-store'

function report(error: unknown): void {
  useGenerateStore.getState().setServerError(error instanceof Error ? error.message : String(error))
}

async function loadKeys(): Promise<void> {
  const { keys } = await generateApi.keys()
  const set: Partial<Record<Provider, boolean>> = {}
  for (const key of keys) set[key.provider] = key.set
  useGenerateStore.getState().setKeys(set)
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
    const unsubscribe = onServerEvent((event) => {
      if (event.kind === 'job') {
        if (event.data.project_id === projectId) {
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
            if (!cancelled) useGenerateStore.getState().setJobs(jobs.filter((job) => job.project_id === projectId))
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
