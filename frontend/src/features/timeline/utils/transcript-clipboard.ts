/**
 * Turns a transcript word-selection into timeline clips for copy/paste.
 *
 * Word-level copy/cut "carries the media": each contiguous run of selected
 * words within a clip becomes a clone of that clip trimmed to the run's source
 * range. The clones are placed in the shared clipboard store, so the existing
 * global paste (Ctrl+V) drops them onto the timeline at the playhead — no new
 * paste path needed. `from` is set to each run's timeline start so multi-run
 * selections keep their relative spacing (the clipboard normalizes to the
 * earliest item).
 *
 * Linked A/V pairs are preserved: the transcript shows one token stream per pair
 * (the video, with its linked audio deduped), so a naive clone would carry only
 * the video. We look up the run clip's linked companion(s) by `linkedGroupId`
 * and clone them with the same source range and a shared (fresh) group id, so
 * paste re-links them and the audio comes along.
 */

import type { TimelineItem } from '@/types/timeline'
import type { TranscriptToken } from './transcript-edit-model'
import { getMediaSourceFps } from './media-item-frames'

type MediaItem = Extract<TimelineItem, { type: 'video' | 'audio' }>

function isMediaItem(item: TimelineItem | undefined): item is MediaItem {
  return !!item && (item.type === 'video' || item.type === 'audio')
}

export function buildTranscriptClipboardItems(
  slice: readonly TranscriptToken[],
  itemById: Readonly<Record<string, TimelineItem | undefined>>,
  timelineFps: number,
): TimelineItem[] {
  const allItems = Object.values(itemById).filter((item): item is TimelineItem => Boolean(item))
  const clones: TimelineItem[] = []

  let i = 0
  while (i < slice.length) {
    const first = slice[i]
    if (!first) break
    const itemId = first.itemId

    // Extend the run over consecutive tokens from the same clip.
    let j = i
    while (j + 1 < slice.length && slice[j + 1]?.itemId === itemId) j++
    const last = slice[j] ?? first

    const source = itemById[itemId]
    if (isMediaItem(source)) {
      const from = first.startFrame
      const durationInFrames = Math.max(1, last.endFrame - first.startFrame)

      // Linked companions (e.g. the audio half of an A/V pair) share the source
      // clip's linkedGroupId. Clone them alongside so the pair pastes together.
      const companions = source.linkedGroupId
        ? allItems.filter(
            (item): item is MediaItem =>
              item.id !== source.id &&
              isMediaItem(item) &&
              item.linkedGroupId === source.linkedGroupId,
          )
        : []
      const pairGroupId = companions.length > 0 ? crypto.randomUUID() : undefined

      const cloneOf = (item: MediaItem): MediaItem => {
        const sourceFps = getMediaSourceFps(item, timelineFps)
        const sourceStartFrame = Math.round(first.sourceStart * sourceFps)
        const sourceEndFrame = Math.max(
          sourceStartFrame + 1,
          Math.round(last.sourceEnd * sourceFps),
        )
        return {
          ...item,
          id: crypto.randomUUID(),
          from,
          durationInFrames,
          sourceStart: sourceStartFrame,
          sourceEnd: sourceEndFrame,
          trimStart: 0,
          trimEnd: 0,
          linkedGroupId: pairGroupId,
        }
      }

      clones.push(cloneOf(source))
      for (const companion of companions) clones.push(cloneOf(companion))
    }

    i = j + 1
  }

  return clones
}
