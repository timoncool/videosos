import { createLogger } from '@/shared/logging/logger'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  VideoFrameExtractor,
  type CaptureFrameResult,
  type DrawFrameCaptureResult,
  type VideoDrawContinuationCheck,
} from './canvas-video-extractor'

const log = createLogger('SharedVideoExtractorPool')

export type VideoFrameFailureKind = 'none' | 'no-sample' | 'decode-error'

export interface VideoFrameSource {
  init(): Promise<boolean>
  drawFrame(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<boolean>
  drawFrameWithCapture(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<DrawFrameCaptureResult>
  captureFrame(
    timestamp: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<CaptureFrameResult>
  getLastFailureKind(): VideoFrameFailureKind
  getDimensions(): { width: number; height: number }
  getDuration(): number
  /** Whether the source may carry alpha (transparent video). False until init resolves it. */
  getCanBeTransparent(): boolean
  prewarmBatch(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamps: number[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<number>
  isBatchPrewarmAvailable(): boolean
  dispose(): void
}

interface SourceLane {
  extractor: VideoFrameExtractor
  initialized: boolean
  initPromise: Promise<boolean> | null
  /** Serializes drawFrame calls to prevent concurrent mutable-state corruption. */
  drawLock: Promise<void> | null
}

interface SourceState {
  src: string
  lanes: SourceLane[]
  itemLaneById: Map<string, number>
  laneAssignments: number[]
  sourceInitPromise: Promise<boolean> | null
  sourceInitAttempted: boolean
  sourceReady: boolean
  lastUsed: number
  activeOperations: number
  dimensions: { width: number; height: number }
  duration: number
}

const DEFAULT_MAX_LANES_PER_SOURCE = 4
const DEFAULT_MAX_ACTIVE_SOURCES = Number.POSITIVE_INFINITY
const PREVIEW_MAX_ACTIVE_SOURCES = 6

export interface SharedVideoExtractorPoolStats {
  registeredBindings: number
  sourceStates: number
  initializedSources: number
  lanes: number
  activeOperations: number
  peakInitializedSources: number
  sourceEvictions: number
  lanesCreated: number
}

interface SharedVideoExtractorPoolOptions {
  maxLanesPerSource?: number
  maxActiveSources?: number
  logFrameFailuresAsDebug?: boolean
  onStatsChange?: (stats: SharedVideoExtractorPoolStats) => void
}

export interface SharedPreviewVideoExtractorPoolLease {
  pool: SharedVideoExtractorPool
  release(): void
}

type PreviewExtractorDebugGlobal = typeof globalThis & {
  __PREVIEW_VIDEO_EXTRACTOR_STATS__?: SharedVideoExtractorPoolStats & { leases: number }
}

let sharedPreviewPoolState:
  | {
      pool: SharedVideoExtractorPool
      leases: number
    }
  | undefined
const SHOULD_PUBLISH_PREVIEW_EXTRACTOR_STATS =
  import.meta.env.DEV || import.meta.env.MODE === 'perf'

function bindingKey(itemId: string, src: string): string {
  return `${itemId}\u0000${src}`
}

function publishSharedPreviewPoolStats(): void {
  if (!SHOULD_PUBLISH_PREVIEW_EXTRACTOR_STATS) return
  if (!sharedPreviewPoolState) return
  ;(globalThis as PreviewExtractorDebugGlobal).__PREVIEW_VIDEO_EXTRACTOR_STATS__ = {
    ...sharedPreviewPoolState.pool.getStats(),
    leases: sharedPreviewPoolState.leases,
  }
}

/**
 * Preview canvases (main overlay, scopes, transitions, comparisons) render the
 * same project media. Share their decoder lanes so compatible renderer
 * instances do not each open the same source independently.
 */
export function acquireSharedPreviewVideoExtractorPool(): SharedPreviewVideoExtractorPoolLease {
  if (!sharedPreviewPoolState) {
    const pool = new SharedVideoExtractorPool({
      maxLanesPerSource: DEFAULT_MAX_LANES_PER_SOURCE,
      maxActiveSources: PREVIEW_MAX_ACTIVE_SOURCES,
      logFrameFailuresAsDebug: true,
      onStatsChange: SHOULD_PUBLISH_PREVIEW_EXTRACTOR_STATS
        ? publishSharedPreviewPoolStats
        : undefined,
    })
    sharedPreviewPoolState = { pool, leases: 0 }
  }

  const state = sharedPreviewPoolState
  state.leases += 1
  publishSharedPreviewPoolStats()

  let released = false
  return {
    pool: state.pool,
    release() {
      if (released) return
      released = true
      if (sharedPreviewPoolState !== state) return
      state.leases = Math.max(0, state.leases - 1)
      if (state.leases === 0) {
        state.pool.dispose()
        sharedPreviewPoolState = undefined
        delete (globalThis as PreviewExtractorDebugGlobal).__PREVIEW_VIDEO_EXTRACTOR_STATS__
        return
      }
      publishSharedPreviewPoolStats()
    },
  }
}

class SharedItemVideoSource implements VideoFrameSource {
  constructor(
    private readonly pool: SharedVideoExtractorPool,
    private readonly itemId: string,
    private readonly src: string,
  ) {}

  init(): Promise<boolean> {
    return this.pool.initSource(this.src)
  }

  drawFrame(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<boolean> {
    return this.pool.drawItemFrame(
      this.itemId,
      this.src,
      ctx,
      timestamp,
      x,
      y,
      width,
      height,
      shouldContinue,
    )
  }

  drawFrameWithCapture(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<DrawFrameCaptureResult> {
    return this.pool.drawItemFrameWithCapture(
      this.itemId,
      this.src,
      ctx,
      timestamp,
      x,
      y,
      width,
      height,
      shouldContinue,
    )
  }

  captureFrame(
    timestamp: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<CaptureFrameResult> {
    return this.pool.captureItemFrame(this.itemId, this.src, timestamp, shouldContinue)
  }

  getLastFailureKind(): VideoFrameFailureKind {
    return this.pool.getItemLastFailureKind(this.itemId, this.src)
  }

  getDimensions(): { width: number; height: number } {
    return this.pool.getItemDimensions(this.itemId, this.src)
  }

  getDuration(): number {
    return this.pool.getItemDuration(this.itemId, this.src)
  }

  getCanBeTransparent(): boolean {
    return this.pool.getItemCanBeTransparent(this.itemId, this.src)
  }

  prewarmBatch(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamps: number[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<number> {
    return this.pool.prewarmItemBatch(this.itemId, this.src, ctx, timestamps, x, y, width, height)
  }

  isBatchPrewarmAvailable(): boolean {
    return this.pool.isItemBatchPrewarmAvailable(this.itemId, this.src)
  }

  // Shared lanes are owned/disposed by the pool.
  dispose(): void {}
}

export class SharedVideoExtractorPool {
  private readonly maxLanesPerSource: number
  private readonly maxActiveSources: number
  private readonly logFrameFailuresAsDebug: boolean
  private readonly onStatsChange?: (stats: SharedVideoExtractorPoolStats) => void
  private sourceStates = new Map<string, SourceState>()
  private itemSources = new Map<string, string>()
  private itemWrappers = new Map<string, SharedItemVideoSource>()
  private itemRefCounts = new Map<string, number>()
  private laneIdCounter = 0
  private peakInitializedSources = 0
  private sourceEvictions = 0
  private lanesCreated = 0

  constructor(options: SharedVideoExtractorPoolOptions = {}) {
    this.maxLanesPerSource = Math.max(1, options?.maxLanesPerSource ?? DEFAULT_MAX_LANES_PER_SOURCE)
    this.maxActiveSources = Math.max(1, options.maxActiveSources ?? DEFAULT_MAX_ACTIVE_SOURCES)
    this.logFrameFailuresAsDebug = options?.logFrameFailuresAsDebug === true
    this.onStatsChange = options.onStatsChange
  }

  getOrCreateItemExtractor(itemId: string, src: string): VideoFrameSource {
    const key = bindingKey(itemId, src)
    const existing = this.itemWrappers.get(key)
    if (existing) {
      this.itemRefCounts.set(key, (this.itemRefCounts.get(key) ?? 0) + 1)
      this.notifyStatsChanged()
      return existing
    }

    this.itemSources.set(key, src)
    this.ensureSourceState(src)

    const wrapper = new SharedItemVideoSource(this, itemId, src)
    this.itemWrappers.set(key, wrapper)
    this.itemRefCounts.set(key, 1)
    this.notifyStatsChanged()
    return wrapper
  }

  async initSource(src: string): Promise<boolean> {
    const state = this.ensureSourceState(src)
    if (state.sourceReady) return true
    if (state.sourceInitAttempted) return false
    if (state.sourceInitPromise) return state.sourceInitPromise

    state.sourceInitPromise = (async () => {
      this.touchSource(state)
      this.ensurePrimaryLane(state)
      const ready = await this.ensureLaneInitialized(state, 0)
      state.sourceInitAttempted = true
      state.sourceReady = ready
      if (ready) {
        this.evictExcessActiveSources(src)
        this.peakInitializedSources = Math.max(
          this.peakInitializedSources,
          [...this.sourceStates.values()].filter((candidate) => candidate.sourceReady).length,
        )
      }
      this.notifyStatsChanged()
      return ready
    })().finally(() => {
      state.sourceInitPromise = null
    })

    return state.sourceInitPromise
  }

  releaseItem(itemId: string, src?: string): void {
    const keys = src
      ? [bindingKey(itemId, src)]
      : [...this.itemSources.keys()].filter((key) => key.startsWith(`${itemId}\u0000`))

    for (const key of keys) {
      const boundSrc = this.itemSources.get(key)
      if (!boundSrc) continue
      const refCount = this.itemRefCounts.get(key) ?? 0
      if (refCount > 1) {
        this.itemRefCounts.set(key, refCount - 1)
        continue
      }

      this.unassignItem(itemId, boundSrc)
      this.itemWrappers.get(key)?.dispose()
      this.itemSources.delete(key)
      this.itemWrappers.delete(key)
      this.itemRefCounts.delete(key)
      this.pruneIdleSource(boundSrc)
    }
    this.notifyStatsChanged()
  }

  async drawItemFrame(
    itemId: string,
    src: string,
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<boolean> {
    if (shouldContinue && !shouldContinue()) return false
    const state = this.ensureSourceState(src)
    return this.withSourceOperation(state, async () => {
      const sourceReady = await this.initSource(src)
      if (!sourceReady) return false

      // Serialize drawFrame calls per lane to prevent concurrent mutable-state corruption
      // inside VideoFrameExtractor (ensureSampleForTimestamp / recoverAndPrime).
      const lane = await this.getInitializedLaneForItem(state, itemId)
      if (!lane) return false
      const prev = lane.drawLock ?? Promise.resolve()
      const result = prev.then(() =>
        lane.extractor.drawFrame(ctx, timestamp, x, y, width, height, shouldContinue),
      )
      lane.drawLock = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    })
  }

  async drawItemFrameWithCapture(
    itemId: string,
    src: string,
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<DrawFrameCaptureResult> {
    if (shouldContinue && !shouldContinue()) {
      return { success: false, capturedFrame: null, capturedSourceTime: null }
    }
    const state = this.ensureSourceState(src)
    return this.withSourceOperation(state, async () => {
      const sourceReady = await this.initSource(src)
      if (!sourceReady) {
        return { success: false, capturedFrame: null, capturedSourceTime: null }
      }

      const lane = await this.getInitializedLaneForItem(state, itemId)
      if (!lane) return { success: false, capturedFrame: null, capturedSourceTime: null }
      const prev = lane.drawLock ?? Promise.resolve()
      const result = prev.then(() =>
        lane.extractor.drawFrameWithCapture(ctx, timestamp, x, y, width, height, shouldContinue),
      )
      lane.drawLock = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    })
  }

  async captureItemFrame(
    itemId: string,
    src: string,
    timestamp: number,
    shouldContinue?: VideoDrawContinuationCheck,
  ): Promise<CaptureFrameResult> {
    if (shouldContinue && !shouldContinue()) {
      return { success: false, frame: null, sourceTime: null }
    }
    const state = this.ensureSourceState(src)
    return this.withSourceOperation(state, async () => {
      const sourceReady = await this.initSource(src)
      if (!sourceReady) {
        return { success: false, frame: null, sourceTime: null }
      }

      const lane = await this.getInitializedLaneForItem(state, itemId)
      if (!lane) return { success: false, frame: null, sourceTime: null }
      const prev = lane.drawLock ?? Promise.resolve()
      const result = prev.then(() => lane.extractor.captureFrame(timestamp, shouldContinue))
      lane.drawLock = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    })
  }

  getItemLastFailureKind(itemId: string, src: string): VideoFrameFailureKind {
    const extractor = this.getExtractorForItem(itemId, src)
    return extractor?.getLastFailureKind() ?? 'none'
  }

  getItemDimensions(itemId: string, src: string): { width: number; height: number } {
    const extractor = this.getExtractorForItem(itemId, src)
    return (
      extractor?.getDimensions() ??
      this.sourceStates.get(src)?.dimensions ?? {
        width: DEFAULT_PROJECT_WIDTH,
        height: DEFAULT_PROJECT_HEIGHT,
      }
    )
  }

  getItemDuration(itemId: string, src: string): number {
    const extractor = this.getExtractorForItem(itemId, src)
    return extractor?.getDuration() ?? this.sourceStates.get(src)?.duration ?? 0
  }

  getItemCanBeTransparent(itemId: string, src: string): boolean {
    const extractor = this.getExtractorForItem(itemId, src)
    return extractor?.getCanBeTransparent() ?? false
  }

  /**
   * Batch prewarm via the first lane's extractor. samplesAtTimestamps creates
   * its own independent decode pipeline, so it doesn't conflict with the
   * persistent samples() iterator used by drawFrame.
   */
  async prewarmItemBatch(
    itemId: string,
    src: string,
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamps: number[],
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<number> {
    const state = this.ensureSourceState(src)
    return this.withSourceOperation(state, async () => {
      if (!(await this.initSource(src))) return -1
      const extractor = this.getExtractorForItem(itemId, src)
      if (!extractor) return -1
      return extractor.prewarmBatch(ctx, timestamps, x, y, width, height)
    })
  }

  isItemBatchPrewarmAvailable(itemId: string, src: string): boolean {
    const extractor = this.getExtractorForItem(itemId, src)
    return extractor?.isBatchPrewarmAvailable() ?? false
  }

  getStats(): SharedVideoExtractorPoolStats {
    let initializedSources = 0
    let lanes = 0
    let activeOperations = 0
    for (const state of this.sourceStates.values()) {
      if (state.sourceReady) initializedSources += 1
      lanes += state.lanes.length
      activeOperations += state.activeOperations
    }
    return {
      registeredBindings: this.itemWrappers.size,
      sourceStates: this.sourceStates.size,
      initializedSources,
      lanes,
      activeOperations,
      peakInitializedSources: this.peakInitializedSources,
      sourceEvictions: this.sourceEvictions,
      lanesCreated: this.lanesCreated,
    }
  }

  dispose(): void {
    for (const state of this.sourceStates.values()) {
      for (const lane of state.lanes) {
        lane.extractor.dispose()
      }
      state.lanes = []
      state.itemLaneById.clear()
      state.laneAssignments = []
      state.sourceInitPromise = null
      state.sourceReady = false
    }
    this.sourceStates.clear()
    this.itemSources.clear()
    this.itemWrappers.clear()
    this.itemRefCounts.clear()
    this.notifyStatsChanged()
  }

  private ensureSourceState(src: string): SourceState {
    let state = this.sourceStates.get(src)
    if (!state) {
      state = {
        src,
        lanes: [],
        itemLaneById: new Map<string, number>(),
        laneAssignments: [],
        sourceInitPromise: null,
        sourceInitAttempted: false,
        sourceReady: false,
        lastUsed: performance.now(),
        activeOperations: 0,
        dimensions: { width: DEFAULT_PROJECT_WIDTH, height: DEFAULT_PROJECT_HEIGHT },
        duration: 0,
      }
      this.sourceStates.set(src, state)
      this.notifyStatsChanged()
    }
    return state
  }

  private createLane(src: string): SourceLane {
    const extractorId = `shared-video-${++this.laneIdCounter}`
    this.lanesCreated += 1
    return {
      extractor: new VideoFrameExtractor(src, extractorId, {
        logFrameFailuresAsDebug: this.logFrameFailuresAsDebug,
      }),
      initialized: false,
      initPromise: null,
      drawLock: null,
    }
  }

  private async ensureLaneInitialized(state: SourceState, laneIndex: number): Promise<boolean> {
    if (laneIndex < 0 || laneIndex >= state.lanes.length) return false
    const lane = state.lanes[laneIndex]!
    if (lane.initialized) return true
    if (lane.initPromise) return lane.initPromise

    lane.initPromise = lane.extractor
      .init()
      .then((ok) => {
        lane.initialized = ok
        if (ok) {
          state.dimensions = lane.extractor.getDimensions()
          state.duration = lane.extractor.getDuration()
        }
        return ok
      })
      .catch((error) => {
        log.warn('Shared lane initialization failed', { laneIndex, src: state.src, error })
        lane.initialized = false
        return false
      })
      .finally(() => {
        lane.initPromise = null
      })

    return lane.initPromise
  }

  private async getInitializedLaneForItem(
    state: SourceState,
    itemId: string,
  ): Promise<SourceLane | null> {
    this.ensurePrimaryLane(state)
    let laneIndex = this.getAssignedLaneIndex(state, itemId)
    let laneReady = await this.ensureLaneInitialized(state, laneIndex)

    if (!laneReady && laneIndex !== 0) {
      laneIndex = 0
      laneReady = await this.ensureLaneInitialized(state, laneIndex)
    }

    return laneReady ? (state.lanes[laneIndex] ?? null) : null
  }

  private getAssignedLaneIndex(state: SourceState, itemId: string): number {
    this.ensurePrimaryLane(state)
    const existing = state.itemLaneById.get(itemId)
    if (existing !== undefined) return existing

    let bestLane = 0
    let bestAssignments = Number.POSITIVE_INFINITY
    for (let i = 0; i < state.laneAssignments.length; i += 1) {
      const assignments = state.laneAssignments[i] ?? 0
      if (assignments < bestAssignments) {
        bestAssignments = assignments
        bestLane = i
      }
    }

    // Scale to a few lanes per source so simultaneous transition draws can
    // advance independent decode timelines without per-clip duplication.
    if (bestAssignments > 0 && state.lanes.length < this.maxLanesPerSource) {
      bestLane = state.lanes.length
      state.lanes.push(this.createLane(state.src))
      state.laneAssignments.push(0)
    }

    state.itemLaneById.set(itemId, bestLane)
    state.laneAssignments[bestLane] = (state.laneAssignments[bestLane] ?? 0) + 1
    return bestLane
  }

  private getExtractorForItem(itemId: string, src: string): VideoFrameExtractor | null {
    const state = this.sourceStates.get(src)
    if (!state) return null

    const laneIndex = state.itemLaneById.get(itemId) ?? 0
    const lane = state.lanes[laneIndex] ?? state.lanes[0]
    return lane?.extractor ?? null
  }

  private unassignItem(itemId: string, src: string): void {
    const state = this.sourceStates.get(src)
    if (!state) return

    const laneIndex = state.itemLaneById.get(itemId)
    if (laneIndex !== undefined) {
      state.itemLaneById.delete(itemId)
      const prev = state.laneAssignments[laneIndex] ?? 0
      state.laneAssignments[laneIndex] = Math.max(0, prev - 1)
    }
  }

  private pruneIdleSource(src: string): void {
    const state = this.sourceStates.get(src)
    if (!state) return
    if (state.itemLaneById.size > 0) return
    if (this.hasWrapperForSource(src)) return

    this.disposeSourceLanes(state)
    this.sourceStates.delete(src)
  }

  private hasWrapperForSource(src: string): boolean {
    for (const wrapperSrc of this.itemSources.values()) {
      if (wrapperSrc === src) return true
    }
    return false
  }

  private ensurePrimaryLane(state: SourceState): void {
    if (state.lanes.length > 0) return
    state.lanes.push(this.createLane(state.src))
    state.laneAssignments.push(0)
    this.notifyStatsChanged()
  }

  private touchSource(state: SourceState): void {
    state.lastUsed = performance.now()
  }

  private async withSourceOperation<T>(state: SourceState, run: () => Promise<T>): Promise<T> {
    state.activeOperations += 1
    this.touchSource(state)
    this.notifyStatsChanged()
    try {
      return await run()
    } finally {
      state.activeOperations = Math.max(0, state.activeOperations - 1)
      this.touchSource(state)
      this.evictExcessActiveSources(state.src)
      this.notifyStatsChanged()
    }
  }

  private evictExcessActiveSources(excludeSrc?: string): void {
    const active = [...this.sourceStates.values()].filter((state) => state.sourceReady)
    if (active.length <= this.maxActiveSources) return

    const candidates = active
      .filter(
        (state) =>
          state.src !== excludeSrc && state.activeOperations === 0 && !state.sourceInitPromise,
      )
      .sort((a, b) => a.lastUsed - b.lastUsed)

    let activeCount = active.length
    for (const state of candidates) {
      if (activeCount <= this.maxActiveSources) break
      this.disposeSourceLanes(state)
      this.sourceEvictions += 1
      activeCount -= 1
    }
  }

  private disposeSourceLanes(state: SourceState): void {
    for (const lane of state.lanes) {
      lane.extractor.dispose()
    }
    state.lanes = []
    state.itemLaneById.clear()
    state.laneAssignments = []
    state.sourceInitPromise = null
    state.sourceReady = false
    state.sourceInitAttempted = false
    this.notifyStatsChanged()
  }

  private notifyStatsChanged(): void {
    this.onStatsChange?.(this.getStats())
  }
}
