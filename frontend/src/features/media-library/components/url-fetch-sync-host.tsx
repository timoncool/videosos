import { useEffect } from 'react'
import { onServerEvent } from '@/infrastructure/desktop/server-events'
import { urlApi, type UrlFetch } from '../services/url-api'
import { importFinishedFetches } from '../services/url-importer'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useUrlFetchStore } from '../stores/url-fetch-store'

function report(error: unknown): void {
  console.error('[ERROR] the link downloads were not read:', error)
}

/**
 * Keeps the link downloads and the link tool in step with the server for as long as the window lives, and
 * imports a finished download into its project when that project is open, whether or not the dialog is.
 */
export function UrlFetchSyncHost() {
  const projectId = useMediaLibraryStore((state) => state.currentProjectId)
  useEffect(() => {
    const read = () => {
      void urlApi
        .list()
        .then(({ fetches }) => {
          useUrlFetchStore.getState().setFetches(fetches)
          importFinishedFetches(fetches)
        })
        .catch(report)
      void urlApi.tool().then(useUrlFetchStore.getState().setTool).catch(report)
    }
    read()
    return onServerEvent((event) => {
      if (event.kind === 'fetch') {
        const fetch = event.data as UrlFetch
        useUrlFetchStore.getState().upsert(fetch)
        importFinishedFetches([fetch])
      } else if (event.kind === 'fetch_removed') {
        useUrlFetchStore.getState().remove((event.data as { id: string }).id)
      } else if (event.kind === 'url_tool') {
        void urlApi.tool().then(useUrlFetchStore.getState().setTool).catch(report)
      } else if (event.kind === 'resync') {
        read()
      }
    })
  }, [projectId])
  return null
}
