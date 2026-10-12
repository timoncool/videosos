/**
 * Main-thread manager for the decoder prewarm Web Worker pool.
 *
 * Sends pre-seek requests to background workers that run mediabunny WASM
 * decode off the main thread. Workers return decoded ImageBitmaps that
 * the render loop can draw directly — zero main-thread WASM work.
 *
 * Pool size scales with hardware concurrency: min 3, max 6.
 * Each worker loads its own mediabunny WASM instance (~2MB), so we cap
 * at 6 to avoid excessive memory pressure. 3 covers transition pairs
 * (left + right clips) plus a spare; extra workers help when multiple
 * transitions or jump preseeks overlap.
 *
 * This eliminates the 300-500ms keyframe seek stall when occluded variable-
 * speed clips become visible mid-playback.
 */

import { createLogger } from '@/shared/logging/logger'
import {
  getObjectUrlBlob,
  getObjectUrlDirectFileMetadata,
} from '@/infrastructure/browser/object-url-registry'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { updateMedia } from '@/infrastructure/storage'
import {
  getKeyframeTimestamps,
  registerKeyframeIndex,
} from '@/shared/utils/keyframe-index-registry'

const log = createLogger('DecoderPrewarm')
const MAX_CACHED_BITMAPS_PER_SOURCE = 6
const MAX_CACHED_BITMAP_PIXELS_PER_SOURCE = 12_000_000
const MAX_CACHED_BITMAP_SOURCES = 4
const MAX_FALLBACK_BITMAPS_PER_SOURCE = 2
const MAX_FALLBACK_BITMAP_SOURCES = 4
const MAX_INFLIGHT_PER_WORKER = 1
const MAX_ACTIVE_PREVIEW_INFLIGHT = 2
const MAX_QUEUED_ACTIVE_PREVIEW_SOURCES = 2
const PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS = 1 / 240
/** Min 3 (transition pair + spare), max 6 (memory cap ~12MB WASM) */
const WORKER_POOL_SIZE = Math.max(
  3,
  Math.min(6, Math.floor((navigator.hardwareConcurrency ?? 4) / 2)),
)

export interface DecoderPrewarmMetricsSnapshot {
  requests: number
  cacheHits: number
  inflightReuses: number
  workerPosts: number
  workerSuccesses: number
  workerFailures: number
  queuedRequests: number
  supersededRequests: number
  waitRequests: number
  waitMatches: number
  waitResolved: number
  waitTimeouts: number
  cacheSources: number
  cacheBitmaps: number
  cacheSourceEvictions: number
  poolSize: number
  activeWorkerReady: boolean
  activeRequests: number
  activeCacheHits: number
  activeWorkerPosts: number
  activeCancellations: number
  activeSupersededRequests: number
  activeLookaheadPosts: number
  activeExtractorCount: number
  activeExtractorPeak: number
  activeReadyNotifications: number
  activeWorkerRestarts: number
  activeLastInitMs: number
  activeLastDecodeMs: number
  fallbackRequests: number
  fallbackCacheHits: number
  fallbackBitmaps: number
  fallbackSourceEvictions: number
  fallbackReadyNotifications: number
  exactFallbackReplacements: number
}

interface PoolWorker {
  worker: Worker
  inflightCount: number
}

let workerPool: PoolWorker[] = []
let poolInitialized = false
let requestId = 0
const pendingRequests = new Map<
  string,
  {
    resolve: (bitmap: ImageBitmap | null) => void
  }
>()
const pendingBatchRequests = new Map<
  string,
  {
    resolve: (bitmaps: Map<number, ImageBitmap>) => void
    cancel: () => void
  }
>()

/** Cache of pre-decoded bitmaps keyed by video source URL. Multiple entries per source. */
type CachedBitmapEntry = { bitmap: ImageBitmap; timestamp: number }
const bitmapCache = new Map<string, CachedBitmapEntry[]>()
const bitmapCacheCapacityBySrc = new Map<string, number>()
type CachedFallbackBitmapEntry = CachedBitmapEntry & { proxyTimestamp: number }
const fallbackBitmapCache = new Map<string, CachedFallbackBitmapEntry[]>()
const unavailableBlobUrls = new Set<string>()

type InflightPreseek = {
  timestamp: number
  promise: Promise<ImageBitmap | null>
}

type QueuedPreseek = {
  src: string
  timestamp: number
  resolve: (bitmap: ImageBitmap | null) => void
  inflightEntry: InflightPreseek
}

export interface ActivePreviewPreseekRequest {
  src: string
  timestamp: number
  lookaheadTimestamps?: number[]
}

type ActivePreviewRequestState = {
  src: string
  timestamp: number
  lookaheadTimestamps: number[]
  promise: Promise<ImageBitmap | null>
  resolve: (bitmap: ImageBitmap | null) => void
  settled: boolean
  inflightEntry: InflightPreseek
}

type ActivePreviewInflightState = ActivePreviewRequestState & {
  id: string
  generation: number
  cancelled: boolean
}

const decoderPrewarmMetrics: DecoderPrewarmMetricsSnapshot = {
  requests: 0,
  cacheHits: 0,
  inflightReuses: 0,
  workerPosts: 0,
  workerSuccesses: 0,
  workerFailures: 0,
  queuedRequests: 0,
  supersededRequests: 0,
  waitRequests: 0,
  waitMatches: 0,
  waitResolved: 0,
  waitTimeouts: 0,
  cacheSources: 0,
  cacheBitmaps: 0,
  cacheSourceEvictions: 0,
  poolSize: 0,
  activeWorkerReady: false,
  activeRequests: 0,
  activeCacheHits: 0,
  activeWorkerPosts: 0,
  activeCancellations: 0,
  activeSupersededRequests: 0,
  activeLookaheadPosts: 0,
  activeExtractorCount: 0,
  activeExtractorPeak: 0,
  activeReadyNotifications: 0,
  activeWorkerRestarts: 0,
  activeLastInitMs: 0,
  activeLastDecodeMs: 0,
  fallbackRequests: 0,
  fallbackCacheHits: 0,
  fallbackBitmaps: 0,
  fallbackSourceEvictions: 0,
  fallbackReadyNotifications: 0,
  exactFallbackReplacements: 0,
}

/** In-flight preseek promises keyed by source URL — lets the render engine await
 *  a pending worker decode instead of falling through to a blocking main-thread decode. */
