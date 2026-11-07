/** The link downloads and the link tool as the server last told them, for the dialog and the importer. */

import { create } from 'zustand'
import type { UrlFetch, UrlTool } from '../services/url-api'

interface UrlFetchState {
  fetches: UrlFetch[]
  tool: UrlTool | null
  setFetches: (fetches: UrlFetch[]) => void
  upsert: (fetch: UrlFetch) => void
  remove: (id: string) => void
  setTool: (tool: UrlTool) => void
}

export const useUrlFetchStore = create<UrlFetchState>()((set, get) => ({
  fetches: [],
  tool: null,
  setFetches: (fetches) => set({ fetches }),
  upsert: (fetch) => {
    const fetches = get().fetches
    const index = fetches.findIndex((each) => each.id === fetch.id)
    if (index === -1) set({ fetches: [fetch, ...fetches] })
    else set({ fetches: fetches.map((each, at) => (at === index ? fetch : each)) })
  },
  remove: (id) => set({ fetches: get().fetches.filter((each) => each.id !== id) }),
  setTool: (tool) => set({ tool }),
}))
