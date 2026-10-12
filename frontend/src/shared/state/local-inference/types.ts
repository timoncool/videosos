export type LocalInferenceBackend = 'webgpu' | 'wasm' | 'unknown'
export type LocalInferenceState = 'loading' | 'running' | 'ready' | 'error'

/**
 * Which half of `state: 'loading'` is running. Fetching weights can take minutes and reports
 * bytes; compiling the graph afterwards reports nothing. Runtimes that cannot tell the two
 * apart simply leave this unset and the pill falls back to a generic "Loading".
 */
export type LocalInferenceLoadingPhase = 'downloading' | 'preparing'

export interface LocalInferenceRuntimeRecord {
  id: string
  feature: string
  featureLabel: string
  modelKey: string
  modelLabel: string
  backend: LocalInferenceBackend
  state: LocalInferenceState
  loadingPhase?: LocalInferenceLoadingPhase
  /**
   * While `loadingPhase === 'downloading'`, whether every byte came from local cache rather
   * than the network. A cache read still streams bytes and still takes seconds, so it reports
   * the same phase — but calling it a "download" would be a lie.
   */
  loadingFromCache?: boolean
  estimatedBytes?: number
  /** Weight bytes fetched so far, against `estimatedBytes`. Only set while downloading. */
  loadedBytes?: number
  activeJobs: number
  loadedAt: number
  lastUsedAt: number
  unloadable: boolean
  errorMessage?: string
}

export interface LocalInferenceStateShape {
  runtimesById: Record<string, LocalInferenceRuntimeRecord>
}

export interface LocalInferenceActions {
  registerRuntime: (runtime: LocalInferenceRuntimeRecord) => void
  updateRuntime: (id: string, updates: Partial<Omit<LocalInferenceRuntimeRecord, 'id'>>) => void
  unregisterRuntime: (id: string) => void
  clearRuntimes: () => void
}

export interface LocalInferenceSummary {
  totalRuntimes: number
  totalEstimatedBytes: number
  activeJobs: number
  state: LocalInferenceState
  /** Set only while `state === 'loading'` and a loading runtime reported which phase it is in. */
  loadingPhase: LocalInferenceLoadingPhase | null
  /** True when `loadingPhase === 'downloading'` and no runtime is touching the network. */
  loadingFromCache: boolean
  /** Weight bytes fetched so far across the loading runtimes; 0 when none report it. */
  loadedBytes: number
  backendLabel: string | null
  primaryLabel: string
  unloadableCount: number
}

export const LOCAL_INFERENCE_UNLOADED_MESSAGE = 'Local inference unloaded'

export function isLocalInferenceCancellationError(error: unknown): boolean {
  return error instanceof Error && error.message === LOCAL_INFERENCE_UNLOADED_MESSAGE
}

export function getLocalInferenceSummary(
  runtimesById: Record<string, LocalInferenceRuntimeRecord>,
): LocalInferenceSummary | null {
  const runtimes = Object.values(runtimesById)
  if (runtimes.length === 0) {
    return null
  }

  const state: LocalInferenceState = runtimes.some((runtime) => runtime.state === 'running')
    ? 'running'
    : runtimes.some((runtime) => runtime.state === 'loading')
      ? 'loading'
      : runtimes.some((runtime) => runtime.state === 'error')
        ? 'error'
        : 'ready'

  // Downloading outranks preparing: if anything is still pulling bytes, that is what the user
  // is waiting on, and it is the phase that can run for minutes.
  const loadingRuntimes = runtimes.filter((runtime) => runtime.state === 'loading')
  const fetchingRuntimes = loadingRuntimes.filter(
    (runtime) => runtime.loadingPhase === 'downloading',
  )
  const loadingPhase: LocalInferenceLoadingPhase | null =
    state !== 'loading'
      ? null
      : fetchingRuntimes.length > 0
        ? 'downloading'
        : loadingRuntimes.some((runtime) => runtime.loadingPhase === 'preparing')
          ? 'preparing'
          : null

  // Only claim a cache read when nothing is hitting the network — one runtime downloading
  // makes the whole pill a download.
  const loadingFromCache =
    loadingPhase === 'downloading' &&
    fetchingRuntimes.every((runtime) => runtime.loadingFromCache === true)

  const backendLabels = new Set(
    runtimes
      .map((runtime) => runtime.backend)
      .filter((backend) => backend !== 'unknown')
      .map((backend) => backend.toUpperCase()),
  )

  return {
    totalRuntimes: runtimes.length,
    totalEstimatedBytes: runtimes.reduce(
      (total, runtime) => total + (runtime.estimatedBytes ?? 0),
      0,
    ),
    activeJobs: runtimes.reduce((total, runtime) => total + runtime.activeJobs, 0),
    state,
    loadingPhase,
    loadingFromCache,
    loadedBytes: loadingRuntimes.reduce((total, runtime) => total + (runtime.loadedBytes ?? 0), 0),
    backendLabel:
      backendLabels.size === 1
        ? ([...backendLabels][0] ?? null)
        : backendLabels.size > 1
          ? 'Mixed'
          : null,
    primaryLabel:
      runtimes.length === 1
        ? `${runtimes[0]?.featureLabel} ${runtimes[0]?.modelLabel ?? ''}`.trim()
        : `${runtimes.length} Local Models`,
    unloadableCount: runtimes.filter((runtime) => runtime.unloadable).length,
  }
}
