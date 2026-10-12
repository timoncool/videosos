export type PreviewScrubWorkspace = 'edit' | 'color' | 'animate' | 'motion'

interface PreviewScrubRequestSample {
  seq: number
  workspace: PreviewScrubWorkspace
  frame: number
  direction: -1 | 0 | 1
  atMs: number
}

export interface PreviewCompositionRenderSample {
  frame: number
  path: 'cache-hit' | 'direct' | 'full' | 'aborted'
  ms: number
  planMs?: number
  taskMs?: number
  gpuWaitMs?: number
  compositeMs?: number
  finalizeMs?: number
  taskCount?: number
  transitionCount?: number
  slowTasks?: Array<{
    id: string
    kind: string
    ms: number
  }>
}

interface PreviewScrubPresentedSample {
  seq: number
  workspace: PreviewScrubWorkspace
  requestedFrame: number
  renderedFrame: number
  direction: -1 | 0 | 1
  requestToDequeueMs: number
  requestToRenderStartMs: number
  requestToPresentMs: number
  renderMs: number
  supersededByRequests: number
}

interface PreviewScrubFallbackSample {
  seq: number
  workspace: PreviewScrubWorkspace
  frame: number
  firstVisibleMs: number
  exactReplacementMs: number | null
}

export interface PreviewVideoSourceSample {
  frame: number
  itemId: string
  path:
    | 'dom-video'
    | 'worker-bitmap'
    | 'proxy-fallback'
    | 'tier2-cache'
    | 'mediabunny'
    | 'video-fallback'
  sourceTime: number
  domAvailable?: boolean
  domReady?: boolean
  domDrift?: number | null
  canUseDom?: boolean
}

interface PreviewPreseekPlanSample {
  frame: number
  sourceCount: number
  timestampCount: number
  atMs: number
}

export interface PreviewCanvasPoolSample {
  width: number
  height: number
  maxSize: number
  peakInUse: number
  temporaryAllocations: number
}

export interface PreviewDecoderMetricsSample {
  requests: number
  cacheHits: number
  workerPosts: number
  workerSuccesses: number
  workerFailures: number
  supersededRequests: number
  cacheSources: number
  cacheBitmaps: number
  cacheSourceEvictions: number
  activeRequests: number
  activeCacheHits: number
  activeWorkerPosts: number
  activeCancellations: number
  activeSupersededRequests: number
  activeLookaheadPosts: number
  activeExtractorCount: number
  activeExtractorPeak: number
  activeReadyNotifications: number
  fallbackRequests: number
  fallbackCacheHits: number
  fallbackBitmaps: number
  fallbackSourceEvictions: number
  fallbackReadyNotifications: number
  exactFallbackReplacements: number
}

interface PreviewScrubPerformanceState {
  version: 1
  requests: PreviewScrubRequestSample[]
  renders: PreviewCompositionRenderSample[]
  presented: PreviewScrubPresentedSample[]
  fallbacks: PreviewScrubFallbackSample[]
  videoSources: PreviewVideoSourceSample[]
  preseeks: PreviewPreseekPlanSample[]
  canvasPools: PreviewCanvasPoolSample[]
  decoder: PreviewDecoderMetricsSample | null
  reset: () => void
}

type PreviewScrubPerformanceGlobal = typeof globalThis & {
  __PREVIEW_SCRUB_PERF__?: PreviewScrubPerformanceState
}

type PendingRequest = PreviewScrubRequestSample

interface CompletedRender {
  request: PendingRequest
  dequeuedAtMs: number
  renderStartedAtMs: number
  renderEndedAtMs: number
}

const SHOULD_PROFILE_PREVIEW_SCRUB = import.meta.env.DEV || import.meta.env.MODE === 'perf'
const MAX_PERF_SAMPLES = 3000
const PERF_SNAPSHOT_ELEMENT_ID = 'freecut-preview-scrub-performance'
const PERF_SNAPSHOT_DEBOUNCE_MS = 100
const PERF_SNAPSHOT_QUERY_PARAM = 'previewScrubPerfSnapshot'

export function shouldPublishPreviewScrubDomSnapshot(search: string): boolean {
  return new URLSearchParams(search).get(PERF_SNAPSHOT_QUERY_PARAM) === '1'
}

const SHOULD_PUBLISH_DOM_SNAPSHOT =
  typeof location !== 'undefined' && shouldPublishPreviewScrubDomSnapshot(location.search)

