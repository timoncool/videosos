import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { TimelineTrack } from '@/types/timeline'
import { usePlaybackStore } from '@/shared/state/playback'
import { getPreloadWindowRange } from '../utils/preload-window'
import {
  getPreviewRuntimeSnapshotFromPlaybackState,
  resolvePreviewTransitionFromPlaybackStates,
} from '../utils/preview-state-coordinator'
import {
  PRELOAD_AHEAD_SECONDS,
  PRELOAD_BACKWARD_SCRUB_EXTRA_IDS,
  PRELOAD_BACKWARD_SCRUB_THROTTLE_MS,
  PRELOAD_BURST_EXTRA_IDS,
  PRELOAD_BURST_MAX_IDS_PER_TICK,
  PRELOAD_BURST_PASSES,
  PRELOAD_FORWARD_SCRUB_THROTTLE_MS,
  PRELOAD_SCAN_TIME_BUDGET_MS,
  PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS,
  PRELOAD_SKIP_ON_BACKWARD_SCRUB,
  getCostAdjustedBudget,
  getDirectionalScrubStartIndex,
  getFrameDirection,
  getPreloadBudget,
} from '../utils/preview-constants'
import type { PreviewInteractionMode } from '../utils/preview-interaction-mode'

type ResolveMediaBatchResult = {
  resolvedEntries: Array<{ mediaId: string; url: string }>
  failedIds: string[]
}

interface PreviewPreloadPerfState {
  preloadScanSamples: number
  preloadScanTotalMs: number
  preloadScanLastMs: number
  preloadBatchSamples: number
  preloadBatchTotalMs: number
  preloadBatchLastMs: number
  preloadBatchLastIds: number
  preloadCandidateIds: number
  preloadBudgetBase: number
  preloadBudgetAdjusted: number
  preloadWindowMaxCost: number
  preloadScanBudgetYields: number
  preloadContinuations: number
  preloadScrubDirection: -1 | 0 | 1
  preloadDirectionPenaltyCount: number
}

interface UsePreviewMediaPreloadParams {
  fps: number
  combinedTracks: TimelineTrack[]
  mediaResolveCostById: Map<string, number>
  previewPerfRef: MutableRefObject<PreviewPreloadPerfState>
  setResolvedUrls: Dispatch<SetStateAction<Map<string, string>>>
  isGizmoInteractingRef: MutableRefObject<boolean>
  unresolvedMediaIdSetRef: MutableRefObject<Set<string>>
  preloadResolveInFlightRef: MutableRefObject<boolean>
  preloadBurstRemainingRef: MutableRefObject<number>
  preloadScanTrackCursorRef: MutableRefObject<number>
  preloadScanItemCursorRef: MutableRefObject<number>
  preloadLastAnchorFrameRef: MutableRefObject<number | null>
  lastForwardScrubPreloadAtRef: MutableRefObject<number>
  lastBackwardScrubPreloadAtRef: MutableRefObject<number>
  getResolveRetryAt: (mediaId: string) => number
  resolveMediaBatch: (mediaIds: string[]) => Promise<ResolveMediaBatchResult>
  clearResolveRetryState: (mediaIds: string[]) => void
  removeUnresolvedMediaIds: (mediaIds: string[]) => void
  markResolveFailures: (mediaIds: string[]) => number | null
  scheduleResolveRetryWake: (retryAt: number | null) => void
  kickResolvePass: () => void
}

type PreloadTrackItem = TimelineTrack['items'][number]

interface PreloadScanContext {
  preloadStartFrame: number
  preloadEndFrame: number
  anchorFrame: number
  now: number
  costPenaltyFrames: number
  scrubDirection: -1 | 0 | 1
  scrubDirectionBiasFrames: number
  unresolvedSet: Set<string>
  mediaResolveCostById: Map<string, number>
  getResolveRetryAt: (mediaId: string) => number
}

interface PreloadScanAccumulator {
  scores: Map<string, number>
  maxActiveWindowCost: number
  directionPenaltyCount: number
}

function createPreloadScanAccumulator(): PreloadScanAccumulator {
  return { scores: new Map(), maxActiveWindowCost: 0, directionPenaltyCount: 0 }
}

