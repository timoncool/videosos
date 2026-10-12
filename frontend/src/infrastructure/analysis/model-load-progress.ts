/** Progress info passed by `@huggingface/transformers` download callbacks. */
export interface ModelLoadProgressInfo {
  status?: string
  total?: number
  loaded?: number
}

/**
 * Builds a `progress_callback` for `from_pretrained` model loads that posts
 * throttled `loading-model` progress (5→95%) through `post`. The returned
 * callback owns its throttle state, so create one fresh per load.
 */
export function createModelLoadProgressCallback(
  post: (message: Record<string, unknown>) => void,
): (info: ModelLoadProgressInfo) => void {
  let lastPct = 5
  return (info) => {
    if (info.status === 'progress' && info.total && info.loaded) {
      const pct = 5 + (info.loaded / info.total) * 90
      if (pct - lastPct > 2) {
        lastPct = pct
        post({ type: 'progress', stage: 'loading-model', percent: Math.round(pct) })
      }
    }
  }
}
