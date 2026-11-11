import type { TimelineItem } from '@/types/timeline'

/** A caption of a clip as the timeline shows it: its words and its frames, inside the clip. */
export interface TimelineCaptionCue {
  text: string
  from: number
  to: number
}

/**
 * The transcript captions a clip carries, moved from the source's seconds to the timeline's frames and cut to
 * the part of the source the clip plays; none when its captions are off.
 */
export function timelineCaptionCues(item: TimelineItem, fps: number): TimelineCaptionCue[] {
  const captions = item.transcriptCaptions
  if (!captions?.enabled) return []
  const speed = item.speed ?? 1
  const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps
  const sourceStart = (item.sourceStart ?? 0) / sourceFps
  const end = item.from + item.durationInFrames
  return captions.cues.flatMap((cue) => {
    const from = Math.max(
      item.from,
      item.from + Math.round(((cue.startSeconds - sourceStart) / speed) * fps),
    )
    const to = Math.min(end, item.from + Math.round(((cue.endSeconds - sourceStart) / speed) * fps))
    return to > from && cue.text.trim() ? [{ text: cue.text.trim(), from, to }] : []
  })
}