function recordBackwardScrubSkip(
  previewPerfRef: MutableRefObject<PreviewPreloadPerfState>,
  interactionMode: PreviewInteractionMode,
  scrubDirection: -1 | 0 | 1,
): void {
  previewPerfRef.current.preloadCandidateIds = 0
  previewPerfRef.current.preloadBudgetBase = getPreloadBudget(interactionMode)
  previewPerfRef.current.preloadBudgetAdjusted = 0
  previewPerfRef.current.preloadWindowMaxCost = 0
  previewPerfRef.current.preloadScrubDirection = scrubDirection
  previewPerfRef.current.preloadDirectionPenaltyCount = 0
}

function resolvePreloadBudgets(options: {
  interactionMode: PreviewInteractionMode
  scrubDirection: -1 | 0 | 1
  burstActive: boolean
}): { baseMaxIdsPerTick: number; boostedBaseMaxIdsPerTick: number } {
  const { interactionMode, scrubDirection, burstActive } = options
  const baseMaxIdsPerTick = getPreloadBudget(interactionMode)
  const backwardScrubExtraIds =
    interactionMode === 'scrubbing' && scrubDirection < 0 ? PRELOAD_BACKWARD_SCRUB_EXTRA_IDS : 0
  const boostedBaseMaxIdsPerTick = burstActive
    ? Math.min(
        PRELOAD_BURST_MAX_IDS_PER_TICK,
        baseMaxIdsPerTick + PRELOAD_BURST_EXTRA_IDS + backwardScrubExtraIds,
      )
    : baseMaxIdsPerTick + backwardScrubExtraIds
  return { baseMaxIdsPerTick, boostedBaseMaxIdsPerTick }
}

function scorePreloadCandidate(
  scan: PreloadScanAccumulator,
  item: PreloadTrackItem,
  ctx: PreloadScanContext,
): void {
  if (!item.mediaId) return
  const itemEnd = item.from + item.durationInFrames
  if (item.from > ctx.preloadEndFrame || itemEnd < ctx.preloadStartFrame) return
  if (!ctx.unresolvedSet.has(item.mediaId) || ctx.getResolveRetryAt(item.mediaId) > ctx.now) return
  const mediaCost = ctx.mediaResolveCostById.get(item.mediaId) ?? 1
  if (mediaCost > scan.maxActiveWindowCost) {
    scan.maxActiveWindowCost = mediaCost
  }
  const distanceToPlayhead =
    ctx.anchorFrame < item.from
      ? item.from - ctx.anchorFrame
      : ctx.anchorFrame > itemEnd
        ? ctx.anchorFrame - itemEnd
        : 0
  const score = applyPreloadDirectionBias(
    scan,
    distanceToPlayhead + mediaCost * ctx.costPenaltyFrames,
    item,
    ctx,
  )
  keepBestPreloadScore(scan.scores, item.mediaId, score)
}

function applyPreloadDirectionBias(
  scan: PreloadScanAccumulator,
  score: number,
  item: PreloadTrackItem,
  ctx: PreloadScanContext,
): number {
  if (ctx.scrubDirection === 0) return score
  const itemCenterFrame = item.from + item.durationInFrames * 0.5
  const isDirectionAligned =
    ctx.scrubDirection > 0 ? itemCenterFrame >= ctx.anchorFrame : itemCenterFrame <= ctx.anchorFrame
  if (isDirectionAligned) return score
  scan.directionPenaltyCount += 1
  return score + ctx.scrubDirectionBiasFrames
}

function keepBestPreloadScore(scores: Map<string, number>, mediaId: string, score: number): void {
  const previousScore = scores.get(mediaId)
  if (previousScore === undefined || score < previousScore) {
    scores.set(mediaId, score)
  }
}

interface PreloadScanCursorRefs {
  preloadScanTrackCursorRef: MutableRefObject<number>
  preloadScanItemCursorRef: MutableRefObject<number>
}

function runScrubPreloadScan(options: {
  combinedTracks: TimelineTrack[]
  trackIndex: number
  anchorFrame: number
  scrubDirection: -1 | 0 | 1
  scanStartTime: number
  scan: PreloadScanAccumulator
  ctx: PreloadScanContext
  cursors: PreloadScanCursorRefs
}): boolean {
  const {
    combinedTracks,
    trackIndex,
    anchorFrame,
    scrubDirection,
    scanStartTime,
    scan,
    ctx,
    cursors,
  } = options
  const step = scrubDirection < 0 ? -1 : 1
  for (let trackCount = 0; trackCount < combinedTracks.length; trackCount++) {
    const currentTrackIndex = (trackIndex + trackCount) % combinedTracks.length
    const track = combinedTracks[currentTrackIndex]!
    const trackItems = track.items
    if (trackItems.length === 0) continue

    let localItemIndex = getDirectionalScrubStartIndex(trackItems, anchorFrame, scrubDirection)
    while (localItemIndex >= 0 && localItemIndex < trackItems.length) {
      scorePreloadCandidate(scan, trackItems[localItemIndex]!, ctx)
      if (performance.now() - scanStartTime >= PRELOAD_SCAN_TIME_BUDGET_MS) {
        cursors.preloadScanTrackCursorRef.current = currentTrackIndex
        cursors.preloadScanItemCursorRef.current = 0
        return true
      }
      localItemIndex += step
    }
  }

  cursors.preloadScanTrackCursorRef.current = (trackIndex + 1) % combinedTracks.length
  cursors.preloadScanItemCursorRef.current = 0
  return false
}