const inflightPreseekBySrc = new Map<string, InflightPreseek[]>()
/** One latest waiting target per source, capped to one queue-width per worker. */
const queuedPreseekBySrc = new Map<string, QueuedPreseek>()
let activePreviewWorker: Worker | null = null
let activePreviewGeneration = 0
const activePreviewInflightById = new Map<string, ActivePreviewInflightState>()
const queuedActivePreviewRequestsBySrc = new Map<string, ActivePreviewRequestState>()
let activePreviewScrubSession = false
let latestActivePreviewTimelineFrame: number | null = null
let activePreviewRequestVersion = 0
let activePreviewSettleTimer: ReturnType<typeof setTimeout> | null = null
const latestActivePreviewTimestampsBySrc = new Map<string, number[]>()
const activePreviewReadyListeners = new Set<(src: string, timestamp: number) => void>()

// Dev: expose cache for debugging. Guard `window` — this module is also pulled
// into worker bundles (e.g. via the export deps barrel), where `window` is
// undefined and touching it throws at module-eval time.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__PREWARM_CACHE__ = bitmapCache
}

function handleWorkerMessage(event: MessageEvent): void {
  const msg = event.data
  if (msg.type === 'debug') {
    if (msg.step === 'active_extractors' && Number.isFinite(msg.count)) {
      decoderPrewarmMetrics.activeExtractorCount = Math.max(0, Number(msg.count))
      decoderPrewarmMetrics.activeExtractorPeak = Math.max(
        decoderPrewarmMetrics.activeExtractorPeak,
        decoderPrewarmMetrics.activeExtractorCount,
      )
    }
    if (msg.step === 'active_init_complete' && Number.isFinite(msg.ms)) {
      decoderPrewarmMetrics.activeLastInitMs = Math.max(0, Number(msg.ms))
    }
    if (msg.step === 'active_decode_complete' && Number.isFinite(msg.ms)) {
      decoderPrewarmMetrics.activeLastDecodeMs = Math.max(0, Number(msg.ms))
    }
    return
  }
  if (msg.type === 'keyframes_extracted') {
    // Worker extracted keyframes for a source that had none.
    // Register in main-thread registry for the export/edit overlay path.
    registerKeyframeIndex(msg.src, msg.keyframeTimestamps)
    keyframesSentForSrc.add(msg.src)
    // Persist to IndexedDB so future sessions don't need re-extraction
    const mediaId = blobUrlManager.getMediaIdByUrl(msg.src)
    if (mediaId) {
      void updateMedia(mediaId, { keyframeTimestamps: msg.keyframeTimestamps })
    }
    return
  }
  if (msg.type === 'preseek_done') {
    const pending = pendingRequests.get(msg.id)
    if (pending) {
      pendingRequests.delete(msg.id)
      pending.resolve(msg.bitmap ?? null)
    } else {
      closeUnclaimedBitmap(msg.bitmap)
    }
  } else if (msg.type === 'batch_preseek_done') {
    const pending = pendingBatchRequests.get(msg.id)
    if (pending) {
      pendingBatchRequests.delete(msg.id)
      const results = new Map<number, ImageBitmap>()
      if (msg.success && Array.isArray(msg.entries)) {
        for (const entry of msg.entries) {
          results.set(entry.timestamp, entry.bitmap)
        }
      }
      pending.resolve(results)
    } else if (Array.isArray(msg.entries)) {
      for (const entry of msg.entries) {
        closeUnclaimedBitmap(entry?.bitmap)
      }
    }
  }
}

function closeUnclaimedBitmap(bitmap: unknown): void {
  if (!bitmap || typeof (bitmap as ImageBitmap).close !== 'function') {
    return
  }

  try {
    ;(bitmap as ImageBitmap).close()
  } catch {
    // Ignore close errors.
  }
}

function createPoolWorker(): PoolWorker | null {
  try {
    const w = new Worker(new URL('../workers/decoder-prewarm-worker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = handleWorkerMessage
    w.onerror = (error) => {
      log.warn('Decoder prewarm worker error', {
        message: error.message,
        filename: error.filename,
        lineno: error.lineno,
      })
    }
    w.addEventListener('messageerror', (e) => {
      log.warn('Decoder prewarm worker message error', { data: e.data })
    })
    // Eagerly load mediabunny WASM so first preseek doesn't pay cold start
    w.postMessage({ type: 'warmup' })
    return { worker: w, inflightCount: 0 }
  } catch (error) {
    log.warn('Failed to create decoder prewarm worker', { error })
    return null
  }
}

function ensureWorkerPool(): void {
  if (poolInitialized) return
  poolInitialized = true
  log.info(`Creating decoder prewarm worker pool (size: ${WORKER_POOL_SIZE})`)
  for (let i = 0; i < WORKER_POOL_SIZE; i++) {
    const pw = createPoolWorker()
    if (pw) workerPool.push(pw)
  }
  decoderPrewarmMetrics.poolSize = workerPool.length
}

function ensureActivePreviewWorker(): Worker | null {
  if (activePreviewWorker) return activePreviewWorker
  const poolWorker = createPoolWorker()
  if (!poolWorker) return null
  activePreviewWorker = poolWorker.worker
  decoderPrewarmMetrics.activeWorkerReady = true
  return activePreviewWorker
}

/**
 * Eagerly spawn the worker pool (each worker preloads mediabunny WASM on
 * creation) so the first real preseek of a session doesn't pay worker spawn +
 * WASM load on top of the decode. Safe to call repeatedly — the pool is a
 * module singleton. Called from the preview's idle-time warmup alongside the
 * fast-scrub renderer.
 */
export function warmDecoderPrewarmWorkerPool(): void {
  if (typeof Worker === 'undefined') return
  ensureWorkerPool()
  ensureActivePreviewWorker()
}

/** Acquire the least-busy worker from the pool. */
function acquireWorker(): PoolWorker | null {
  ensureWorkerPool()
  if (workerPool.length === 0) return null
  let best = workerPool[0]!
  for (let i = 1; i < workerPool.length; i++) {
    const pw = workerPool[i]!
    if (pw.inflightCount < best.inflightCount) {
      best = pw
    }
  }
  if (best.inflightCount >= MAX_INFLIGHT_PER_WORKER) {
    return null
  }
  best.inflightCount++
  return best
}

function releaseWorker(pw: PoolWorker): void {
  pw.inflightCount = Math.max(0, pw.inflightCount - 1)
  drainQueuedPreseeks()
}

function findClosestBitmapEntry(
  src: string,
  timestamp: number,
  toleranceSeconds: number,
): CachedBitmapEntry | null {
  const entries = bitmapCache.get(src)
  if (!entries || entries.length === 0) return null

  // Map insertion order is our source-level LRU. A cache hit keeps the active
  // clip resident across Edit/Color/Animate workspace switches.
  bitmapCache.delete(src)
  bitmapCache.set(src, entries)

  let best: CachedBitmapEntry | null = null
  let bestDist = Infinity
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp)
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist
      best = entry
    }
  }

  return best
}

