/**
 * Fast histogram-based scene detection — CPU-only, no WebGPU required.
 *
 * Compares consecutive frames using RGB color histograms. A scene cut is
 * detected when the chi-squared distance between histograms exceeds a
 * threshold. This sparse path favors speed over frame-accurate timing.
 */

import { createLogger } from '@/shared/logging/logger'
import type { SceneCut, SceneDetectionProgress } from './scene-detection-types'
import { seekVideo, deduplicateCuts } from './scene-detection-utils'

const log = createLogger('HistogramSceneDetection')

/** Number of bins per RGB channel */
const BINS_PER_CHANNEL = 32
const TOTAL_BINS = BINS_PER_CHANNEL * 3

/** Analysis resolution — small enough for speed, large enough for accuracy */
const HIST_WIDTH = 160
const HIST_HEIGHT = 90

/**
 * Chi-squared distance threshold for a scene cut.
 * Empirically tuned: hard cuts typically score 0.5–2.0+, same-scene
 * frames score < 0.15. Threshold of 0.3 catches most hard cuts with
 * few false positives.
 */
const CHI_SQUARED_THRESHOLD = 0.3

/** Cluster only duplicate candidates from the same sparse sampling window. */
const MAX_CANDIDATE_CLUSTER_SEC = 0.25

/**
 * Compute a normalized RGB histogram from pixel data.
 * Returns an array of TOTAL_BINS floats summing to 3.0 (1.0 per channel).
 */
export function computeHistogram(pixels: Uint8ClampedArray): Float32Array {
  const hist = new Float32Array(TOTAL_BINS)
  const binScale = BINS_PER_CHANNEL / 256
  const pixelCount = pixels.length / 4

  for (let i = 0; i < pixels.length; i += 4) {
    const rBin = Math.min((pixels[i]! * binScale) | 0, BINS_PER_CHANNEL - 1)
    const gBin = Math.min((pixels[i + 1]! * binScale) | 0, BINS_PER_CHANNEL - 1)
    const bBin = Math.min((pixels[i + 2]! * binScale) | 0, BINS_PER_CHANNEL - 1)
    hist[rBin]!++
    hist[BINS_PER_CHANNEL + gBin]!++
    hist[BINS_PER_CHANNEL * 2 + bBin]!++
  }

  // Normalize each channel to sum to 1.0
  for (let c = 0; c < 3; c++) {
    const offset = c * BINS_PER_CHANNEL
    for (let b = 0; b < BINS_PER_CHANNEL; b++) {
      hist[offset + b]! /= pixelCount
    }
  }

  return hist
}

/**
 * Chi-squared distance between two normalized histograms.
 * Returns 0 for identical histograms, higher values for more difference.
 */
export function chiSquaredDistance(a: Float32Array, b: Float32Array): number {
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const sum = a[i]! + b[i]!
    if (sum > 0) {
      const diff = a[i]! - b[i]!
      distance += (diff * diff) / sum
    }
  }
  return distance
}

export interface HistogramDetectOptions {
  /** Time between samples in ms (default: 250) */
  sampleIntervalMs?: number
  /** Chi-squared threshold for cut detection (default: 0.3) */
  threshold?: number
  /** Progress callback */
  onProgress?: (progress: SceneDetectionProgress) => void
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Detect scene cuts using color histogram comparison.
 * Returns cuts sorted by time.
 */
export async function detectScenesHistogram(
  video: HTMLVideoElement,
  options: HistogramDetectOptions = {},
): Promise<SceneCut[]> {
  const { sampleIntervalMs = 250, threshold = CHI_SQUARED_THRESHOLD, onProgress, signal } = options

  const duration = video.duration
  const sampleIntervalSec = sampleIntervalMs / 1000
  const totalSamples = Math.ceil(duration / sampleIntervalSec)

  const canvas = new OffscreenCanvas(HIST_WIDTH, HIST_HEIGHT)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const rawCuts: SceneCut[] = []
  let prevHist: Float32Array | null = null
  let maxDistance = 0

  for (let i = 0; i < totalSamples; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const time = i * sampleIntervalSec
    await seekVideo(video, time)

    ctx.drawImage(video, 0, 0, HIST_WIDTH, HIST_HEIGHT)
    const imageData = ctx.getImageData(0, 0, HIST_WIDTH, HIST_HEIGHT)
    const hist = computeHistogram(imageData.data)

    if (prevHist) {
      const distance = chiSquaredDistance(prevHist, hist)
      if (distance > maxDistance) maxDistance = distance

      if (distance >= threshold) {
        rawCuts.push({
          time,
          score: distance,
          confidence: Math.min(1, 0.5 + (distance - threshold) / Math.max(threshold * 2, 0.001)),
          type: 'cut',
          metrics: { kind: 'histogram', histogramDistance: distance },
        })
      }
    }

    prevHist = hist

    onProgress?.({
      percent: ((i + 1) / totalSamples) * 100,
      sceneCuts: rawCuts.length,
      completed: i + 1,
      total: totalSamples,
      stage: 'analyzing',
    })
  }

  log.info('Histogram analysis complete', {
    totalSamples,
    maxDistance: maxDistance.toFixed(4),
    rawCuts: rawCuts.length,
    threshold,
  })

  const clusterWindowSec = Math.min(MAX_CANDIDATE_CLUSTER_SEC, sampleIntervalSec)
  const deduped = deduplicateCuts(rawCuts, clusterWindowSec)
  log.info('Deduplication complete', { cuts: deduped.length })

  return deduped
}
