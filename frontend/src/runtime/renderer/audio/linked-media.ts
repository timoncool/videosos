/**
 * Resolves which video items carry their audio through an explicitly linked
 * audio companion — including the legacy imported pairs that predate
 * `linkedGroupId`.
 */

import type { AudioItem, TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (
    (left.type === 'video' && right.type === 'audio') ||
    (left.type === 'audio' && right.type === 'video')
  )
}

function getHeuristicTrimStart(item: TimelineItem): number | null {
  const timelineItem = item as TimelineItem & { offset?: number }
  return timelineItem.sourceStart ?? timelineItem.trimStart ?? timelineItem.offset ?? null
}

function isImportedLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false
  if (anchor.linkedGroupId || candidate.linkedGroupId) return false
  if (anchor.originId || candidate.originId) return false
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false
  if (anchor.from !== candidate.from) return false
  if (anchor.durationInFrames !== candidate.durationInFrames) return false
  if (getHeuristicTrimStart(anchor) !== getHeuristicTrimStart(candidate)) return false
  if ((anchor.sourceEnd ?? null) !== (candidate.sourceEnd ?? null)) return false
  return (anchor.speed ?? 1) === (candidate.speed ?? 1)
}

function getLinkedAudioCompanionForExport(
  items: TimelineItem[],
  anchor: TimelineItem,
): AudioItem | null {
  const linked = getLinkedAudioCompanion(items, anchor)
  if (linked) return linked
  if (anchor.type !== 'video') return null
  return (
    (items.find(
      (candidate) => candidate.type === 'audio' && isImportedLegacyLinkedPair(anchor, candidate),
    ) as AudioItem | undefined) ?? null
  )
}

export function getLinkedVideoIdsWithAudioForExport(items: TimelineItem[]): Set<string> {
  const linkedVideoIds = new Set<string>()

  for (const item of items) {
    if (item.type !== 'video') continue
    if (getLinkedAudioCompanionForExport(items, item)) {
      linkedVideoIds.add(item.id)
    }
  }

  return linkedVideoIds
}

export function getManagedLinkedAudioTransitionsForExport(
  items: TimelineItem[],
  transitions: Transition[],
): Array<{ transition: Transition; leftAudio: AudioItem; rightAudio: AudioItem }> {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const managed: Array<{ transition: Transition; leftAudio: AudioItem; rightAudio: AudioItem }> = []

  for (const transition of transitions) {
    const leftClip = itemById.get(transition.leftClipId)
    const rightClip = itemById.get(transition.rightClipId)
    if (leftClip?.type !== 'video' || rightClip?.type !== 'video') continue

    const leftAudio = getLinkedAudioCompanionForExport(items, leftClip)
    const rightAudio = getLinkedAudioCompanionForExport(items, rightClip)
    if (!leftAudio || !rightAudio) continue
    if (leftAudio.trackId !== rightAudio.trackId) continue
    if (leftAudio.from !== leftClip.from || rightAudio.from !== rightClip.from) continue
    if (
      leftAudio.durationInFrames !== leftClip.durationInFrames ||
      rightAudio.durationInFrames !== rightClip.durationInFrames
    )
      continue

    managed.push({ transition, leftAudio, rightAudio })
  }

  return managed
}
