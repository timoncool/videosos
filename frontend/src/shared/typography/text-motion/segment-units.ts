/**
 * Maps laid-out text lines to motion-text animation units.
 *
 * Input is the per-line strings exactly as the layout produces them
 * (`line.text` from `text-block-layout.ts`) so unit boundaries can never
 * drift from what the glyph pipeline actually draws. Output is, per line, an
 * array parallel to the line's **code points** (the GPU pipeline iterates
 * `for (const char of line.text)`) giving the unit index each character
 * belongs to — `null` means whitespace, which belongs to no unit.
 *
 * Unit indices are global across all lines so stagger/order math sees the
 * whole block as one sequence.
 */

import type { TextMotionUnit } from '@/types/text-motion'

export interface TextUnitSegmentation {
  /**
   * One entry per input line; each is parallel to `[...lineText]` (code
   * points). `null` = whitespace (no unit).
   */
  lineUnitIndices: (number | null)[][]
  /** Total number of units across all lines. */
  unitCount: number
}

const WHITESPACE_RE = /\s/u

function isWhitespaceChar(char: string): boolean {
  return WHITESPACE_RE.test(char)
}

// Cache the word Segmenter to avoid per-frame allocation + locale-data setup in
// the render hot path (called once per text item per frame during a motion
// window). Keyed on the current `Intl.Segmenter` reference so it's still read at
// call time — tests that stub/unstub `Intl.Segmenter` get a fresh instance.
let cachedSegmenter: Intl.Segmenter | null = null
let cachedSegmenterCtor: typeof Intl.Segmenter | undefined
function getWordSegmenter(): Intl.Segmenter | null {
  const ctor = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined
  if (typeof ctor !== 'function') return null
  if (ctor !== cachedSegmenterCtor) {
    cachedSegmenterCtor = ctor
    cachedSegmenter = new ctor(undefined, { granularity: 'word' })
  }
  return cachedSegmenter
}

/**
 * Word segmentation for one line via `Intl.Segmenter` (handles CJK).
 * Word-like segments each become a unit. Punctuation is never dropped: it
 * attaches to the previous unit on the line when one exists, otherwise to the
 * next word (leading quotes/brackets travel with their word); a line of pure
 * punctuation becomes a single unit.
 */
function segmentLineWords(
  line: string,
  segmenter: Intl.Segmenter,
  nextUnit: number,
): { indices: (number | null)[]; nextUnit: number } {
  const indices: (number | null)[] = []
  let lastUnitOnLine: number | null = null
  // Positions (in `indices`) of leading punctuation awaiting the next word.
  let pending: number[] = []

  for (const segment of segmenter.segment(line)) {
    if (segment.isWordLike) {
      const unit = nextUnit++
      for (const position of pending) indices[position] = unit
      pending = []
      lastUnitOnLine = unit
      const codePoints = Array.from(segment.segment).length
      for (let i = 0; i < codePoints; i++) indices.push(unit)
      continue
    }
    // Non-word segment: classify per code point (whitespace vs punctuation).
    for (const char of segment.segment) {
      if (isWhitespaceChar(char)) {
        indices.push(null)
      } else if (lastUnitOnLine !== null) {
        indices.push(lastUnitOnLine)
      } else {
        pending.push(indices.length)
        indices.push(null) // placeholder, resolved when the next word appears
      }
    }
  }

  if (pending.length > 0) {
    // Line with punctuation but no word-like segment: one unit for the run.
    const unit = nextUnit++
    for (const position of pending) indices[position] = unit
  }

  return { indices, nextUnit }
}

/** Fallback when `Intl.Segmenter` is unavailable: whitespace-run splitting. */
function segmentLineWordsFallback(
  line: string,
  nextUnit: number,
): { indices: (number | null)[]; nextUnit: number } {
  const indices: (number | null)[] = []
  let inWord = false
  for (const char of line) {
    if (isWhitespaceChar(char)) {
      indices.push(null)
      inWord = false
    } else {
      if (!inWord) {
        inWord = true
        nextUnit++
      }
      indices.push(nextUnit - 1)
    }
  }
  return { indices, nextUnit }
}

/**
 * Segment laid-out lines into animation units for the given unit granularity.
 *
 * - `character`: each non-whitespace code point is its own unit.
 * - `word`: `Intl.Segmenter('word')` word-like segments (CJK-aware), with a
 *   whitespace-split fallback; punctuation rides its adjacent word.
 * - `line`: every code point in a line (whitespace included) shares the
 *   line's index; `unitCount` is the line count.
 * - `whole-clip`: the entire block is a single unit (`unitCount` 1); stagger
 *   and order collapse to a no-op, so presets animate the whole title at once.
 */
export function segmentTextUnits(
  lineTexts: readonly string[],
  unit: TextMotionUnit,
): TextUnitSegmentation {
  const lineUnitIndices: (number | null)[][] = []

  if (unit === 'whole-clip') {
    // Entire block is one unit: every non-whitespace code point → unit 0.
    lineTexts.forEach((line) => {
      lineUnitIndices.push(Array.from(line, (char) => (isWhitespaceChar(char) ? null : 0)))
    })
    return { lineUnitIndices, unitCount: 1 }
  }

  if (unit === 'line') {
    lineTexts.forEach((line, lineIndex) => {
      lineUnitIndices.push(Array.from(line, () => lineIndex))
    })
    return { lineUnitIndices, unitCount: lineTexts.length }
  }

  if (unit === 'character') {
    let nextUnit = 0
    for (const line of lineTexts) {
      const indices: (number | null)[] = []
      for (const char of line) {
        indices.push(isWhitespaceChar(char) ? null : nextUnit++)
      }
      lineUnitIndices.push(indices)
    }
    return { lineUnitIndices, unitCount: nextUnit }
  }

  // unit === 'word'
  const segmenter = getWordSegmenter()
  let nextUnit = 0
  for (const line of lineTexts) {
    const result = segmenter
      ? segmentLineWords(line, segmenter, nextUnit)
      : segmentLineWordsFallback(line, nextUnit)
    lineUnitIndices.push(result.indices)
    nextUnit = result.nextUnit
  }
  return { lineUnitIndices, unitCount: nextUnit }
}
