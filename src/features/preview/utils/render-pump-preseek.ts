import {
  getVideoTargetTimeSeconds,
  resolveTrackRenderState,
} from '@/features/preview/deps/composition-runtime'
import { timelineToSourceFrames } from '@/features/preview/deps/timeline-utils'
import type { CompositionItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'

/** Minimal sub-composition shape preseek needs to see inside compound clips. */
export interface PreseekSubComposition {
  fps: number
  items: TimelineItem[]
  tracks?: TimelineTrack[]
}

export interface RenderPumpSourceTimeOptions {
  requireExplicitSourceFps?: boolean
  resolvedMediaFps?: number
  /**
   * Resolve a compound clip's sub-composition so collectors can recurse into
   * its video items (1 level — sub-comps cannot nest). Without it,
   * composition items are skipped, matching the old behavior.
   */
  resolveComposition?: (compositionId: string) => PreseekSubComposition | null
  /**
   * Current-session URL for a video item. Stored `src` is empty (or a stale
   * blob URL from the session that created the item) on workspace projects —
   * the live URL must be resolved by mediaId. Applies to both main-timeline
   * items and sub-comp items; falls back to the item's stored src.
   */
  resolveItemSrc?: (item: VideoItem) => string | null
}

export interface PreviewPreseekSourceInput {
  useProxy: boolean
  proxySource?: string | null
  liveSource?: string | null
  itemSource?: string | null
}

/**
 * Keep worker preseek source selection aligned with the renderer. A disabled
 * proxy must never remain in the latency-critical decode lane or gate an
 * original-resolution render behind the wrong source.
 */
export function resolvePreviewPreseekSource({
  useProxy,
  proxySource,
  liveSource,
  itemSource,
}: PreviewPreseekSourceInput): string | null {
  return (useProxy ? proxySource : null) ?? liveSource ?? itemSource ?? null
}

export interface PreseekSourceTarget {
  src: string
  time: number
}

export interface PausedVariableSpeedPrewarmPlan {
  itemIds: string[]
  visibilityFrame: number
  preseekFrame: number
}

function isPreseekableVideoItem(item: TimelineItem): item is VideoItem {
  return item.type === 'video' && typeof item.src === 'string' && item.src.length > 0
}

/**
 * Resolve the URL preseek should decode for a video item. Prefers the
 * current-session URL from `resolveItemSrc` (the stored src is empty or stale
 * on workspace projects); falls back to the stored src when non-empty.
 */
function resolvePreseekVideoSrc(
  item: TimelineItem,
  options: RenderPumpSourceTimeOptions,
): string | null {
  if (item.type !== 'video') return null
  return options.resolveItemSrc?.(item) ?? (item.src || null)
}

function appendSourceTimeBySrc(bySource: Map<string, number[]>, src: string, time: number) {
  const existing = bySource.get(src)
  if (existing) {
    existing.push(time)
  } else {
    bySource.set(src, [time])
  }
}

export function getVideoItemSourceTimeSeconds(
  item: TimelineItem,
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): number | null {
  if (!isPreseekableVideoItem(item)) return null

  const localFrame = timelineFrame - item.from
  if (localFrame < 0 || localFrame >= item.durationInFrames) return null

  const sourceFps = options.requireExplicitSourceFps
    ? item.sourceFps
    : (item.sourceFps ?? options.resolvedMediaFps ?? timelineFps)
  if (!Number.isFinite(sourceFps) || !sourceFps || sourceFps <= 0) {
    return null
  }

  const sourceStart = item.sourceStart ?? item.trimStart ?? 0
  const speed = item.speed ?? 1
  const reverseSourceEnd =
    item.sourceEnd ?? sourceStart + (item.durationInFrames * speed * sourceFps) / timelineFps

  return getVideoTargetTimeSeconds(
    sourceStart,
    sourceFps,
    localFrame,
    speed,
    timelineFps,
    0,
    item.isReversed === true,
    reverseSourceEnd,
  )
}

/**
 * Map a parent-timeline frame into a compound clip's sub-composition frame
 * space, honoring the wrapper's trim (sourceStart) and speed. Mirrors
 * CompositionContent's subCompFrame math (composition-content.tsx) so preseek
 * targets land on the same frames the renderer requests. Returns null when
 * the frame falls outside the compound clip.
 */
export function mapTimelineFrameToSubCompositionFrame(
  item: CompositionItem,
  timelineFrame: number,
  timelineFps: number,
  subCompFps: number,
): number | null {
  const relativeFrame = timelineFrame - item.from
  if (relativeFrame < 0 || relativeFrame >= item.durationInFrames) return null

  const sourceOffset = item.sourceStart ?? item.trimStart ?? 0
  return (
    sourceOffset +
    timelineToSourceFrames(
      relativeFrame,
      item.speed ?? 1,
      timelineFps,
      item.sourceFps ?? subCompFps,
    )
  )
}

function collectSubCompositionVideoSourceTimes(
  bySource: Map<string, number[]>,
  item: CompositionItem,
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions,
  visitedCompositionIds: Set<string>,
): void {
  if (visitedCompositionIds.has(item.compositionId)) return
  const subComp = options.resolveComposition?.(item.compositionId)
  if (!subComp || !Number.isFinite(subComp.fps) || subComp.fps <= 0) return

  const subCompFrame = mapTimelineFrameToSubCompositionFrame(
    item,
    timelineFrame,
    timelineFps,
    subComp.fps,
  )
  if (subCompFrame === null) return

  visitedCompositionIds.add(item.compositionId)
  try {
    const visibleTrackIds = subComp.tracks
      ? resolveTrackRenderState(subComp.tracks).visibleTrackIds
      : null
    for (const subItem of subComp.items) {
      if (visibleTrackIds && !visibleTrackIds.has(subItem.trackId)) continue
      if (subItem.type === 'composition') {
        collectSubCompositionVideoSourceTimes(
          bySource,
          subItem,
          subCompFrame,
          subComp.fps,
          options,
          visitedCompositionIds,
        )
        continue
      }
      if (subItem.type !== 'video') continue
      const src = resolvePreseekVideoSrc(subItem, options)
      if (!src) continue

      const sourceTime = getVideoItemSourceTimeSeconds(
        { ...subItem, src },
        subCompFrame,
        subComp.fps,
        options,
      )
      if (sourceTime === null) continue
      appendSourceTimeBySrc(bySource, src, sourceTime)
    }
  } finally {
    visitedCompositionIds.delete(item.compositionId)
  }
}

export function collectVisibleTrackVideoSourceTimesBySrc(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions & {
    filter?: (item: VideoItem) => boolean
  } = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>()

  for (const track of resolveTrackRenderState(tracks).visibleTracks) {
    for (const item of track.items) {
      if (item.type === 'composition') {
        collectSubCompositionVideoSourceTimes(
          bySource,
          item,
          timelineFrame,
          timelineFps,
          options,
          new Set(),
        )
        continue
      }
      if (item.type !== 'video') continue
      const src = resolvePreseekVideoSrc(item, options)
      if (!src) continue
      if (options.filter && !options.filter(item)) continue

      const sourceTime = getVideoItemSourceTimeSeconds(
        { ...item, src },
        timelineFrame,
        timelineFps,
        options,
      )
      if (sourceTime === null) continue
      appendSourceTimeBySrc(bySource, src, sourceTime)
    }
  }

  return bySource
}

export function collectClipVideoSourceTimesBySrcForFrame(
  items: TimelineItem[],
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>()

  for (const item of items) {
    if (!isPreseekableVideoItem(item)) continue

    const sourceTime = getVideoItemSourceTimeSeconds(item, timelineFrame, timelineFps, options)
    if (sourceTime === null) continue
    appendSourceTimeBySrc(bySource, item.src, sourceTime)
  }

  return bySource
}

export function collectClipVideoSourceTimesBySrcForFrameRange(
  items: TimelineItem[],
  startFrame: number,
  frameCount: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>()
  const safeFrameCount = Math.max(0, Math.floor(frameCount))

  for (const item of items) {
    if (!isPreseekableVideoItem(item)) continue
    for (let offset = 0; offset < safeFrameCount; offset += 1) {
      const sourceTime = getVideoItemSourceTimeSeconds(
        item,
        startFrame + offset,
        timelineFps,
        options,
      )
      if (sourceTime === null) continue
      appendSourceTimeBySrc(bySource, item.src, sourceTime)
    }
  }

  return bySource
}

export function collectPlaybackStartVariableSpeedPrewarmItemIds(
  tracks: TimelineTrack[],
  timelineFrame: number,
): string[] {
  const itemIds: string[] = []

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue
      if (timelineFrame < item.from || timelineFrame >= item.from + item.durationInFrames) continue

      const speed = item.speed ?? 1
      if (Math.abs(speed - 1) < 0.01) continue

      const framesIntoClip = timelineFrame - item.from
      if (framesIntoClip <= 2) {
        itemIds.push(item.id)
      }
    }
  }

  return itemIds
}

