import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { isFrameInTransitionRegion } from '@/features/timeline/deps/keyframes'
import {
  applyTrimEndPreview,
  applyTrimStartPreview,
  type PreviewItemUpdate,
} from './item-edit-preview'
import { canAddTransition, clampDeltaToLastValidValue } from './transition-utils'

type KeyframesByItemId = Record<string, ItemKeyframes | undefined>

function applyUpdate(item: TimelineItem, update: PreviewItemUpdate): TimelineItem {
  return { ...item, ...update }
}

function collectPreservedKeyframes(
  affectedIds: ReadonlySet<string>,
  itemsById: ReadonlyMap<string, TimelineItem>,
  transitions: Transition[],
  keyframesByItemId: KeyframesByItemId,
): Map<string, number[]> {
  const result = new Map<string, number[]>()
  for (const itemId of affectedIds) {
    const item = itemsById.get(itemId)
    const itemKeyframes = keyframesByItemId[itemId]
    if (!item || !itemKeyframes) continue

    const frames = itemKeyframes.properties
      .flatMap((property) => property.keyframes)
      .map((keyframe) => keyframe.frame)
      .filter(
        (frame) =>
          frame >= 0 &&
          frame < item.durationInFrames &&
          !isFrameInTransitionRegion(frame, itemId, item, transitions),
      )
    if (frames.length > 0) result.set(itemId, frames)
  }
  return result
}

function createPreviewValidator({
  items,
  transitions,
  affectedIds,
  keyframesByItemId,
  timelineFps,
  preserveKeyframes,
  buildPreview,
}: {
  items: TimelineItem[]
  transitions: Transition[]
  affectedIds: ReadonlySet<string>
  keyframesByItemId: KeyframesByItemId
  timelineFps: number
  preserveKeyframes: boolean
  buildPreview: (delta: number) => Map<string, TimelineItem>
}): (delta: number) => boolean {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const relatedTransitions = transitions.filter(
    (transition) =>
      affectedIds.has(transition.leftClipId) || affectedIds.has(transition.rightClipId),
  )
  const preservedKeyframes = preserveKeyframes
    ? collectPreservedKeyframes(affectedIds, itemsById, transitions, keyframesByItemId)
    : new Map<string, number[]>()

  return (delta: number): boolean => {
    const previewById = buildPreview(delta)

    for (const transition of relatedTransitions) {
      const left = previewById.get(transition.leftClipId) ?? itemsById.get(transition.leftClipId)
      const right = previewById.get(transition.rightClipId) ?? itemsById.get(transition.rightClipId)
      if (
        left &&
        right &&
        !canAddTransition(
          left,
          right,
          transition.durationInFrames,
          transition.alignment,
          timelineFps,
        ).canAdd
      ) {
        return false
      }
    }

    for (const [itemId, frames] of preservedKeyframes) {
      const preview = previewById.get(itemId) ?? itemsById.get(itemId)
      if (!preview) continue
      for (const frame of frames) {
        if (
          frame >= preview.durationInFrames ||
          isFrameInTransitionRegion(frame, itemId, preview, transitions)
        ) {
          return false
        }
      }
    }

    return true
  }
}

export function clampRollingTrimDeltaToPreserveEditState(
  item: TimelineItem,
  handle: 'start' | 'end',
  requestedDelta: number,
  neighbor: TimelineItem,
  items: TimelineItem[],
  transitions: Transition[],
  keyframesByItemId: KeyframesByItemId,
  timelineFps: number = 30,
  preserveKeyframes: boolean = true,
): number {
  if (requestedDelta === 0) return 0
  const left = handle === 'end' ? item : neighbor
  const right = handle === 'end' ? neighbor : item
  const affectedIds = new Set([left.id, right.id])
  const isValid = createPreviewValidator({
    items,
    transitions,
    affectedIds,
    keyframesByItemId,
    timelineFps,
    preserveKeyframes,
    buildPreview: (delta) =>
      new Map([
        [left.id, applyUpdate(left, applyTrimEndPreview(left, delta, timelineFps))],
        [right.id, applyUpdate(right, applyTrimStartPreview(right, delta, timelineFps))],
      ]),
  })
  return clampDeltaToLastValidValue(requestedDelta, isValid)
}

export function clampRippleTrimDeltaToPreserveEditState(
  item: TimelineItem,
  handle: 'start' | 'end',
  requestedDelta: number,
  items: TimelineItem[],
  transitions: Transition[],
  keyframesByItemId: KeyframesByItemId,
  timelineFps: number = 30,
  excludedDownstreamIds: ReadonlySet<string> = new Set(),
  preserveKeyframes: boolean = true,
): number {
  if (requestedDelta === 0) return 0
  const oldEnd = item.from + item.durationInFrames
  const downstreamIds = new Set(
    items
      .filter(
        (candidate) =>
          candidate.id !== item.id &&
          !excludedDownstreamIds.has(candidate.id) &&
          candidate.trackId === item.trackId &&
          candidate.from >= oldEnd,
      )
      .map((candidate) => candidate.id),
  )
  for (const transition of transitions) {
    if (transition.leftClipId === item.id && !excludedDownstreamIds.has(transition.rightClipId)) {
      downstreamIds.add(transition.rightClipId)
    }
  }

  const affectedIds = new Set([item.id, ...downstreamIds])
  const isValid = createPreviewValidator({
    items,
    transitions,
    affectedIds,
    keyframesByItemId,
    timelineFps,
    preserveKeyframes,
    buildPreview: (delta) => {
      const previewById = new Map<string, TimelineItem>()
      const update =
        handle === 'end'
          ? applyTrimEndPreview(item, delta, timelineFps)
          : { ...applyTrimStartPreview(item, delta, timelineFps), from: item.from }
      previewById.set(item.id, applyUpdate(item, update))

      const shift = handle === 'end' ? delta : -delta
      for (const downstreamId of downstreamIds) {
        const downstream = items.find((candidate) => candidate.id === downstreamId)
        if (downstream)
          previewById.set(downstreamId, { ...downstream, from: downstream.from + shift })
      }
      return previewById
    },
  })
  return clampDeltaToLastValidValue(requestedDelta, isValid)
}