function findMatchingInflightPreseek(
  src: string,
  timestamp: number,
  toleranceSeconds: number,
): InflightPreseek | null {
  const entries = inflightPreseekBySrc.get(src)
  if (!entries || entries.length === 0) return null

  let best: InflightPreseek | null = null
  let bestDist = Infinity
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp)
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist
      best = entry
    }
  }

  return best
}

function getBitmapPixelCount(bitmap: ImageBitmap): number {
  const width = Number(bitmap.width)
  const height = Number(bitmap.height)
  return Number.isFinite(width) && Number.isFinite(height) ? width * height : 0
}

function trimCachedBitmapEntries(entries: CachedBitmapEntry[], capacity: number): void {
  let cachedPixels = entries.reduce((sum, entry) => sum + getBitmapPixelCount(entry.bitmap), 0)
  while (
    entries.length > capacity ||
    (entries.length > 1 && cachedPixels > MAX_CACHED_BITMAP_PIXELS_PER_SOURCE)
  ) {
    const old = entries.shift()
    if (!old) continue
    cachedPixels -= getBitmapPixelCount(old.bitmap)
    old.bitmap.close()
  }
}

function removeMatchingFallbackBitmaps(src: string, timestamp: number): void {
  const fallbackEntries = fallbackBitmapCache.get(src)
  if (!fallbackEntries) return

  const retained: CachedFallbackBitmapEntry[] = []
  for (const entry of fallbackEntries) {
    if (Math.abs(entry.timestamp - timestamp) <= PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS) {
      entry.bitmap.close()
      decoderPrewarmMetrics.exactFallbackReplacements += 1
    } else {
      retained.push(entry)
    }
  }
  if (retained.length > 0) fallbackBitmapCache.set(src, retained)
  else fallbackBitmapCache.delete(src)
}

function ensureBitmapCacheSourceCapacity(src: string): void {
  if (bitmapCache.has(src) || bitmapCache.size < MAX_CACHED_BITMAP_SOURCES) return
  const oldestSrc = bitmapCache.keys().next().value as string | undefined
  if (!oldestSrc) return

  const oldestEntries = bitmapCache.get(oldestSrc)
  bitmapCache.delete(oldestSrc)
  bitmapCacheCapacityBySrc.delete(oldestSrc)
  for (const entry of oldestEntries ?? []) entry.bitmap.close()
  decoderPrewarmMetrics.cacheSourceEvictions += 1
}

function replaceDuplicateCachedBitmap(entries: CachedBitmapEntry[], timestamp: number): void {
  const duplicateIndex = entries.findIndex(
    (entry) => Math.abs(entry.timestamp - timestamp) <= PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (duplicateIndex < 0) return
  const [duplicate] = entries.splice(duplicateIndex, 1)
  duplicate?.bitmap.close()
}

function cachePredecodedBitmap(
  src: string,
  timestamp: number,
  bitmap: ImageBitmap,
  requestedCapacity = MAX_CACHED_BITMAPS_PER_SOURCE,
): void {
  ensureBitmapCacheSourceCapacity(src)

  const capacity = Math.max(
    MAX_CACHED_BITMAPS_PER_SOURCE,
    Math.round(requestedCapacity),
    bitmapCacheCapacityBySrc.get(src) ?? 0,
  )
  bitmapCacheCapacityBySrc.set(src, capacity)
  const entries = bitmapCache.get(src) ?? []
  replaceDuplicateCachedBitmap(entries, timestamp)
  entries.push({ bitmap, timestamp })
  trimCachedBitmapEntries(entries, capacity)
  bitmapCache.delete(src)
  bitmapCache.set(src, entries)
  removeMatchingFallbackBitmaps(src, timestamp)
  const activeTargets = latestActivePreviewTimestampsBySrc.get(src)
  if (
    activePreviewScrubSession &&
    activeTargets?.some(
      (target) => Math.abs(target - timestamp) <= PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
    )
  ) {
    decoderPrewarmMetrics.activeReadyNotifications += 1
    for (const listener of activePreviewReadyListeners) listener(src, timestamp)
  }
}

export function cacheActivePreviewFallbackBitmap(
  src: string,
  timestamp: number,
  proxyTimestamp: number,
  bitmap: ImageBitmap,
): void {
  decoderPrewarmMetrics.fallbackRequests += 1
  if (!fallbackBitmapCache.has(src) && fallbackBitmapCache.size >= MAX_FALLBACK_BITMAP_SOURCES) {
    const oldestSrc = fallbackBitmapCache.keys().next().value as string | undefined
    if (oldestSrc) {
      const oldestEntries = fallbackBitmapCache.get(oldestSrc)
      fallbackBitmapCache.delete(oldestSrc)
      for (const entry of oldestEntries ?? []) entry.bitmap.close()
      decoderPrewarmMetrics.fallbackSourceEvictions += 1
    }
  }

  const entries = fallbackBitmapCache.get(src) ?? []
  const duplicateIndex = entries.findIndex(
    (entry) => Math.abs(entry.timestamp - timestamp) <= PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (duplicateIndex >= 0) entries.splice(duplicateIndex, 1)[0]?.bitmap.close()
  entries.push({ bitmap, timestamp, proxyTimestamp })
  while (entries.length > MAX_FALLBACK_BITMAPS_PER_SOURCE) entries.shift()?.bitmap.close()
  fallbackBitmapCache.delete(src)
  fallbackBitmapCache.set(src, entries)

  const activeTargets = latestActivePreviewTimestampsBySrc.get(src)
  if (
    activePreviewScrubSession &&
    activeTargets?.some(
      (target) => Math.abs(target - timestamp) <= PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
    )
  ) {
    decoderPrewarmMetrics.fallbackReadyNotifications += 1
    for (const listener of activePreviewReadyListeners) listener(src, timestamp)
  }
}

export function getCachedActivePreviewFallbackBitmap(
  src: string,
  timestamp: number,
  toleranceSeconds = PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
): ImageBitmap | null {
  const entries = fallbackBitmapCache.get(src)
  if (!entries || entries.length === 0) return null
  fallbackBitmapCache.delete(src)
  fallbackBitmapCache.set(src, entries)
  let best: CachedFallbackBitmapEntry | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const distance = Math.abs(entry.timestamp - timestamp)
    if (distance <= toleranceSeconds && distance < bestDistance) {
      best = entry
      bestDistance = distance
    }
  }
  if (best) decoderPrewarmMetrics.fallbackCacheHits += 1
  return best?.bitmap ?? null
}

function addInflightPreseek(src: string, entry: InflightPreseek): void {
  const entries = inflightPreseekBySrc.get(src) ?? []
  entries.push(entry)
  inflightPreseekBySrc.set(src, entries)
}

function removeInflightPreseek(src: string, entry: InflightPreseek): void {
  const entries = inflightPreseekBySrc.get(src)
  if (!entries || entries.length === 0) return

  const filtered = entries.filter((candidate) => candidate !== entry)
  if (filtered.length === 0) {
    inflightPreseekBySrc.delete(src)
    return
  }

  inflightPreseekBySrc.set(src, filtered)
}

function queueLatestPreseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  let resolve!: (bitmap: ImageBitmap | null) => void
  const promise = new Promise<ImageBitmap | null>((resolvePromise) => {
    resolve = resolvePromise
  })
  const inflightEntry: InflightPreseek = { timestamp, promise }

  const existing = queuedPreseekBySrc.get(src)
  if (existing) {
    queuedPreseekBySrc.delete(src)
    removeInflightPreseek(existing.src, existing.inflightEntry)
    decoderPrewarmMetrics.supersededRequests += 1
    // Duplicate consumers may be waiting on the old queued promise. Forward
    // them to the replacement decode instead of resolving a transient blank.
    void promise.then(existing.resolve, () => existing.resolve(null))
  }

  const maxQueuedPreseeks = Math.max(1, workerPool.length)
  if (queuedPreseekBySrc.size >= maxQueuedPreseeks) {
    const oldest = queuedPreseekBySrc.values().next().value as QueuedPreseek | undefined
    if (oldest) {
      queuedPreseekBySrc.delete(oldest.src)
      removeInflightPreseek(oldest.src, oldest.inflightEntry)
      decoderPrewarmMetrics.supersededRequests += 1
      oldest.resolve(null)
    }
  }

  const queued: QueuedPreseek = { src, timestamp, resolve, inflightEntry }
  queuedPreseekBySrc.set(src, queued)
  addInflightPreseek(src, inflightEntry)
  decoderPrewarmMetrics.queuedRequests += 1
  void promise.finally(() => removeInflightPreseek(src, inflightEntry))
  return promise
}