function runForwardPreloadScan(options: {
  combinedTracks: TimelineTrack[]
  trackIndex: number
  itemIndex: number
  scanStartTime: number
  scan: PreloadScanAccumulator
  ctx: PreloadScanContext
  cursors: PreloadScanCursorRefs
}): boolean {
  const { combinedTracks, scanStartTime, scan, ctx, cursors } = options
  let trackIndex = options.trackIndex
  let itemIndex = options.itemIndex
  for (let trackCount = 0; trackCount < combinedTracks.length; trackCount++) {
    const track = combinedTracks[trackIndex]!
    const trackItems = track.items
    const startItemIndex = trackCount === 0 ? itemIndex : 0

    for (
      let localItemIndex = startItemIndex;
      localItemIndex < trackItems.length;
      localItemIndex++
    ) {
      scorePreloadCandidate(scan, trackItems[localItemIndex]!, ctx)
      if (performance.now() - scanStartTime >= PRELOAD_SCAN_TIME_BUDGET_MS) {
        let nextTrackIndex = trackIndex
        let nextItemIndex = localItemIndex + 1
        if (nextItemIndex >= trackItems.length) {
          nextTrackIndex = (trackIndex + 1) % combinedTracks.length
          nextItemIndex = 0
        }
        cursors.preloadScanTrackCursorRef.current = nextTrackIndex
        cursors.preloadScanItemCursorRef.current = nextItemIndex
        return true
      }
    }

    trackIndex = (trackIndex + 1) % combinedTracks.length
    itemIndex = 0
  }

  cursors.preloadScanTrackCursorRef.current = trackIndex
  cursors.preloadScanItemCursorRef.current = 0
  return false
}

function finalizePreloadScanMetrics(options: {
  previewPerfRef: MutableRefObject<PreviewPreloadPerfState>
  scanDurationMs: number
  reachedScanTimeBudget: boolean
  scan: PreloadScanAccumulator
  boostedBaseMaxIdsPerTick: number
  baseMaxIdsPerTick: number
  scrubDirection: -1 | 0 | 1
}): number {
  const {
    previewPerfRef,
    scanDurationMs,
    reachedScanTimeBudget,
    scan,
    boostedBaseMaxIdsPerTick,
    baseMaxIdsPerTick,
    scrubDirection,
  } = options
  previewPerfRef.current.preloadScanSamples += 1
  previewPerfRef.current.preloadScanTotalMs += scanDurationMs
  previewPerfRef.current.preloadScanLastMs = scanDurationMs
  if (reachedScanTimeBudget) {
    previewPerfRef.current.preloadScanBudgetYields += 1
  }

  const maxIdsPerTick = getCostAdjustedBudget(boostedBaseMaxIdsPerTick, scan.maxActiveWindowCost)
  previewPerfRef.current.preloadCandidateIds = scan.scores.size
  previewPerfRef.current.preloadBudgetBase = baseMaxIdsPerTick
  previewPerfRef.current.preloadBudgetAdjusted = maxIdsPerTick
  previewPerfRef.current.preloadWindowMaxCost = scan.maxActiveWindowCost
  previewPerfRef.current.preloadScrubDirection = scrubDirection
  previewPerfRef.current.preloadDirectionPenaltyCount = scan.directionPenaltyCount
  return maxIdsPerTick
}

function selectPreloadBatch(scores: Map<string, number>, maxIdsPerTick: number): string[] {
  return [...scores.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, maxIdsPerTick)
    .map(([mediaId]) => mediaId)
}

