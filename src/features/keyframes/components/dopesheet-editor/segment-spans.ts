/**
 * A clickable span between two consecutive keyframes, carrying the "from" datum
 * whose outgoing easing governs the interpolation across it.
 */
export interface SegmentSpan<T> {
  from: T
  fromFrame: number
  toFrame: number
  left: number
  width: number
}

/** Build clickable spans between consecutive plotted points, sorted by frame. */
export function buildSegmentSpans<T>(
  entries: Array<{ from: T; frame: number; x: number }>,
): SegmentSpan<T>[] {
  const sorted = [...entries].sort((a, b) => a.frame - b.frame)
  const spans: SegmentSpan<T>[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const left = Math.min(a.x, b.x)
    const width = Math.abs(b.x - a.x)
    if (width > 0) {
      spans.push({ from: a.from, fromFrame: a.frame, toFrame: b.frame, left, width })
    }
  }
  return spans
}