function drainQueuedPreseeks(): void {
  while (queuedPreseekBySrc.size > 0) {
    const hasCapacity = workerPool.some((pw) => pw.inflightCount < MAX_INFLIGHT_PER_WORKER)
    if (!hasCapacity) return

    const queued = queuedPreseekBySrc.values().next().value as QueuedPreseek | undefined
    if (!queued) return
    queuedPreseekBySrc.delete(queued.src)
    // Avoid matching the queued promise against itself when the real worker
    // request starts. Other same-source in-flight work remains reusable.
    removeInflightPreseek(queued.src, queued.inflightEntry)
    void startBackgroundPreseek(queued.src, queued.timestamp, false).then(queued.resolve, () => {
      queued.resolve(null)
    })
  }
}

/**
 * Pre-decode a video frame in a background Web Worker.
 * Returns the decoded ImageBitmap or null on failure.
 * The bitmap is also cached by source URL for the render loop to use.
 */
/** Cache of fetched blobs to avoid re-fetching for the same source. */
const blobByUrl = new Map<string, Blob>()

/** Track sources whose keyframe index has been sent to at least one worker */
const keyframesSentForSrc = new Set<string>()

// A revoked blob URL can never be drawn or fetched again, and re-resolving the
// same media mints a new URL — so every cache entry keyed by the old URL is
// unreachable. Drop it (and its bitmaps) instead of retaining the Blob for the
// lifetime of the session.
blobUrlManager.onRevoke((url) => {
  const hadBlob = blobByUrl.delete(url)
  const hadBitmap = bitmapCache.has(url) || fallbackBitmapCache.has(url)
  unavailableBlobUrls.delete(url)
  keyframesSentForSrc.delete(url)
  if (hadBlob || hadBitmap) {
    clearPredecodedCache(url)
  }
})

function getDirectSourceMetadata(src: string) {
  return getObjectUrlDirectFileMetadata(src) ?? undefined
}

function getKnownBlobForUrl(src: string): Blob | null {
  const cachedBlob = blobByUrl.get(src)
  if (cachedBlob) {
    unavailableBlobUrls.delete(src)
    return cachedBlob
  }

  const registeredBlob = getObjectUrlBlob(src)
  if (!registeredBlob) {
    return null
  }

  blobByUrl.set(src, registeredBlob)
  unavailableBlobUrls.delete(src)
  return registeredBlob
}

async function resolveBlobForUrl(src: string): Promise<Blob | null> {
  const knownBlob = getKnownBlobForUrl(src)
  if (knownBlob) {
    return knownBlob
  }
  if (!src.startsWith('blob:') || unavailableBlobUrls.has(src)) {
    return null
  }

  // If the URL is a `blob:` URL but not registered with blobUrlManager /
  // object-url-registry, it is structurally unreachable from our JS:
  // `blobUrlManager.acquire()` is the only place we create blob URLs, and
  // it registers every one. Calling `fetch(src)` on an unregistered URL
  // would always fail with ERR_FILE_NOT_FOUND — and Chrome logs that
  // network failure to DevTools *before* our .catch runs, producing a
  // red console line we cannot suppress.
  //
  // This case is almost always a false positive: a timeline item briefly
  // holding a stale `src` from a previous render cycle. The next render
  // pass rebinds to a fresh URL, and prewarm retries then. True "media
  // missing" failures surface on the real playback path via
  // `<video>.onerror`, which knows the mediaId and can present a proper
  // relink / error UI — prewarm is not the right layer to detect them.
  //
  // Track the URL in `unavailableBlobUrls` so we don't re-check the
  // registry repeatedly in the same session for a known-stale URL.
  unavailableBlobUrls.add(src)
  return null
}

function createActivePreviewRequestState({
  src,
  timestamp,
  lookaheadTimestamps = [],
}: ActivePreviewPreseekRequest): ActivePreviewRequestState {
  let resolve!: (bitmap: ImageBitmap | null) => void
  const promise = new Promise<ImageBitmap | null>((resolvePromise) => {
    resolve = resolvePromise
  })
  const state: ActivePreviewRequestState = {
    src,
    timestamp,
    lookaheadTimestamps: [...new Set(lookaheadTimestamps)]
      .filter(
        (candidate) =>
          Number.isFinite(candidate) &&
          candidate >= 0 &&
          Math.abs(candidate - timestamp) > PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
      )
      .slice(0, 3),
    promise,
    resolve,
    settled: false,
    inflightEntry: { timestamp, promise },
  }
  addInflightPreseek(src, state.inflightEntry)
  return state
}

