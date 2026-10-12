import type { SubtitleSegmentItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { normalizeAudioEqSettings } from '@/shared/utils/audio-eq'
import { resolveCornerPinTargetRect } from '@/features/timeline/deps/composition-runtime'
import {
  applyOptionalClamps,
  roundDuration,
  roundFrame,
  roundOptionalFrame,
  normalizeOptionalFps,
} from '@/shared/timeline/item-clamps'

export { roundFrame, roundDuration, roundOptionalFrame, normalizeOptionalFps }

const MIN_ENABLED_STROKE_WIDTH = 1

function clampShapePercent(value: number | undefined, max = 100): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(max, value))
}

// fallow-ignore-next-line complexity
export function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  // Start from a shallow copy so the optional-clamp loop can rewrite fields
  // in place without mutating the caller's object.
  const normalized = { ...item } as Record<string, unknown>
  normalized.from = roundFrame(item.from)
  normalized.durationInFrames = roundDuration(item.durationInFrames)
  applyOptionalClamps(normalized)

  const result = normalized as TimelineItem

  if (result.cornerPin) {
    const cornerPinTargetRect = resolveCornerPinTargetRect(
      result.transform?.width ?? 0,
      result.transform?.height ?? 0,
      result.type === 'video' || result.type === 'image'
        ? {
            sourceWidth: result.sourceWidth,
            sourceHeight: result.sourceHeight,
            crop: result.crop,
          }
        : undefined,
    )
    result.cornerPin = {
      ...result.cornerPin,
      referenceWidth:
        result.cornerPin.referenceWidth ??
        (cornerPinTargetRect.width > 0 ? cornerPinTargetRect.width : undefined),
      referenceHeight:
        result.cornerPin.referenceHeight ??
        (cornerPinTargetRect.height > 0 ? cornerPinTargetRect.height : undefined),
    }
  }

  if (result.type === 'shape') {
    result.taperStartWidth = clampShapePercent(result.taperStartWidth, 200)
    result.taperEndWidth = clampShapePercent(result.taperEndWidth, 200)
    result.taperStartLength = clampShapePercent(result.taperStartLength)
    result.taperEndLength = clampShapePercent(result.taperEndLength)
    if (result.shapeType === 'path') {
      result.pathClosed = result.isMask ? true : (result.pathClosed ?? true)
      if (result.pathClosed === false) result.fillEnabled = false
      else result.fillEnabled ??= true
      result.strokeEnabled ??= true
      result.strokeLineCap ??= 'butt'
      result.strokeLineJoin ??= 'miter'
      result.strokeMiterLimit ??= 4
      result.pathVertices = result.pathVertices?.map((vertex) => ({
        ...vertex,
        tangentMode:
          vertex.tangentMode ??
          (vertex.inHandle[0] === 0 &&
          vertex.inHandle[1] === 0 &&
          vertex.outHandle[0] === 0 &&
          vertex.outHandle[1] === 0
            ? 'corner'
            : 'smooth'),
      }))
    }
    if (result.strokeEnabled === true && (result.strokeWidth ?? 0) < MIN_ENABLED_STROKE_WIDTH) {
      result.strokeWidth = MIN_ENABLED_STROKE_WIDTH
    }
    if (result.isMask) result.blendMode = 'normal'
  }

  // Legacy split clips can have sourceEnd without sourceStart.
  // Treat them as explicitly bounded from 0 to sourceEnd so rate stretch
  // operates on the split segment rather than the full media duration.
  if (
    (result.type === 'video' || result.type === 'audio') &&
    result.sourceEnd !== undefined &&
    result.sourceStart === undefined
  ) {
    result.sourceStart = 0
  }

  return result as T
}

export function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Record<string, unknown>

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from as number)
  if (normalized.durationInFrames !== undefined) {
    normalized.durationInFrames = roundDuration(normalized.durationInFrames as number)
  }

  applyOptionalClamps(normalized)

  if (
    normalized.strokeEnabled === true &&
    typeof normalized.strokeWidth === 'number' &&
    normalized.strokeWidth < MIN_ENABLED_STROKE_WIDTH
  ) {
    normalized.strokeWidth = MIN_ENABLED_STROKE_WIDTH
  }

  // Keep legacy end-only bounds explicit and stable.
  if (normalized.sourceEnd !== undefined && normalized.sourceStart === undefined) {
    normalized.sourceStart = 0
  }

  return normalized as Partial<TimelineItem>
}

export function normalizeTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    volume: track.volume === undefined ? undefined : Math.max(-60, Math.min(12, track.volume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
  }
}

/**
 * Trim a subtitle segment from its start: re-anchor every cue's time so the
 * new `from` becomes 0, dropping cues entirely before the new boundary and
 * clamping cues that straddle it.
 *
 * `clampedAmount` is in timeline frames — positive means trimming inward.
 */
export function trimSubtitleCuesAtStart(
  item: SubtitleSegmentItem,
  clampedAmount: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  if (clampedAmount === 0) return null
  const offsetSeconds = clampedAmount / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.endSeconds <= offsetSeconds) continue // entirely outside new window
    const startSeconds = Math.max(0, cue.startSeconds - offsetSeconds)
    const endSeconds = cue.endSeconds - offsetSeconds
    if (endSeconds <= startSeconds) continue
    nextCues.push({ ...cue, startSeconds, endSeconds })
  }
  return { cues: nextCues }
}

/**
 * Trim a subtitle segment from its end: drop cues past the new duration and
 * clamp cues that straddle the boundary.
 */
export function trimSubtitleCuesAtEnd(
  item: SubtitleSegmentItem,
  newDurationFrames: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  const newEndSeconds = newDurationFrames / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.startSeconds >= newEndSeconds) continue
    const endSeconds = Math.min(cue.endSeconds, newEndSeconds)
    if (endSeconds <= cue.startSeconds) continue
    nextCues.push({ ...cue, endSeconds })
  }
  return { cues: nextCues }
}
