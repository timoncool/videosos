/**
 * Lets the transcript editor claim Ctrl+C / Ctrl+X for word-level copy/cut.
 *
 * The global clipboard shortcuts fire on the capture phase (before any panel
 * keydown), so the transcript panel can't intercept the keys locally without a
 * fragile capture-order hack. Instead it registers a handler here; the global
 * clipboard hook calls `handleTranscriptClipboardCopy` first and, when the
 * transcript editor is active with a word selection, lets it copy/cut the
 * selected WORDS instead of the whole clip ("segment").
 */

interface TranscriptCopyHandler {
  /** True only when the transcript tab is visible and words are selected. */
  isActive: () => boolean
  /** Copy (or cut) the current word selection. */
  copy: (cut: boolean) => void
}

let handler: TranscriptCopyHandler | null = null

export function registerTranscriptCopyHandler(next: TranscriptCopyHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/**
 * If the transcript editor is active with a word selection, run its copy/cut and
 * return true so the caller (global clipboard hook) skips the clip-level copy.
 */
export function handleTranscriptClipboardCopy(cut: boolean): boolean {
  if (handler?.isActive()) {
    handler.copy(cut)
    return true
  }
  return false
}
