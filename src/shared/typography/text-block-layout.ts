/**
 * Framework-agnostic text block layout — the single geometry source consumed
 * by the Canvas 2D renderer (skim + export) and the GPU glyph atlas. Given a
 * text item, a box size, and a {@link TextMeasurer}, it produces wrapped lines
 * with box-local positions (line top, alphabetic baseline, left-anchored draw
 * origin) plus the optional background rect.
 *
 * All coordinates are box-local (relative to the text box top-left). Canvas
 * callers add the item's on-canvas offset; the GPU pipeline renders into the
 * box directly and uses them as-is.
 *
 * Letter-spacing follows CSS: `width` includes the trailing spacing after the
 * last glyph, and centered/right-aligned origins are derived from that width,
 * so the ink lands exactly where the DOM preview puts it.
 */

import type { TextStyleInput } from './text-style'
import { resolveSpanStyles, resolveTextStyle } from './text-style'
import type { TextMeasurer } from './text-measurer'

/**
 * A styled sub-range of an inline-flowed line (`spanLayout: 'inline'`).
 * Runs share the line's font/size/letter-spacing; only color and underline
 * vary. Painters that ignore `runs` still draw the full line in the line's
 * base style — geometry is identical either way.
 */
export interface LaidOutRun {
  text: string
  color: string
  underline: boolean
  /** Advance offset from the line's startX. */
  offsetX: number
  width: number
}

export interface LaidOutLine {
  text: string
  cssFont: string
  fontSize: number
  color: string
  letterSpacing: number
  underline: boolean
  /** Occupied advance width incl. trailing letter-spacing. */
  width: number
  /** Box-local y of the line-box top. */
  top: number
  /** Box-local y of the alphabetic baseline. */
  baselineY: number
  /** Box-local x of the left edge of the occupied box (left-anchored origin). */
  startX: number
  lineHeightPx: number
  /** Present only for inline span flow — color/underline sub-ranges. */
  runs?: LaidOutRun[]
}

export interface TextBlockBackground {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export interface TextBlockLayout {
  lines: LaidOutLine[]
  totalHeight: number
  background?: TextBlockBackground
}

function breakWord(
  word: string,
  cssFont: string,
  letterSpacing: number,
  maxWidth: number,
  measurer: TextMeasurer,
): string[] {
  const segments: string[] = []
  let current = ''
  for (const char of word) {
    const test = current + char
    if (measurer.measure(test, cssFont, letterSpacing) > maxWidth && current) {
      segments.push(current)
      current = char
    } else {
      current = test
    }
  }
  if (current) segments.push(current)
  return segments
}

function wrapText(
  text: string,
  cssFont: string,
  letterSpacing: number,
  maxWidth: number,
  measurer: TextMeasurer,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let currentLine = ''
    for (const word of paragraph.split(' ')) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (measurer.measure(testLine, cssFont, letterSpacing) > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
        if (measurer.measure(word, cssFont, letterSpacing) > maxWidth) {
          const broken = breakWord(word, cssFont, letterSpacing, maxWidth, measurer)
          for (let i = 0; i < broken.length - 1; i++) lines.push(broken[i] ?? '')
          currentLine = broken[broken.length - 1] ?? ''
        }
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)
  }
  return lines.length > 0 ? lines : ['']
}

interface InlineWord {
  text: string
  /** Style index (into spans) per character of `text`. */
  charStyles: number[]
  /**
   * The exact run of spaces authored before this word, kept verbatim.
   *
   * The DOM preview renders span text with `white-space: pre-wrap`, so repeated,
   * leading and trailing spaces are all visible there. Normalising them to a
   * single separator here would make canvas/GPU export and `dumpLayout` measure
   * and wrap differently from what the preview shows — the exact silent
   * divergence this layout path exists to avoid.
   */
  leading: string
  /** Style index per character of `leading`. */
  leadingStyles: number[]
}

