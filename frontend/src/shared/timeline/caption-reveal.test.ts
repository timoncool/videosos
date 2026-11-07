import { describe, expect, it } from 'vitest'
import { revealCaption } from './caption-reveal'

const cue = {
  words: [
    { text: 'Куда', startSeconds: 0, endSeconds: 0.4 },
    { text: ' ты', startSeconds: 0.45, endSeconds: 0.6 },
    { text: ' плывёшь,', startSeconds: 0.7, endSeconds: 1.2 },
    { text: ' кораблик?', startSeconds: 1.3, endSeconds: 1.9 },
  ],
}

describe('a caption shown by its words', () => {
  it('shows whole, as before, without words or with the whole reveal', () => {
    expect(revealCaption({}, 1, 'karaoke', '#fff', '#ff0')).toBeNull()
    expect(revealCaption(cue, 1, 'whole', '#fff', '#ff0')).toBeNull()
    expect(revealCaption(cue, 1, undefined, '#fff', '#ff0')).toBeNull()
  })

  it('adds the words as they are spoken, the first one from the cue start', () => {
    expect(revealCaption(cue, 0, 'words', '#fff', undefined)?.text).toBe('Куда')
    expect(revealCaption(cue, 0.8, 'words', '#fff', undefined)?.text).toBe('Куда ты плывёшь,')
    expect(revealCaption(cue, 5, 'words', '#fff', undefined)?.text).toBe(
      'Куда ты плывёшь, кораблик?',
    )
  })

  it('lights the word being spoken in karaoke and keeps the whole line', () => {
    const at = revealCaption(cue, 0.5, 'karaoke', '#fff', '#ff0')!
    expect(at.text).toBe('Куда ты плывёшь, кораблик?')
    expect(at.spans.map((span) => span.color)).toEqual(['#fff', '#ff0', '#fff', '#fff'])
    expect(revealCaption(cue, 1.5, 'karaoke', '#fff', '#ff0')!.spans.at(-1)?.color).toBe('#ff0')
  })
})