function applyResolvedMediaEntries(options: {
  resolvedEntries: Array<{ mediaId: string; url: string }>
  unresolvedMediaIdSetRef: MutableRefObject<Set<string>>
  setResolvedUrls: Dispatch<SetStateAction<Map<string, string>>>
  clearResolveRetryState: (mediaIds: string[]) => void
  removeUnresolvedMediaIds: (mediaIds: string[]) => void
}): void {
  const {
    resolvedEntries,
    unresolvedMediaIdSetRef,
    setResolvedUrls,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
  } = options
  if (resolvedEntries.length === 0) return
  const resolvedNow: string[] = []
  const applicableEntries: Array<{ mediaId: string; url: string }> = []
  for (const entry of resolvedEntries) {
    if (!unresolvedMediaIdSetRef.current.has(entry.mediaId)) continue
    resolvedNow.push(entry.mediaId)
    applicableEntries.push(entry)
  }
  setResolvedUrls((prevUrls) => {
    const nextUrls = new Map(prevUrls)
    let changed = false
    for (const entry of applicableEntries) {
      if (nextUrls.get(entry.mediaId) === entry.url) continue
      nextUrls.set(entry.mediaId, entry.url)
      changed = true
    }
    return changed ? nextUrls : prevUrls
  })
  clearResolveRetryState(resolvedNow)
  removeUnresolvedMediaIds(resolvedNow)
}

function scheduleResolveFailureRetries(options: {
  failedIds: string[]
  markResolveFailures: (mediaIds: string[]) => number | null
  scheduleResolveRetryWake: (retryAt: number | null) => void
}): void {
  const { failedIds, markResolveFailures, scheduleResolveRetryWake } = options
  if (failedIds.length === 0) return
  const retryAt = markResolveFailures(failedIds)
  if (retryAt !== null) {
    scheduleResolveRetryWake(retryAt)
  }
}

type PreloadTransition = ReturnType<typeof resolvePreviewTransitionFromPlaybackStates>

type PreloadSubscriptionAction =
  | { kind: 'start_playing' }
  | { kind: 'scrub_enter_burst' }
  | { kind: 'scrub_frame' }
  | { kind: 'paused_frame'; burst: boolean }
  | { kind: 'stop_playing' }
  | { kind: 'none' }

function classifyScrubPreload(
  previewDelta: number,
  lastBackwardScrubPreloadAtRef: MutableRefObject<number>,
  lastForwardScrubPreloadAtRef: MutableRefObject<number>,
): 'run' | 'skip' {
  if (previewDelta < 0) {
    if (PRELOAD_SKIP_ON_BACKWARD_SCRUB) return 'skip'
    const nowMs = performance.now()
    if (nowMs - lastBackwardScrubPreloadAtRef.current < PRELOAD_BACKWARD_SCRUB_THROTTLE_MS) {
      return 'skip'
    }
    lastBackwardScrubPreloadAtRef.current = nowMs
    return 'run'
  }
  if (previewDelta > 0) {
    const nowMs = performance.now()
    if (nowMs - lastForwardScrubPreloadAtRef.current < PRELOAD_FORWARD_SCRUB_THROTTLE_MS) {
      return 'skip'
    }
    lastForwardScrubPreloadAtRef.current = nowMs
  }
  return 'run'
}

function resolvePreloadSubscriptionAction(options: {
  transition: PreloadTransition
  state: { previewFrame?: number | null }
  prevState: { previewFrame?: number | null }
  lastBackwardScrubPreloadAtRef: MutableRefObject<number>
  lastForwardScrubPreloadAtRef: MutableRefObject<number>
}): PreloadSubscriptionAction {
  const {
    transition,
    state,
    prevState,
    lastBackwardScrubPreloadAtRef,
    lastForwardScrubPreloadAtRef,
  } = options
  const interactionMode = transition.next.mode
  if (transition.enteredPlaying) return { kind: 'start_playing' }
  if (transition.preloadBurstTrigger === 'scrub_enter') return { kind: 'scrub_enter_burst' }
  if (interactionMode === 'scrubbing' && transition.previewFrameChanged) {
    const previewDelta = (state.previewFrame ?? 0) - (prevState.previewFrame ?? 0)
    const verdict = classifyScrubPreload(
      previewDelta,
      lastBackwardScrubPreloadAtRef,
      lastForwardScrubPreloadAtRef,
    )
    return verdict === 'run' ? { kind: 'scrub_frame' } : { kind: 'none' }
  }
  if (
    interactionMode !== 'playing' &&
    interactionMode !== 'scrubbing' &&
    transition.currentFrameChanged
  ) {
    return { kind: 'paused_frame', burst: transition.preloadBurstTrigger === 'paused_short_seek' }
  }
  if (transition.exitedPlaying) return { kind: 'stop_playing' }
  return { kind: 'none' }
}

