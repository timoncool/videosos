/**
 * Pure interval math over source-second ranges, used by the transcript editor's
 * non-destructive "ignore" staging. Ranges are `{ start, end }` in source-native
 * seconds (the same shape as a removal range) and are kept normalized: sorted,
 * non-overlapping, non-adjacent.
 */

export interface SourceRange {
  start: number
  end: number
}

/** Treat gaps/overlaps smaller than this (seconds) as touching. */
const EPSILON = 1e-4

/** Sort, drop empty, and merge overlapping/adjacent ranges into a canonical list. */
export function normalizeRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const valid = ranges
    .filter((range) => range.end - range.start > EPSILON)
    .toSorted((a, b) => a.start - b.start)

  const out: SourceRange[] = []
  for (const range of valid) {
    const last = out[out.length - 1]
    if (last && range.start <= last.end + EPSILON) {
      last.end = Math.max(last.end, range.end)
    } else {
      out.push({ start: range.start, end: range.end })
    }
  }
  return out
}

/** Union of two range lists, normalized. */
export function unionRanges(a: readonly SourceRange[], b: readonly SourceRange[]): SourceRange[] {
  return normalizeRanges([...a, ...b])
}

/** `base` with everything covered by `cut` removed, normalized. */
export function subtractRanges(
  base: readonly SourceRange[],
  cut: readonly SourceRange[],
): SourceRange[] {
  const cuts = normalizeRanges(cut)
  let result = normalizeRanges(base)

  for (const hole of cuts) {
    const next: SourceRange[] = []
    for (const range of result) {
      // Disjoint — keep as-is.
      if (hole.end <= range.start || hole.start >= range.end) {
        next.push(range)
        continue
      }
      // Left remainder.
      if (hole.start > range.start) next.push({ start: range.start, end: hole.start })
      // Right remainder.
      if (hole.end < range.end) next.push({ start: hole.end, end: range.end })
    }
    result = next
  }
  return normalizeRanges(result)
}

/** Fraction of `[start, end)` covered by `ranges` (0–1). */
export function overlapFraction(
  start: number,
  end: number,
  ranges: readonly SourceRange[],
): number {
  const length = end - start
  if (length <= 0) return 0
  let covered = 0
  for (const range of ranges) {
    const lo = Math.max(start, range.start)
    const hi = Math.min(end, range.end)
    if (hi > lo) covered += hi - lo
  }
  return covered / length
}

/** Whether a word span is "ignored" — i.e. covered past the threshold (default 50%). */
export function isSpanIgnored(
  start: number,
  end: number,
  ranges: readonly SourceRange[] | undefined,
  threshold = 0.5,
): boolean {
  if (!ranges || ranges.length === 0) return false
  return overlapFraction(start, end, ranges) >= threshold
}

/** Total seconds across a normalized (or unnormalized) range list. */
export function totalRangeSeconds(ranges: readonly SourceRange[]): number {
  return normalizeRanges(ranges).reduce((sum, range) => sum + (range.end - range.start), 0)
}