/** Split concatenated inline spans into paragraphs of words with per-char style ids. */
function tokenizeInlineSpans(spans: ReturnType<typeof resolveSpanStyles>): InlineWord[][] {
  const paragraphs: InlineWord[][] = [[]]
  let currentWord: InlineWord | null = null
  let pendingSpaces = ''
  let pendingSpaceStyles: number[] = []

  const startWord = (): InlineWord => {
    const word: InlineWord = {
      text: '',
      charStyles: [],
      leading: pendingSpaces,
      leadingStyles: pendingSpaceStyles,
    }
    pendingSpaces = ''
    pendingSpaceStyles = []
    return word
  }
  const flushWord = () => {
    if (currentWord) paragraphs[paragraphs.length - 1]!.push(currentWord)
    currentWord = null
  }
  // Spaces with nothing after them still occupy the line (pre-wrap keeps them),
  // so they are emitted as a text-less word rather than dropped.
  const flushDanglingSpaces = () => {
    if (pendingSpaces.length > 0) paragraphs[paragraphs.length - 1]!.push(startWord())
  }

  for (let spanIndex = 0; spanIndex < spans.length; spanIndex++) {
    for (const char of spans[spanIndex]!.text) {
      if (char === '\n') {
        flushWord()
        flushDanglingSpaces()
        paragraphs.push([])
      } else if (char === ' ') {
        flushWord()
        pendingSpaces += char
        pendingSpaceStyles.push(spanIndex)
      } else {
        if (!currentWord) currentWord = startWord()
        currentWord.text += char
        currentWord.charStyles.push(spanIndex)
      }
    }
  }
  flushWord()
  flushDanglingSpaces()
  return paragraphs
}

/** Group a line's chars into color/underline runs with prefix-measured offsets. */
function buildLineRuns(
  text: string,
  charStyles: number[],
  spans: ReturnType<typeof resolveSpanStyles>,
  measure: (text: string) => number,
): LaidOutRun[] {
  const runs: LaidOutRun[] = []
  let runStart = 0
  for (let i = 1; i <= text.length; i++) {
    if (i !== text.length && charStyles[i] === charStyles[runStart]) continue
    const span = spans[charStyles[runStart] ?? 0] ?? spans[0]!
    const prefixWidth = runStart === 0 ? 0 : measure(text.slice(0, runStart))
    runs.push({
      text: text.slice(runStart, i),
      color: span.color,
      underline: span.underline,
      offsetX: prefixWidth,
      width: measure(text.slice(0, i)) - prefixWidth,
    })
    runStart = i
  }
  return runs
}

/**
 * Inline span flow (`spanLayout: 'inline'`): spans are concatenated into one
 * text stream and wrapped by box width; each wrapped line carries `runs`
 * describing the color/underline sub-ranges. All runs share the FIRST span's
 * font/size/letter-spacing — mixed fonts/sizes on one line are out of scope
 * (such spans render in the base font).
 */