let requestSequence = 0
let latestRequest: PendingRequest | null = null
const pendingRequestsByFrame = new Map<number, PendingRequest>()
const completedRendersByFrame = new Map<number, CompletedRender>()
const fallbackPresentationByFrame = new Map<
  number,
  { sample: PreviewScrubFallbackSample; presentedAtMs: number }
>()
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let maxCanvasPoolPeak = 0
let maxCanvasPoolTemporaryAllocations = 0

function pushBounded<T>(samples: T[], sample: T): void {
  samples.push(sample)
  if (samples.length > MAX_PERF_SAMPLES) samples.shift()
}

function resetInternalState(): void {
  requestSequence = 0
  latestRequest = null
  pendingRequestsByFrame.clear()
  completedRendersByFrame.clear()
  fallbackPresentationByFrame.clear()
  maxCanvasPoolPeak = 0
  maxCanvasPoolTemporaryAllocations = 0
}

function scheduleDomSnapshot(state: PreviewScrubPerformanceState): void {
  if (!SHOULD_PUBLISH_DOM_SNAPSHOT || typeof document === 'undefined' || snapshotTimer !== null) {
    return
  }
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    let snapshot = document.getElementById(PERF_SNAPSHOT_ELEMENT_ID)
    if (!snapshot) {
      snapshot = document.createElement('script')
      snapshot.id = PERF_SNAPSHOT_ELEMENT_ID
      snapshot.setAttribute('type', 'application/json')
      snapshot.hidden = true
      document.documentElement.append(snapshot)
    }
    snapshot.textContent = JSON.stringify({
      version: state.version,
      requests: state.requests,
      renders: state.renders,
      presented: state.presented,
      fallbacks: state.fallbacks,
      videoSources: state.videoSources,
      preseeks: state.preseeks,
      canvasPools: state.canvasPools,
      decoder: state.decoder,
    })
  }, PERF_SNAPSHOT_DEBOUNCE_MS)
}

function createPerformanceState(): PreviewScrubPerformanceState {
  const state: PreviewScrubPerformanceState = {
    version: 1,
    requests: [],
    renders: [],
    presented: [],
    fallbacks: [],
    videoSources: [],
    preseeks: [],
    canvasPools: [],
    decoder: null,
    reset: () => {
      state.requests.length = 0
      state.renders.length = 0
      state.presented.length = 0
      state.fallbacks.length = 0
      state.videoSources.length = 0
      state.preseeks.length = 0
      state.canvasPools.length = 0
      state.decoder = null
      resetInternalState()
      scheduleDomSnapshot(state)
    },
  }
  return state
}

function getPerformanceState(): PreviewScrubPerformanceState | null {
  if (!SHOULD_PROFILE_PREVIEW_SCRUB) return null
  const root = globalThis as PreviewScrubPerformanceGlobal
  if (root.__PREVIEW_SCRUB_PERF__) return root.__PREVIEW_SCRUB_PERF__

  try {
    root.__PREVIEW_SCRUB_PERF__ = createPerformanceState()
    return root.__PREVIEW_SCRUB_PERF__
  } catch {
    // Some embedded runtimes make their global object non-extensible. The
    // profiler is diagnostic-only, so preview rendering must keep working.
    return null
  }
}

export function recordPreviewScrubRequest(
  workspace: PreviewScrubWorkspace,
  frame: number,
  direction: -1 | 0 | 1,
): void {
  const state = getPerformanceState()
  if (!state) return

  // A new pointer target supersedes every outstanding fallback handoff. Exact
  // frames that arrive for an older target must not be attributed to this
  // request, including when the user later revisits the same frame.
  for (const pendingFrame of fallbackPresentationByFrame.keys()) {
    if (pendingFrame !== frame) fallbackPresentationByFrame.delete(pendingFrame)
  }

  const request: PendingRequest = {
    seq: ++requestSequence,
    workspace,
    frame,
    direction,
    atMs: performance.now(),
  }
  latestRequest = request
  pendingRequestsByFrame.set(frame, request)
  pushBounded(state.requests, request)
  scheduleDomSnapshot(state)
}

export function recordPreviewScrubRenderDequeued(frame: number): void {
  if (!SHOULD_PROFILE_PREVIEW_SCRUB) return
  const request = pendingRequestsByFrame.get(frame)
  if (!request) return
  completedRendersByFrame.set(frame, {
    request,
    dequeuedAtMs: performance.now(),
    renderStartedAtMs: 0,
    renderEndedAtMs: 0,
  })
}

export function recordPreviewScrubRenderStarted(frame: number): void {
  const render = completedRendersByFrame.get(frame)
  if (render) render.renderStartedAtMs = performance.now()
}

