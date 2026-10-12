import type { SupertonicTtsLanguageSelection } from '@/features/editor/services/supertonic-tts-service'

export function insertTextAtCursor({
  input,
  insertText,
  setText,
  text,
}: {
  input: HTMLTextAreaElement | null
  insertText: string
  setText: (value: string) => void
  text: string
}): void {
  const start = input?.selectionStart ?? text.length
  const end = input?.selectionEnd ?? start
  const needsLeadingSpace = start > 0 && !/\s$/.test(text.slice(0, start))
  const needsTrailingSpace = end < text.length && !/^\s/.test(text.slice(end))
  const insertion = `${needsLeadingSpace ? ' ' : ''}${insertText}${needsTrailingSpace ? ' ' : ''}`
  const nextText = `${text.slice(0, start)}${insertion}${text.slice(end)}`
  setText(nextText)

  window.requestAnimationFrame(() => {
    input?.focus()
    const cursor = start + insertion.length
    input?.setSelectionRange(cursor, cursor)
  })
}

export function getLanguageDisplayName(
  value: SupertonicTtsLanguageSelection,
  fallback: string,
  locale: string,
  autoLabel: string,
): string {
  if (value === 'auto') return autoLabel

  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(value) ?? fallback
  } catch {
    return fallback
  }
}