function settleActivePreviewRequest(
  request: ActivePreviewRequestState,
  bitmap: ImageBitmap | null,
): void {
  if (request.settled) return
  request.settled = true
  removeInflightPreseek(request.src, request.inflightEntry)
  request.resolve(bitmap)
}

function scheduleMissingActivePreviewLookahead(src: string, timestamps: number[]): void {
  const missing = timestamps.filter(
    (timestamp) =>
      !getCachedPredecodedBitmap(src, timestamp, PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS),
  )
  if (missing.length === 0) return
  decoderPrewarmMetrics.activeLookaheadPosts += 1
  void backgroundBatchPreseek(src, missing)
}

function drainQueuedActivePreviewRequests(): void {
  while (
    activePreviewInflightById.size < MAX_ACTIVE_PREVIEW_INFLIGHT &&
    queuedActivePreviewRequestsBySrc.size > 0
  ) {
    const entry = queuedActivePreviewRequestsBySrc.entries().next().value as
      | [string, ActivePreviewRequestState]
      | undefined
    if (!entry) return
    const [src, request] = entry
    queuedActivePreviewRequestsBySrc.delete(src)
    startActivePreviewRequest(request)
  }
}

function cancelSupersededActivePreviewRequests(src: string): void {
  let cancelledAny = false
  for (const inflight of activePreviewInflightById.values()) {
    if (inflight.src !== src || inflight.cancelled) continue
    inflight.cancelled = true
    decoderPrewarmMetrics.activeCancellations += 1
    settleActivePreviewRequest(inflight, null)
    cancelledAny = true
  }
  if (!cancelledAny) return

  // MediaBunny sink calls are independent, so the stale decode may finish in
  // the background while a second bounded request starts immediately. Updating
  // the source generation makes the worker discard the stale result before it
  // touches the shared canvas, without throwing away the warm worker/Input.
  activePreviewWorker?.postMessage({
    type: 'active_cancel',
    src,
    generation: ++activePreviewGeneration,
  })
}

function startActivePreviewRequest(request: ActivePreviewRequestState): void {
  const worker = ensureActivePreviewWorker()
  if (!worker) {
    settleActivePreviewRequest(request, null)
    drainQueuedActivePreviewRequests()
    return
  }

  const id = `active-preview-${++requestId}`
  const generation = ++activePreviewGeneration
  const inflight: ActivePreviewInflightState = {
    ...request,
    id,
    generation,
    cancelled: false,
  }
  activePreviewInflightById.set(id, inflight)

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const finish = (bitmap: ImageBitmap | null) => {
    if (timeoutId !== null) clearTimeout(timeoutId)
    pendingRequests.delete(id)
    if (activePreviewInflightById.get(id) !== inflight) {
      closeUnclaimedBitmap(bitmap)
      return
    }
    activePreviewInflightById.delete(id)

    const wasCancelled = inflight.cancelled
    if (bitmap && !wasCancelled) {
      decoderPrewarmMetrics.workerSuccesses += 1
      cachePredecodedBitmap(inflight.src, inflight.timestamp, bitmap)
    } else if (bitmap) {
      closeUnclaimedBitmap(bitmap)
    } else if (!wasCancelled) {
      decoderPrewarmMetrics.workerFailures += 1
    }

    const resolvedBitmap = wasCancelled
      ? null
      : getCachedPredecodedBitmap(
          inflight.src,
          inflight.timestamp,
          PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
        )
    settleActivePreviewRequest(inflight, resolvedBitmap)

    if (resolvedBitmap && inflight.lookaheadTimestamps.length > 0) {
      scheduleMissingActivePreviewLookahead(inflight.src, inflight.lookaheadTimestamps)
    }
    drainQueuedActivePreviewRequests()
  }

  timeoutId = setTimeout(() => {
    if (!inflight.cancelled) {
      inflight.cancelled = true
      decoderPrewarmMetrics.activeCancellations += 1
      settleActivePreviewRequest(inflight, null)
      worker.postMessage({
        type: 'active_cancel',
        src: inflight.src,
        generation: ++activePreviewGeneration,
      })
    }
    finish(null)
  }, 5000)
  pendingRequests.set(id, { resolve: finish })

  let keyframeTimestamps: number[] | undefined
  if (!keyframesSentForSrc.has(inflight.src)) {
    keyframeTimestamps = getKeyframeTimestamps(inflight.src)
    if (keyframeTimestamps) keyframesSentForSrc.add(inflight.src)
  }

  const sourceMetadata = getDirectSourceMetadata(inflight.src)
  const postRequest = (blob?: Blob) => {
    if (!pendingRequests.has(id)) return
    decoderPrewarmMetrics.workerPosts += 1
    decoderPrewarmMetrics.activeWorkerPosts += 1
    worker.postMessage(
      blob
        ? {
            type: 'active_preseek',
            id,
            generation,
            src: inflight.src,
            timestamp: inflight.timestamp,
            blob,
            keyframeTimestamps,
            sourceMetadata,
          }
        : {
            type: 'active_preseek',
            id,
            generation,
            src: inflight.src,
            timestamp: inflight.timestamp,
            keyframeTimestamps,
            sourceMetadata,
          },
    )
  }
  const failRequest = () => pendingRequests.get(id)?.resolve(null)

  if (sourceMetadata) {
    postRequest()
    return
  }
  const cachedBlob = getKnownBlobForUrl(inflight.src)
  if (cachedBlob) {
    postRequest(cachedBlob)
    return
  }
  if (!inflight.src.startsWith('blob:')) {
    postRequest()
    return
  }
  if (unavailableBlobUrls.has(inflight.src)) {
    failRequest()
    return
  }
  void resolveBlobForUrl(inflight.src).then((blob) => {
    if (blob) postRequest(blob)
    else failRequest()
  })
}

/**
 * Decode the current held-scrub target on a worker reserved for active preview
 * interaction. MediaBunny sink calls are independent, so at most two requests
 * may overlap while one latest target per source is retained. Stale generations
 * are discarded before drawing and the warm worker is never restarted merely
 * because the pointer moved.
 */