export function usePreviewMediaPreload({
  fps,
  combinedTracks,
  mediaResolveCostById,
  previewPerfRef,
  setResolvedUrls,
  isGizmoInteractingRef,
  unresolvedMediaIdSetRef,
  preloadResolveInFlightRef,
  preloadBurstRemainingRef,
  preloadScanTrackCursorRef,
  preloadScanItemCursorRef,
  preloadLastAnchorFrameRef,
  lastForwardScrubPreloadAtRef,
  lastBackwardScrubPreloadAtRef,
  getResolveRetryAt,
  resolveMediaBatch,
  clearResolveRetryState,
  removeUnresolvedMediaIds,
  markResolveFailures,
  scheduleResolveRetryWake,
  kickResolvePass,
}: UsePreviewMediaPreloadParams) {
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    let continuationTimeoutId: ReturnType<typeof setTimeout> | null = null

    const schedulePreloadContinuation = () => {
      if (continuationTimeoutId !== null) return
      previewPerfRef.current.preloadContinuations += 1
      continuationTimeoutId = setTimeout(() => {
        continuationTimeoutId = null
        void preloadMedia()
      }, 16)
    }

    const preloadMedia = async () => {
      if (preloadResolveInFlightRef.current) return
      if (combinedTracks.length === 0) return
      const burstActive = preloadBurstRemainingRef.current > 0
      if (burstActive) {
        preloadBurstRemainingRef.current = Math.max(0, preloadBurstRemainingRef.current - 1)
      }

      const playbackState = usePlaybackStore.getState()
      const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
        playbackState,
        isGizmoInteractingRef.current,
      )
      const interactionMode = runtimeSnapshot.mode
      const anchorFrame = runtimeSnapshot.anchorFrame
      const previousAnchorFrame = preloadLastAnchorFrameRef.current
      preloadLastAnchorFrameRef.current = anchorFrame
      const scrubDirection: -1 | 0 | 1 =
        interactionMode === 'scrubbing' && previousAnchorFrame !== null
          ? getFrameDirection(previousAnchorFrame, anchorFrame)
          : 0
      if (PRELOAD_SKIP_ON_BACKWARD_SCRUB && interactionMode === 'scrubbing' && scrubDirection < 0) {
        recordBackwardScrubSkip(previewPerfRef, interactionMode, scrubDirection)
        return
      }
      const { startFrame: preloadStartFrame, endFrame: preloadEndFrame } = getPreloadWindowRange({
        mode: interactionMode,
        anchorFrame,
        scrubDirection,
        fps,
        aheadSeconds: PRELOAD_AHEAD_SECONDS,
      })
      const { baseMaxIdsPerTick, boostedBaseMaxIdsPerTick } = resolvePreloadBudgets({
        interactionMode,
        scrubDirection,
        burstActive,
      })
      const now = Date.now()
      const unresolvedSet = unresolvedMediaIdSetRef.current
      const costPenaltyFrames = Math.max(8, Math.round(fps * 0.6))
      const scrubDirectionBiasFrames = Math.max(
        8,
        Math.round(fps * PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS),
      )
      const scanStartTime = performance.now()
      const trackIndex =
        ((preloadScanTrackCursorRef.current % combinedTracks.length) + combinedTracks.length) %
        combinedTracks.length
      const itemIndex = Math.max(0, preloadScanItemCursorRef.current)

      const scan = createPreloadScanAccumulator()
      const scanCtx: PreloadScanContext = {
        preloadStartFrame,
        preloadEndFrame,
        anchorFrame,
        now,
        costPenaltyFrames,
        scrubDirection,
        scrubDirectionBiasFrames,
        unresolvedSet,
        mediaResolveCostById,
        getResolveRetryAt,
      }
      const cursors = { preloadScanTrackCursorRef, preloadScanItemCursorRef }
      const reachedScanTimeBudget =
        interactionMode === 'scrubbing'
          ? runScrubPreloadScan({
              combinedTracks,
              trackIndex,
              anchorFrame,
              scrubDirection,
              scanStartTime,
              scan,
              ctx: scanCtx,
              cursors,
            })
          : runForwardPreloadScan({
              combinedTracks,
              trackIndex,
              itemIndex,
              scanStartTime,
              scan,
              ctx: scanCtx,
              cursors,
            })

      const scanDurationMs = performance.now() - scanStartTime
      const maxIdsPerTick = finalizePreloadScanMetrics({
        previewPerfRef,
        scanDurationMs,
        reachedScanTimeBudget,
        scan,
        boostedBaseMaxIdsPerTick,
        baseMaxIdsPerTick,
        scrubDirection,
      })

      if (scan.scores.size === 0) {
        if (reachedScanTimeBudget || preloadBurstRemainingRef.current > 0) {
          schedulePreloadContinuation()
        }
        return
      }

      const mediaToPreload = selectPreloadBatch(scan.scores, maxIdsPerTick)

      preloadResolveInFlightRef.current = true
      try {
        const preloadBatchStartMs = performance.now()
        const { resolvedEntries, failedIds } = await resolveMediaBatch(mediaToPreload)
        const preloadBatchDurationMs = performance.now() - preloadBatchStartMs
        previewPerfRef.current.preloadBatchSamples += 1
        previewPerfRef.current.preloadBatchTotalMs += preloadBatchDurationMs
        previewPerfRef.current.preloadBatchLastMs = preloadBatchDurationMs
        previewPerfRef.current.preloadBatchLastIds = mediaToPreload.length
        applyResolvedMediaEntries({
          resolvedEntries,
          unresolvedMediaIdSetRef,
          setResolvedUrls,
          clearResolveRetryState,
          removeUnresolvedMediaIds,
        })
        scheduleResolveFailureRetries({ failedIds, markResolveFailures, scheduleResolveRetryWake })
      } finally {
        preloadResolveInFlightRef.current = false
        if (reachedScanTimeBudget || preloadBurstRemainingRef.current > 0) {
          schedulePreloadContinuation()
        }
      }
    }

    const startPreloadBurst = () => {
      preloadBurstRemainingRef.current = Math.max(
        preloadBurstRemainingRef.current,
        PRELOAD_BURST_PASSES,
      )
      void preloadMedia()
    }

    void preloadMedia()

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      const transition = resolvePreviewTransitionFromPlaybackStates({
        prev: prevState,
        next: state,
        isGizmoInteracting: isGizmoInteractingRef.current,
        fps,
      })
      const action = resolvePreloadSubscriptionAction({
        transition,
        state,
        prevState,
        lastBackwardScrubPreloadAtRef,
        lastForwardScrubPreloadAtRef,
      })
      switch (action.kind) {
        case 'start_playing':
          lastForwardScrubPreloadAtRef.current = 0
          lastBackwardScrubPreloadAtRef.current = 0
          void preloadMedia()
          intervalId = setInterval(() => {
            void preloadMedia()
          }, 1000)
          break
        case 'scrub_enter_burst':
          lastForwardScrubPreloadAtRef.current = 0
          lastBackwardScrubPreloadAtRef.current = 0
          startPreloadBurst()
          kickResolvePass()
          break
        case 'scrub_frame':
          void preloadMedia()
          break
        case 'paused_frame':
          lastForwardScrubPreloadAtRef.current = 0
          lastBackwardScrubPreloadAtRef.current = 0
          if (action.burst) {
            startPreloadBurst()
          } else {
            void preloadMedia()
          }
          kickResolvePass()
          break
        case 'stop_playing':
          lastForwardScrubPreloadAtRef.current = 0
          lastBackwardScrubPreloadAtRef.current = 0
          if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
          }
          break
        case 'none':
          break
      }
    })

    return () => {
      unsubscribe()
      if (intervalId) {
        clearInterval(intervalId)
      }
      if (continuationTimeoutId !== null) {
        clearTimeout(continuationTimeoutId)
      }
      lastForwardScrubPreloadAtRef.current = 0
      lastBackwardScrubPreloadAtRef.current = 0
      preloadBurstRemainingRef.current = 0
    }
  }, [
    clearResolveRetryState,
    combinedTracks,
    fps,
    getResolveRetryAt,
    isGizmoInteractingRef,
    kickResolvePass,
    lastBackwardScrubPreloadAtRef,
    lastForwardScrubPreloadAtRef,
    markResolveFailures,
    mediaResolveCostById,
    preloadBurstRemainingRef,
    preloadLastAnchorFrameRef,
    preloadResolveInFlightRef,
    preloadScanItemCursorRef,
    preloadScanTrackCursorRef,
    previewPerfRef,
    removeUnresolvedMediaIds,
    resolveMediaBatch,
    scheduleResolveRetryWake,
    setResolvedUrls,
    unresolvedMediaIdSetRef,
  ])
}
