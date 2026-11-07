import type { CaptionReveal, TextSpan } from '@/types/text'
import type { CaptionWord } from '@/types/timeline'

/**
 * A caption with word timings at a moment of its cue, as the text it shows and its runs: the words spoken so far,
 * or the whole line with the word being spoken lit. Null when the caption shows whole, so the caller renders its
 * text as usual.
 */
export function revealCaption(
  cue: { words?: CaptionWord[] },
  seconds: number,
  reveal: CaptionReveal | undefined,
  color: string,
  highlight: string | undefined,
): { text: string; spans: TextSpan[] } | null {
  const words = cue.words
  if (!words || words.length === 0 || !reveal || reveal === 'whole') return null
  let spoken = 0
  while (spoken < words.length && words[spoken]!.startSeconds <= seconds) spoken++
  if (reveal === 'words') {
    const text = words
      .slice(0, Math.max(1, spoken))
      .map((word) => word.text)
      .join('')
      .trimStart()
    return { text, spans: [{ text, color }] }
  }
  const current = Math.max(0, spoken - 1)
  const spans = words.map((word, index) => ({
    text: index === 0 ? word.text.trimStart() : word.text,
    color: index === current ? (highlight ?? '#ffd400') : color,
  }))
  return { text: spans.map((span) => span.text).join(''), spans }
}