export function activePreviewPreseek(
  request: ActivePreviewPreseekRequest,
): Promise<ImageBitmap | null> {
  decoderPrewarmMetrics.activeRequests += 1
  activePreviewRequestVersion += 1
  if (activePreviewSettleTimer !== null) {
    clearTimeout(activePreviewSettleTimer)
    activePreviewSettleTimer = null
  }
  latestActivePreviewTimestampsBySrc.set(request.src, [request.timestamp])
  const cached = getCachedPredecodedBitmap(
    request.src,
    request.timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (cached) {
    cancelSupersededActivePreviewRequests(request.src)
    decoderPrewarmMetrics.activeCacheHits += 1
    if (request.lookaheadTimestamps?.length) {
      scheduleMissingActivePreviewLookahead(request.src, request.lookaheadTimestamps)
    }
    return Promise.resolve(cached)
  }

  for (const inflight of activePreviewInflightById.values()) {
    if (
      !inflight.cancelled &&
      inflight.src === request.src &&
      Math.abs(inflight.timestamp - request.timestamp) <= PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS
    ) {
      decoderPrewarmMetrics.inflightReuses += 1
      return inflight.promise
    }
  }
  const queuedForSource = queuedActivePreviewRequestsBySrc.get(request.src)
  if (
    queuedForSource &&
    Math.abs(queuedForSource.timestamp - request.timestamp) <=
      PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS
  ) {
    decoderPrewarmMetrics.inflightReuses += 1
    return queuedForSource.promise
  }

  cancelSupersededActivePreviewRequests(request.src)
  const next = createActivePreviewRequestState(request)
  if (queuedForSource) {
    decoderPrewarmMetrics.activeSupersededRequests += 1
    settleActivePreviewRequest(queuedForSource, null)
    queuedActivePreviewRequestsBySrc.delete(request.src)
  }
  queuedActivePreviewRequestsBySrc.set(request.src, next)
  while (queuedActivePreviewRequestsBySrc.size > MAX_QUEUED_ACTIVE_PREVIEW_SOURCES) {
    const oldest = queuedActivePreviewRequestsBySrc.entries().next().value as
      | [string, ActivePreviewRequestState]
      | undefined
    if (!oldest) break
    queuedActivePreviewRequestsBySrc.delete(oldest[0])
    decoderPrewarmMetrics.activeSupersededRequests += 1
    settleActivePreviewRequest(oldest[1], null)
  }

  drainQueuedActivePreviewRequests()
  return next.promise
}

export function setActivePreviewRenderTarget(frame: number | null): void {
  latestActivePreviewTimelineFrame = frame
  activePreviewScrubSession = frame !== null
  if (frame === null) latestActivePreviewTimestampsBySrc.clear()
}

export function settleActivePreviewRenderTarget(frame: number): void {
  if (!activePreviewScrubSession || latestActivePreviewTimelineFrame !== frame) return
  if (!isActivePreviewFrameExactDecodeReady(frame)) return
  if (activePreviewSettleTimer !== null) clearTimeout(activePreviewSettleTimer)
  const requestVersion = activePreviewRequestVersion
  activePreviewSettleTimer = setTimeout(() => {
    activePreviewSettleTimer = null
    if (
      requestVersion === activePreviewRequestVersion &&
      latestActivePreviewTimelineFrame === frame
    ) {
      setActivePreviewRenderTarget(null)
    }
  }, 160)
}

function setActivePreviewSourceTargets(src: string, timestamps: number[]): void {
  latestActivePreviewTimestampsBySrc.set(src, [...new Set(timestamps)])
}

export function replaceActivePreviewSourceTargets(bySource: Map<string, number[]>): void {
  latestActivePreviewTimestampsBySrc.clear()
  for (const [src, timestamps] of bySource) {
    setActivePreviewSourceTargets(src, timestamps)
  }
}

export function isActivePreviewFrameSuperseded(frame: number): boolean {
  return (
    activePreviewScrubSession &&
    latestActivePreviewTimelineFrame !== null &&
    latestActivePreviewTimelineFrame !== frame
  )
}

export function isActivePreviewFrameCurrent(frame: number): boolean {
  return (
    activePreviewScrubSession &&
    latestActivePreviewTimelineFrame !== null &&
    latestActivePreviewTimelineFrame === frame
  )
}

export function isActivePreviewFrameDecodeReady(frame: number): boolean {
  if (!isActivePreviewFrameCurrent(frame)) return true
  if (latestActivePreviewTimestampsBySrc.size === 0) return true
  for (const [src, timestamps] of latestActivePreviewTimestampsBySrc) {
    for (const timestamp of timestamps) {
      if (
        !getCachedPredecodedBitmap(src, timestamp, PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS) &&
        !getCachedActivePreviewFallbackBitmap(
          src,
          timestamp,
          PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
        )
      ) {
        return false
      }
    }
  }
  return true
}

function isActivePreviewFrameExactDecodeReady(frame: number): boolean {
  if (!isActivePreviewFrameCurrent(frame)) return true
  if (latestActivePreviewTimestampsBySrc.size === 0) return true
  for (const [src, timestamps] of latestActivePreviewTimestampsBySrc) {
    for (const timestamp of timestamps) {
      if (!getCachedPredecodedBitmap(src, timestamp, PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS)) {
        return false
      }
    }
  }
  return true
}

export function isActivePreviewSourceTarget(
  src: string,
  timestamp: number,
  toleranceSeconds = PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
): boolean {
  if (!activePreviewScrubSession) return false
  const latestTimestamps = latestActivePreviewTimestampsBySrc.get(src)
  return (
    latestTimestamps?.some((target) => Math.abs(target - timestamp) <= toleranceSeconds) ?? false
  )
}

export function subscribeActivePreviewReady(
  listener: (src: string, timestamp: number) => void,
): () => void {
  activePreviewReadyListeners.add(listener)
  return () => activePreviewReadyListeners.delete(listener)
}

export function isActivePreviewTargetSuperseded(
  src: string,
  timestamp: number,
  toleranceSeconds = PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
): boolean {
  if (!activePreviewScrubSession) return false
  const latestTimestamps = latestActivePreviewTimestampsBySrc.get(src)
  return (
    latestTimestamps !== undefined && !isActivePreviewSourceTarget(src, timestamp, toleranceSeconds)
  )
}

export function backgroundPreseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  return startBackgroundPreseek(src, timestamp, true)
}