export function recordPreviewScrubRenderCompleted(frame: number): void {
  const render = completedRendersByFrame.get(frame)
  if (render) render.renderEndedAtMs = performance.now()
}

export function recordPreviewScrubPresented(frame: number): void {
  const state = getPerformanceState()
  const render = completedRendersByFrame.get(frame)
  if (!state || !render || render.renderStartedAtMs === 0 || render.renderEndedAtMs === 0) return

  const presentedAtMs = performance.now()
  pushBounded(state.presented, {
    seq: render.request.seq,
    workspace: render.request.workspace,
    requestedFrame: render.request.frame,
    renderedFrame: frame,
    direction: render.request.direction,
    requestToDequeueMs: Number((render.dequeuedAtMs - render.request.atMs).toFixed(2)),
    requestToRenderStartMs: Number((render.renderStartedAtMs - render.request.atMs).toFixed(2)),
    requestToPresentMs: Number((presentedAtMs - render.request.atMs).toFixed(2)),
    renderMs: Number((render.renderEndedAtMs - render.renderStartedAtMs).toFixed(2)),
    supersededByRequests: Math.max(
      0,
      (latestRequest?.seq ?? render.request.seq) - render.request.seq,
    ),
  })
  completedRendersByFrame.delete(frame)
  if (pendingRequestsByFrame.get(frame)?.seq === render.request.seq) {
    pendingRequestsByFrame.delete(frame)
  }
  scheduleDomSnapshot(state)
}

export function recordPreviewScrubPresentationQuality(frame: number, usedFallback: boolean): void {
  const state = getPerformanceState()
  if (!state) return
  const now = performance.now()
  if (usedFallback) {
    const request = pendingRequestsByFrame.get(frame)
    if (!request || fallbackPresentationByFrame.has(frame)) return
    const sample: PreviewScrubFallbackSample = {
      seq: request.seq,
      workspace: request.workspace,
      frame,
      firstVisibleMs: Number((now - request.atMs).toFixed(2)),
      exactReplacementMs: null,
    }
    fallbackPresentationByFrame.set(frame, { sample, presentedAtMs: now })
    pushBounded(state.fallbacks, sample)
    scheduleDomSnapshot(state)
    return
  }

  const pendingFallback = fallbackPresentationByFrame.get(frame)
  if (!pendingFallback) return
  pendingFallback.sample.exactReplacementMs = Number(
    (now - pendingFallback.presentedAtMs).toFixed(2),
  )
  fallbackPresentationByFrame.delete(frame)
  scheduleDomSnapshot(state)
}

export function recordPreviewCompositionRender(sample: PreviewCompositionRenderSample): void {
  const state = getPerformanceState()
  if (!state) return
  pushBounded(state.renders, sample)
  scheduleDomSnapshot(state)
}

export function recordPreviewVideoSource(sample: PreviewVideoSourceSample): void {
  const state = getPerformanceState()
  if (!state) return
  pushBounded(state.videoSources, sample)
  scheduleDomSnapshot(state)
}

export function recordPreviewPreseekPlan(frame: number, bySource: Map<string, number[]>): void {
  const state = getPerformanceState()
  if (!state) return
  pushBounded(state.preseeks, {
    frame,
    sourceCount: bySource.size,
    timestampCount: [...bySource.values()].reduce((sum, timestamps) => sum + timestamps.length, 0),
    atMs: performance.now(),
  })
  scheduleDomSnapshot(state)
}

export function recordPreviewCanvasPool(sample: PreviewCanvasPoolSample): void {
  const state = getPerformanceState()
  if (!state) return
  if (
    sample.peakInUse <= maxCanvasPoolPeak &&
    sample.temporaryAllocations <= maxCanvasPoolTemporaryAllocations
  )
    return
  maxCanvasPoolPeak = Math.max(maxCanvasPoolPeak, sample.peakInUse)
  maxCanvasPoolTemporaryAllocations = Math.max(
    maxCanvasPoolTemporaryAllocations,
    sample.temporaryAllocations,
  )
  pushBounded(state.canvasPools, sample)
  scheduleDomSnapshot(state)
}

export function recordPreviewDecoderMetrics(sample: PreviewDecoderMetricsSample): void {
  const state = getPerformanceState()
  if (!state) return
  state.decoder = { ...sample }
  scheduleDomSnapshot(state)
}

// Publish the diagnostics object while application code still owns its global
// realm. Browser automation may run in a non-extensible isolated Window proxy.
getPerformanceState()
