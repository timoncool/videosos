/**
 * The name a result goes by in the media library, as YuE2 Studio names a track nobody named: what the prompt
 * asked for, ended at its first sentence, at most two comma phrases and fifty characters cut on a word. A job
 * with no prompt (an upscale, a background removal) goes by its model.
 */

const MAX_CHARS = 50

/** The request's own words: the prompt, or the text a voice or a transcript was asked for; never a negative prompt. */
export function promptOf(values: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !value.trim() || /negative/i.test(key)) continue
    if (/prompt|^input$|^text$/i.test(key)) return value
  }
  return null
}

function sentenceEnd(text: string): number | null {
  const match = /[.!?…](\s|$)/u.exec(text)
  return match ? match.index : null
}

export function trimTitle(raw: string): string {
  let value = raw.replace(/\s+/g, ' ').trim()
  if (value.startsWith('(') && value.endsWith(')') && value.length > 2) value = value.slice(1, -1).trim()
  const end = sentenceEnd(value)
  if (end !== null && end < MAX_CHARS) value = value.slice(0, end + 1).trim()
  const phrases = value.split(',')
  if (phrases.length > 2) value = phrases.slice(0, 2).join(',').trim()
  const characters = Array.from(value)
  if (characters.length <= MAX_CHARS) return value
  const cut = characters.slice(0, MAX_CHARS).join('')
  const space = cut.lastIndexOf(' ')
  return `${space > 0 ? cut.slice(0, space).trimEnd() : cut}…`
}

/** The file name of a job's output: the title, numbered when the job made more than one. */
export function resultFileName(job: { values: Record<string, unknown>; model_name: string; model: string }, index: number, count: number, extension: string): string {
  const prompt = promptOf(job.values)
  const title = (prompt ? trimTitle(prompt) : job.model_name || job.model)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  return `${title}${count > 1 ? ` (${index + 1})` : ''}.${extension}`
}