function startBackgroundPreseek(
  src: string,
  timestamp: number,
  countRequest: boolean,
): Promise<ImageBitmap | null> {
  if (countRequest) {
    decoderPrewarmMetrics.requests += 1
  }

  // Cache and inflight-reuse hits need zero worker capacity — check them before
  // the saturation guard so a saturated pool still serves already-decoded frames.
  const cachedBitmap = getCachedPredecodedBitmap(
    src,
    timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (cachedBitmap) {
    decoderPrewarmMetrics.cacheHits += 1
    return Promise.resolve(cachedBitmap)
  }

  const inflightMatch = findMatchingInflightPreseek(
    src,
    timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (inflightMatch) {
    decoderPrewarmMetrics.inflightReuses += 1
    return inflightMatch.promise
  }

  // Genuinely new decode work: retain only the latest target per source when
  // every worker is busy. The bounded queue prevents stale scrub/playback
  // requests from growing without limit while still using the next free worker.
  const pw = acquireWorker()
  if (!pw) {
    return workerPool.length > 0 ? queueLatestPreseek(src, timestamp) : Promise.resolve(null)
  }

  const id = `preseek-${++requestId}`
  const promise = new Promise<ImageBitmap | null>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      releaseWorker(pw)
      resolve(null)
    }, 5000)

    pendingRequests.set(id, {
      resolve: (bitmap) => {
        clearTimeout(timeout)
        releaseWorker(pw)
        if (bitmap) {
          decoderPrewarmMetrics.workerSuccesses += 1
          cachePredecodedBitmap(src, timestamp, bitmap)
        } else {
          decoderPrewarmMetrics.workerFailures += 1
        }
        resolve(bitmap)
      },
    })

    // Send the blob directly to avoid slow UrlSource fetch in the worker.
    // Blobs are transferred via structured clone — fast and avoids re-fetch.
    const w = pw.worker

    // Include keyframe index on first preseek per source so worker can
    // do adaptive backtracking instead of fixed 1-second backtrack
    let keyframeTimestamps: number[] | undefined
    if (!keyframesSentForSrc.has(src)) {
      keyframeTimestamps = getKeyframeTimestamps(src)
      if (keyframeTimestamps) keyframesSentForSrc.add(src)
    }

    const sourceMetadata = getDirectSourceMetadata(src)
    const postRequest = (blob?: Blob) => {
      if (!pendingRequests.has(id)) {
        return
      }
      decoderPrewarmMetrics.workerPosts += 1
      w.postMessage(
        blob
          ? { type: 'preseek', id, src, timestamp, blob, keyframeTimestamps, sourceMetadata }
          : { type: 'preseek', id, src, timestamp, keyframeTimestamps, sourceMetadata },
      )
    }

    const failRequest = () => {
      const pending = pendingRequests.get(id)
      if (!pending) {
        return
      }
      pendingRequests.delete(id)
      pending.resolve(null)
    }

    if (sourceMetadata) {
      postRequest()
    } else {
      const cachedBlob = getKnownBlobForUrl(src)
      if (cachedBlob) {
        postRequest(cachedBlob)
      } else if (src.startsWith('blob:')) {
        if (unavailableBlobUrls.has(src)) {
          failRequest()
          return
        }

        void resolveBlobForUrl(src).then((blob) => {
          if (blob) {
            postRequest(blob)
            return
          }
          failRequest()
        })
      } else {
        postRequest()
      }
    }
  })
  const inflightEntry: InflightPreseek = { timestamp, promise }
  addInflightPreseek(src, inflightEntry)
  void promise.finally(() => {
    removeInflightPreseek(src, inflightEntry)
  })
  return promise
}

/**
 * Batch pre-decode multiple timestamps for the same source in a single worker call.
 * Uses mediabunny's samplesAtTimestamps() which shares decoder state across the
 * batch — each packet decoded at most once. Much more efficient than individual
 * backgroundPreseek() calls when multiple timestamps are needed for the same source.
 *
 * All returned bitmaps are also cached in the per-source bitmap cache.
 */
export function backgroundBatchPreseek(
  src: string,
  timestamps: number[],
  options: {
    signal?: AbortSignal
    cacheCapacity?: number
    maxDimension?: number
  } = {},
): Promise<Map<number, ImageBitmap>> {
  const { signal, cacheCapacity, maxDimension } = options
  if (signal?.aborted) return Promise.resolve(new Map())
  const uniqueTimestamps = [...new Set(timestamps)].sort((a, b) => a - b)
  if (uniqueTimestamps.length === 0) return Promise.resolve(new Map())
  // For single timestamps, fall back to the simpler path
  if (
    uniqueTimestamps.length === 1 &&
    !signal &&
    cacheCapacity === undefined &&
    maxDimension === undefined
  ) {
    return backgroundPreseek(src, uniqueTimestamps[0]!).then((bitmap) => {
      const map = new Map<number, ImageBitmap>()
      if (bitmap) map.set(uniqueTimestamps[0]!, bitmap)
      return map
    })
  }

  const pw = acquireWorker()
  if (!pw) return Promise.resolve(new Map())

  const id = `batch-preseek-${++requestId}`

  let keyframeTimestamps: number[] | undefined
  if (!keyframesSentForSrc.has(src)) {
    keyframeTimestamps = getKeyframeTimestamps(src)
    if (keyframeTimestamps) keyframesSentForSrc.add(src)
  }

  const promise = new Promise<Map<number, ImageBitmap>>((resolve) => {
    let settled = false
    let requestPosted = false
    let requestCancelled = false
    const settleCaller = (bitmaps: Map<number, ImageBitmap>) => {
      if (settled) return
      settled = true
      resolve(bitmaps)
    }
    const timeout = setTimeout(() => {
      pendingBatchRequests.delete(id)
      releaseWorker(pw)
      signal?.removeEventListener('abort', cancel)
      if (requestPosted) pw.worker.postMessage({ type: 'batch_cancel', id })
      settleCaller(new Map())
    }, 8000)

    const finishRequest = (bitmaps: Map<number, ImageBitmap>) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
      releaseWorker(pw)
      if (requestCancelled) {
        for (const bitmap of bitmaps.values()) bitmap.close()
      } else {
        for (const [ts, bitmap] of bitmaps) {
          cachePredecodedBitmap(src, ts, bitmap, cacheCapacity)
        }
      }
      settleCaller(requestCancelled ? new Map() : bitmaps)
    }
    const cancel = () => {
      if (requestCancelled) return
      requestCancelled = true
      if (requestPosted) {
        pw.worker.postMessage({ type: 'batch_cancel', id })
      } else {
        pendingBatchRequests.delete(id)
        clearTimeout(timeout)
        releaseWorker(pw)
      }
      settleCaller(new Map())
    }
    pendingBatchRequests.set(id, { resolve: finishRequest, cancel })
    signal?.addEventListener('abort', cancel, { once: true })

    const w = pw.worker
    const sourceMetadata = getDirectSourceMetadata(src)
    const postRequest = (blob?: Blob) => {
      if (signal?.aborted) {
        cancel()
        return
      }
      if (!pendingBatchRequests.has(id)) {
        return
      }
      requestPosted = true
      decoderPrewarmMetrics.workerPosts += 1
      const msg = blob
        ? {
            type: 'batch_preseek',
            id,
            src,
            timestamps: uniqueTimestamps,
            keyframeTimestamps,
            blob,
            sourceMetadata,
            maxDimension,
          }
        : {
            type: 'batch_preseek',
            id,
            src,
            timestamps: uniqueTimestamps,
            keyframeTimestamps,
            sourceMetadata,
            maxDimension,
          }
      w.postMessage(msg)
    }

    const failRequest = () => {
      const pending = pendingBatchRequests.get(id)
      if (!pending) {
        return
      }
      pendingBatchRequests.delete(id)
      pending.resolve(new Map())
    }

    if (sourceMetadata) {
      postRequest()
    } else {
      const cachedBlob = getKnownBlobForUrl(src)
      if (cachedBlob) {
        postRequest(cachedBlob)
      } else if (src.startsWith('blob:')) {
        if (unavailableBlobUrls.has(src)) {
          failRequest()
          return
        }

        void resolveBlobForUrl(src).then((blob) => {
          if (blob) {
            postRequest(blob)
            return
          }
          failRequest()
        })
      } else {
        postRequest()
      }
    }
  })

  for (const timestamp of uniqueTimestamps) {
    const inflightEntry: InflightPreseek = {
      timestamp,
      promise: promise.then((bitmaps) => bitmaps.get(timestamp) ?? null),
    }
    addInflightPreseek(src, inflightEntry)
    void inflightEntry.promise.finally(() => {
      removeInflightPreseek(src, inflightEntry)
    })
  }

  return promise
}