export function collectPlaybackStartVariableSpeedPreseekTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  lookaheadFrames: number,
): PreseekSourceTarget[] {
  const targets: PreseekSourceTarget[] = []

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue

      const speed = item.speed ?? 1
      if (Math.abs(speed - 1) < 0.01) continue

      const itemEnd = item.from + item.durationInFrames
      if (item.from > timelineFrame + lookaheadFrames || itemEnd <= timelineFrame) continue

      const targetFrame = Math.min(timelineFrame + lookaheadFrames, itemEnd - 1)
      const sourceTime = getVideoItemSourceTimeSeconds(item, targetFrame, timelineFps)
      if (sourceTime === null) continue

      targets.push({
        src: item.src,
        time: sourceTime,
      })
    }
  }

  return targets
}

export function resolvePausedVariableSpeedPrewarmPlan(
  tracks: TimelineTrack[],
  timelineFrame: number,
  lookaheadFrames: number,
): PausedVariableSpeedPrewarmPlan | null {
  const candidateItemIds: string[] = []
  const candidateIdSet = new Set<string>()

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue

      const speed = item.speed ?? 1
      if (Math.abs(speed - 1) < 0.01) continue

      if (item.from > timelineFrame && item.from <= timelineFrame + lookaheadFrames) {
        candidateItemIds.push(item.id)
        candidateIdSet.add(item.id)
      }
    }
  }

  if (candidateItemIds.length === 0) {
    return null
  }

  let visibilityFrame = timelineFrame
  let hasCandidate = false

  for (const track of tracks) {
    const varItem = track.items.find((item) => candidateIdSet.has(item.id))
    if (!varItem) continue

    const varTrackOrder = track.order ?? 0
    let latestOccluderEnd = timelineFrame
    for (const otherTrack of tracks) {
      const otherOrder = otherTrack.order ?? 0
      if (otherOrder >= varTrackOrder) continue
      for (const otherItem of otherTrack.items) {
        if (otherItem.type === 'audio' || otherItem.type === 'adjustment') continue
        const otherEnd = otherItem.from + otherItem.durationInFrames
        if (otherItem.from <= timelineFrame + lookaheadFrames && otherEnd > timelineFrame) {
          latestOccluderEnd = Math.max(latestOccluderEnd, otherEnd)
        }
      }
    }
    if (!hasCandidate) {
      visibilityFrame = latestOccluderEnd
      hasCandidate = true
    } else {
      visibilityFrame = Math.min(visibilityFrame, latestOccluderEnd)
    }
  }

  return {
    itemIds: candidateItemIds,
    visibilityFrame,
    preseekFrame: Math.max(timelineFrame, visibilityFrame - 1),
  }
}

