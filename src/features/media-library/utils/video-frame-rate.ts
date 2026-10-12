import type { VideoFrameRateMetrics } from '@/types/storage'

export const FRAME_RATE_PROBE_PACKET_COUNT = 256

export interface VideoFrameRateTrack {
  computeFrameRateMetrics(options?: {
    targetPacketCount?: number
  }): Promise<VideoFrameRateMetrics>
}

const POSITIVE_RATE_KEYS = [
  'bestGuessFrameRate',
  'minFrameRate',
  'maxFrameRate',
  'averageFrameRate',
  'medianFrameRate',
] as const satisfies readonly (keyof VideoFrameRateMetrics)[]

function assertValidFrameRateMetrics(metrics: VideoFrameRateMetrics): void {
  for (const key of POSITIVE_RATE_KEYS) {
    const value = metrics[key]
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`MediaBunny returned invalid frame-rate metric ${key}: ${value}`)
    }
  }

  if (
    metrics.underlyingFrameRate !== null &&
    (!Number.isFinite(metrics.underlyingFrameRate) || metrics.underlyingFrameRate <= 0)
  ) {
    throw new Error(
      `MediaBunny returned invalid underlying frame rate: ${metrics.underlyingFrameRate}`,
    )
  }

  if (!Number.isInteger(metrics.probedPacketCount) || metrics.probedPacketCount < 0) {
    throw new Error(`MediaBunny returned invalid probed packet count: ${metrics.probedPacketCount}`)
  }
}

/**
 * Probe timestamp-derived frame-rate metrics without decoding video samples.
 *
 * The best-guess rate is the scalar used by FreeCut's source-frame model. The
 * complete metrics remain attached so VFR and dropped-frame media are not
 * misclassified as ordinary CFR media.
 */
export async function probeVideoFrameRateMetrics(
  track: VideoFrameRateTrack,
): Promise<{ fps: number; metrics: VideoFrameRateMetrics }> {
  const metrics = await track.computeFrameRateMetrics({
    targetPacketCount: FRAME_RATE_PROBE_PACKET_COUNT,
  })
  assertValidFrameRateMetrics(metrics)
  return { fps: metrics.bestGuessFrameRate, metrics }
}
