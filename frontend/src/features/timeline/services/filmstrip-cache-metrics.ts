/**
 * Per-extraction metrics tracking for the filmstrip cache.
 *
 * Owns a ring buffer of recent extraction samples and the lifetime totals
 * (`started/completed/failed/aborted`). The cache layer constructs an
 * {@link ExtractionMetrics} when it begins extracting a clip and finalizes
 * it on completion/failure; the accumulator then exposes an aggregated
 * {@link FilmstripMetricsSnapshot} for the debug UI.
 *
 * Memory-related fields in the snapshot are supplied by the cache itself —
 * this module owns only the extraction-timing portion.
 */
import { METRICS_HISTORY_LIMIT } from './filmstrip-cache-config'

export type ExtractionOutcome = 'completed' | 'failed' | 'aborted'

export interface ExtractionMetrics {
  id: string
  mediaId: string
  startedAtMs: number
  firstFrameAtMs: number | null
  targetFrames: number
  existingTargetFrames: number
  framesToExtract: number
  priorityFrames: number
  backgroundStride: number
  workerCount: number
  usedVideoFallback: boolean
}

export interface ExtractionMetricSample {
  id: string
  mediaId: string
  startedAtMs: number
  durationMs: number
  timeToFirstFrameMs: number | null
  targetFrames: number
  existingTargetFrames: number
  framesToExtract: number
  priorityFrames: number
  backgroundStride: number
  workerCount: number
  usedVideoFallback: boolean
  extractedFrames: number
  outcome: ExtractionOutcome
}

export interface FilmstripMetricsTotals {
  started: number
  completed: number
  failed: number
  aborted: number
}

export interface FilmstripMetricsAverages {
  durationMs: number
  timeToFirstFrameMs: number
  extractFramesPerSecond: number
}

export interface FilmstripMetricsMemory {
  cacheBytes: number
  cacheEntries: number
  activeExtractions: number
  queuedExtractions: number
  usedJSHeapBytes: number | null
  maxConcurrentExtractions: number
}

export interface FilmstripMetricsSnapshot {
  totals: FilmstripMetricsTotals
  averages: FilmstripMetricsAverages
  memory: FilmstripMetricsMemory
  recent: ExtractionMetricSample[]
}

export class FilmstripMetricsAccumulator {
  private totals: FilmstripMetricsTotals = {
    started: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
  }
  private history: ExtractionMetricSample[] = []

  noteExtractionStarted(): void {
    this.totals.started++
  }

  /**
   * Marks the time the first frame was decoded — used to compute
   * time-to-first-pixel. If the clip already had cached frames at start,
   * the caller seeds this immediately.
   */
  noteFirstFrame(metrics: ExtractionMetrics): void {
    if (metrics.firstFrameAtMs === null) {
      metrics.firstFrameAtMs = Date.now()
    }
  }

  finalize(metrics: ExtractionMetrics, outcome: ExtractionOutcome, extractedFrames: number): void {
    const now = Date.now()
    const sample: ExtractionMetricSample = {
      id: metrics.id,
      mediaId: metrics.mediaId,
      startedAtMs: metrics.startedAtMs,
      durationMs: Math.max(0, now - metrics.startedAtMs),
      timeToFirstFrameMs:
        metrics.firstFrameAtMs === null
          ? null
          : Math.max(0, metrics.firstFrameAtMs - metrics.startedAtMs),
      targetFrames: metrics.targetFrames,
      existingTargetFrames: metrics.existingTargetFrames,
      framesToExtract: metrics.framesToExtract,
      priorityFrames: metrics.priorityFrames,
      backgroundStride: metrics.backgroundStride,
      workerCount: metrics.workerCount,
      usedVideoFallback: metrics.usedVideoFallback,
      extractedFrames,
      outcome,
    }

    this.history.push(sample)
    if (this.history.length > METRICS_HISTORY_LIMIT) {
      this.history.shift()
    }

    if (outcome === 'completed') this.totals.completed++
    if (outcome === 'failed') this.totals.failed++
    if (outcome === 'aborted') this.totals.aborted++
  }

  snapshot(memory: FilmstripMetricsMemory): FilmstripMetricsSnapshot {
    const recent = [...this.history]
    const completed = recent.filter((sample) => sample.outcome === 'completed')
    // Exclude trivial extractions (single-frame or sub-250ms) from averages
    // so a burst of cache hits doesn't skew throughput numbers downward.
    const completedForAverages = completed.filter(
      (sample) => sample.framesToExtract > 1 && sample.durationMs >= 250,
    )
    const averageSamples = completedForAverages.length > 0 ? completedForAverages : completed
    const durationAvg =
      averageSamples.length > 0
        ? averageSamples.reduce((sum, sample) => sum + sample.durationMs, 0) / averageSamples.length
        : 0
    const ttfpSamples = averageSamples.filter((sample) => sample.timeToFirstFrameMs !== null)
    const ttfpAvg =
      ttfpSamples.length > 0
        ? ttfpSamples.reduce((sum, sample) => sum + (sample.timeToFirstFrameMs ?? 0), 0) /
          ttfpSamples.length
        : 0
    const throughputAvg =
      averageSamples.length > 0
        ? averageSamples.reduce((sum, sample) => {
            const seconds = Math.max(0.001, sample.durationMs / 1000)
            return sum + sample.framesToExtract / seconds
          }, 0) / averageSamples.length
        : 0

    return {
      totals: { ...this.totals },
      averages: {
        durationMs: Math.round(durationAvg),
        timeToFirstFrameMs: Math.round(ttfpAvg),
        extractFramesPerSecond: Math.round(throughputAvg * 100) / 100,
      },
      memory,
      recent,
    }
  }

  clear(): void {
    this.totals = { started: 0, completed: 0, failed: 0, aborted: 0 }
    this.history = []
  }
}