/**
 * Get a pre-decoded bitmap from the cache for a video source.
 * Returns the bitmap if it exists and is for a nearby timestamp.
 */
export function getCachedPredecodedBitmap(
  src: string,
  timestamp: number,
  toleranceSeconds = 0.5,
): ImageBitmap | null {
  return findClosestBitmapEntry(src, timestamp, toleranceSeconds)?.bitmap ?? null
}

export async function waitForInflightPredecodedBitmap(
  src: string,
  timestamp: number,
  toleranceSeconds = 0.5,
  maxWaitMs = 12,
): Promise<ImageBitmap | null> {
  decoderPrewarmMetrics.waitRequests += 1
  const inflight = findMatchingInflightPreseek(src, timestamp, toleranceSeconds)
  if (!inflight) return null
  decoderPrewarmMetrics.waitMatches += 1

  let resolved: ImageBitmap | null = null
  if (maxWaitMs <= 0) {
    resolved = await inflight.promise
    if (resolved) {
      decoderPrewarmMetrics.waitResolved += 1
    }
  } else {
    resolved = await new Promise<ImageBitmap | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        decoderPrewarmMetrics.waitTimeouts += 1
        resolve(null)
      }, maxWaitMs)

      void inflight.promise
        .then((bitmap) => {
          clearTimeout(timeoutId)
          if (bitmap) {
            decoderPrewarmMetrics.waitResolved += 1
          }
          resolve(bitmap)
        })
        .catch(() => {
          clearTimeout(timeoutId)
          resolve(null)
        })
    })
  }

  if (!resolved) {
    return getCachedPredecodedBitmap(src, timestamp, toleranceSeconds)
  }

  // A superseded worker request may resolve after its consumer has moved to a
  // newer target. Only return a bitmap that is indexed at the requested source
  // timestamp; never draw an unverified worker result as an exact scrub frame.
  return getCachedPredecodedBitmap(src, timestamp, toleranceSeconds)
}

/**
 * Clear cached bitmaps for a source.
 */
function clearPredecodedCache(src?: string): void {
  if (src) {
    const entries = bitmapCache.get(src)
    if (entries) {
      for (const entry of entries) entry.bitmap.close()
    }
    bitmapCache.delete(src)
    bitmapCacheCapacityBySrc.delete(src)
    const fallbackEntries = fallbackBitmapCache.get(src)
    for (const entry of fallbackEntries ?? []) entry.bitmap.close()
    fallbackBitmapCache.delete(src)
    blobByUrl.delete(src)
    unavailableBlobUrls.delete(src)
    keyframesSentForSrc.delete(src)
  } else {
    for (const entries of bitmapCache.values()) {
      for (const entry of entries) entry.bitmap.close()
    }
    bitmapCache.clear()
    bitmapCacheCapacityBySrc.clear()
    for (const entries of fallbackBitmapCache.values()) {
      for (const entry of entries) entry.bitmap.close()
    }
    fallbackBitmapCache.clear()
    blobByUrl.clear()
    unavailableBlobUrls.clear()
    keyframesSentForSrc.clear()
  }
}

/**
 * Cache sizes are derived at snapshot time instead of being recomputed (spread
 * + reduce over every cached source) on each decoded frame.
 */
function refreshCacheMetrics(): void {
  decoderPrewarmMetrics.cacheSources = bitmapCache.size
  decoderPrewarmMetrics.cacheBitmaps = [...bitmapCache.values()].reduce(
    (sum, sourceEntries) => sum + sourceEntries.length,
    0,
  )
  decoderPrewarmMetrics.fallbackBitmaps = [...fallbackBitmapCache.values()].reduce(
    (sum, sourceEntries) => sum + sourceEntries.length,
    0,
  )
}

/**
 * Dispose all workers in the pool and clean up.
 */
export function disposePrewarmWorker(): void {
  for (const inflight of activePreviewInflightById.values()) {
    pendingRequests.delete(inflight.id)
    settleActivePreviewRequest(inflight, null)
  }
  activePreviewInflightById.clear()
  for (const queued of queuedActivePreviewRequestsBySrc.values()) {
    settleActivePreviewRequest(queued, null)
  }
  queuedActivePreviewRequestsBySrc.clear()
  activePreviewWorker?.terminate()
  activePreviewWorker = null
  activePreviewGeneration = 0
  activePreviewRequestVersion = 0
  if (activePreviewSettleTimer !== null) clearTimeout(activePreviewSettleTimer)
  activePreviewSettleTimer = null
  activePreviewScrubSession = false
  latestActivePreviewTimelineFrame = null
  latestActivePreviewTimestampsBySrc.clear()
  activePreviewReadyListeners.clear()
  decoderPrewarmMetrics.activeWorkerReady = false
  for (const pw of workerPool) {
    pw.worker.terminate()
  }
  workerPool = []
  poolInitialized = false
  decoderPrewarmMetrics.poolSize = 0
  for (const queued of queuedPreseekBySrc.values()) {
    queued.resolve(null)
  }
  queuedPreseekBySrc.clear()
  for (const pending of pendingRequests.values()) {
    pending.resolve(null)
  }
  pendingRequests.clear()
  for (const pending of pendingBatchRequests.values()) {
    pending.resolve(new Map())
  }
  pendingBatchRequests.clear()
  inflightPreseekBySrc.clear()
  clearPredecodedCache()
}

export function getDecoderPrewarmMetricsSnapshot(): DecoderPrewarmMetricsSnapshot {
  refreshCacheMetrics()
  return { ...decoderPrewarmMetrics }
}