/**
 * Seconds of forward jump below which mediabunny's sequential advance is fast
 * enough (~1ms/frame) that a background worker preseek isn't worth queuing.
 */
const JUMP_PRESEEK_FORWARD_THRESHOLD_SECONDS = 3
/**
 * Seconds of backward jump above which a worker preseek is queued. Backward
 * jumps can't ride sequential advance — mediabunny must seek to the previous
 * keyframe and decode forward (300-600ms), so the threshold is much smaller
 * than the forward one.
 */
const JUMP_PRESEEK_BACKWARD_THRESHOLD_SECONDS = 0.5

/**
 * Decide whether a paused playhead jump should queue a background worker
 * preseek for the visible sources at the target frame. Direction-aware: only
 * large forward jumps need worker help, but most backward jumps do.
 */
export function shouldRunJumpPreseek(input: {
  prevFrame: number
  nextFrame: number
  fps: number
  isPlaying: boolean
}): boolean {
  if (input.isPlaying) return false
  const deltaFrames = input.nextFrame - input.prevFrame
  if (deltaFrames === 0) return false
  const thresholdSeconds =
    deltaFrames > 0
      ? JUMP_PRESEEK_FORWARD_THRESHOLD_SECONDS
      : JUMP_PRESEEK_BACKWARD_THRESHOLD_SECONDS
  const thresholdFrames = Math.max(1, Math.round(input.fps * thresholdSeconds))
  return Math.abs(deltaFrames) >= thresholdFrames
}

export interface ActivePreviewLookaheadInput {
  sourceTime: number
  previousSourceTime: number | null
  elapsedMs: number
  sourceFps: number
  fallbackDirection: -1 | 0 | 1
}

/**
 * Build a tiny source-time ring around the exact scrub target. Faster drags
 * spread the forward sample farther out instead of decoding every skipped
 * frame, while always retaining one adjacent frame in both directions for
 * fine tuning after the pointer slows down.
 */
export function resolveActivePreviewLookaheadTimestamps({
  sourceTime,
  previousSourceTime,
  elapsedMs,
  sourceFps,
  fallbackDirection,
}: ActivePreviewLookaheadInput): number[] {
  const normalizedFps = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30
  const frameDuration = 1 / normalizedFps
  const sourceDelta = previousSourceTime === null ? 0 : sourceTime - previousSourceTime
  const direction: -1 | 0 | 1 =
    Math.abs(sourceDelta) > frameDuration / 4 ? (sourceDelta > 0 ? 1 : -1) : fallbackDirection
  if (direction === 0) return []

  const safeElapsedMs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 1000
  const velocityFramesPerSecond =
    previousSourceTime === null ? 0 : (Math.abs(sourceDelta) * normalizedFps * 1000) / safeElapsedMs
  const strideFrames =
    velocityFramesPerSecond >= 36
      ? Math.max(4, Math.min(120, Math.round(velocityFramesPerSecond * 0.05)))
      : 1
  const frameOffsets = [direction, direction * strideFrames, -direction]
  const timestamps: number[] = []
  const seen = new Set<number>()

  for (const frameOffset of frameOffsets) {
    const timestamp = Math.max(0, sourceTime + frameOffset * frameDuration)
    const key = Math.round(timestamp * normalizedFps * 1_000)
    if (Math.abs(timestamp - sourceTime) < 1e-7 || seen.has(key)) continue
    seen.add(key)
    timestamps.push(timestamp)
  }

  return timestamps
}
