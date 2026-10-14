/**
 * What a result is called in the media library: the title the server gave its job (the prompt's first words,
 * as YuE2 Studio names a track, or the model), the same one its file carries in its tags.
 */

/** The request's own words: the prompt, or the text a voice or a transcript was asked for; never a negative prompt. */
export function promptOf(values: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || !value.trim() || /negative/i.test(key)) continue
    if (/prompt|^input$|^text$/i.test(key)) return value
  }
  return null
}

/** The file name of a job's output: its title, numbered when the job made more than one. */
export function resultFileName(job: { title: string }, index: number, count: number, extension: string): string {
  const title = job.title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  return `${title}${count > 1 ? ` (${index + 1})` : ''}.${extension}`
}