function layoutInlineSpanLines(
  spans: ReturnType<typeof resolveSpanStyles>,
  lineHeightFactor: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LaidOutLine[] {
  const base = spans[0]!
  const metrics = measurer.fontMetrics(base.cssFont)
  const lineHeightPx = base.fontSize * lineHeightFactor
  const halfLeading = (lineHeightPx - (metrics.ascent + metrics.descent)) / 2
  const baselineOffset = halfLeading + metrics.ascent

  const paragraphs = tokenizeInlineSpans(spans)

  const measure = (text: string) => measurer.measure(text, base.cssFont, base.letterSpacing)

  const lines: LaidOutLine[] = []
  /**
   * `isContinuation` marks a line produced by wrapping rather than by a newline.
   * The space run that caused the break is consumed by it — pre-wrap hangs those
   * spaces at the end of the previous line instead of indenting the next one —
   * whereas spaces at the start of an authored paragraph are a real indent and
   * are kept.
   */
  const pushLine = (words: InlineWord[], isContinuation = false) => {
    let text = ''
    const charStyles: number[] = []
    for (const [wordIndex, word] of words.entries()) {
      if (wordIndex > 0 || !isContinuation) {
        text += word.leading
        charStyles.push(...word.leadingStyles)
      }
      text += word.text
      charStyles.push(...word.charStyles)
    }

    const runs = buildLineRuns(text, charStyles, spans, measure)

    lines.push({
      text,
      cssFont: base.cssFont,
      fontSize: base.fontSize,
      color: base.color,
      letterSpacing: base.letterSpacing,
      underline: false,
      width: measure(text),
      top: 0,
      baselineY: baselineOffset, // refined by the caller once block top is known
      startX: 0,
      lineHeightPx,
      runs,
    })
  }

  for (const words of paragraphs) {
    if (words.length === 0) {
      pushLine([])
      continue
    }
    let lineWords: InlineWord[] = []
    let lineText = ''
    let isContinuation = false
    for (const word of words) {
      // Measure with the authored spacing, not a normalised single space —
      // otherwise a run of spaces wraps at the wrong point. The condition must
      // match pushLine's exactly, or measurement and output disagree.
      const leading = lineWords.length > 0 || !isContinuation ? word.leading : ''
      const testText = lineText + leading + word.text
      if (measure(testText) > availableWidth && lineWords.length > 0) {
        pushLine(lineWords, isContinuation)
        isContinuation = true
        lineWords = [word]
        lineText = word.text
      } else {
        lineWords.push(word)
        lineText = testText
      }
      // Overlong single words fall through un-broken (rare for inline accents);
      // the stack path's char-breaking can be ported here if it ever matters.
    }
    if (lineWords.length > 0) pushLine(lineWords, isContinuation)
  }

  return lines
}

export function layoutTextBlock(
  item: TextStyleInput,
  boxWidth: number,
  boxHeight: number,
  measurer: TextMeasurer,
): TextBlockLayout {
  const style = resolveTextStyle(item)
  const spans = resolveSpanStyles(item)
  const padding = style.textPadding
  const availableWidth = Math.max(1, boxWidth - padding * 2)
  const availableHeight = boxHeight - padding * 2

  const inlineFlow =
    (item as { spanLayout?: 'stack' | 'inline' }).spanLayout === 'inline' && spans.length > 0

  const lines: LaidOutLine[] = inlineFlow
    ? layoutInlineSpanLines(spans, style.lineHeight, availableWidth, measurer)
    : []
  if (!inlineFlow) {
    for (const span of spans) {
      const metrics = measurer.fontMetrics(span.cssFont)
      const lineHeightPx = span.fontSize * style.lineHeight
      const halfLeading = (lineHeightPx - (metrics.ascent + metrics.descent)) / 2
      const baselineOffset = halfLeading + metrics.ascent
      for (const text of wrapText(
        span.text,
        span.cssFont,
        span.letterSpacing,
        availableWidth,
        measurer,
      )) {
        lines.push({
          text,
          cssFont: span.cssFont,
          fontSize: span.fontSize,
          color: span.color,
          letterSpacing: span.letterSpacing,
          underline: span.underline,
          width: measurer.measure(text, span.cssFont, span.letterSpacing),
          top: 0,
          baselineY: baselineOffset, // refined below once block top is known
          startX: 0,
          lineHeightPx,
        })
      }
    }
  }

  const totalHeight = lines.reduce((sum, line) => sum + line.lineHeightPx, 0)
  const blockTop =
    style.verticalAlign === 'top'
      ? padding
      : style.verticalAlign === 'bottom'
        ? boxHeight - padding - totalHeight
        : padding + (availableHeight - totalHeight) / 2

  let cursorTop = blockTop
  for (const line of lines) {
    line.top = cursorTop
    line.baselineY = cursorTop + line.baselineY
    // Center ignores padding (centers in the full box); left/right respect it.
    line.startX =
      style.textAlign === 'left'
        ? padding
        : style.textAlign === 'right'
          ? boxWidth - padding - line.width
          : (boxWidth - line.width) / 2
    cursorTop += line.lineHeightPx
  }

  let background: TextBlockBackground | undefined
  if (style.backgroundColor && lines.length > 0) {
    const maxLineWidth = Math.max(...lines.map((line) => line.width))
    const backgroundCenterX =
      style.textAlign === 'left'
        ? padding + maxLineWidth / 2
        : style.textAlign === 'right'
          ? boxWidth - padding - maxLineWidth / 2
          : boxWidth / 2
    const width = Math.min(boxWidth, maxLineWidth + padding * 2)
    const height = totalHeight + padding * 2
    background = {
      x: backgroundCenterX - width / 2,
      y: blockTop - padding,
      width,
      height,
      // Clamp to the background rect (not the box) so the rounded corners can't
      // exceed half the rect — both canvas roundRect and the GPU SDF re-clamp,
      // so the rendered result is identical either way.
      radius: Math.max(0, Math.min(style.backgroundRadius, width / 2, height / 2)),
    }
  }

  return { lines, totalHeight, background }
}

/** Width of the visible ink (excludes the trailing letter-spacing). */
export function lineInkWidth(line: LaidOutLine): number {
  return Math.max(0, line.width - line.letterSpacing)
}
