import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoFrameRateMetrics } from '@/types/storage'
import {
  FRAME_RATE_PROBE_PACKET_COUNT,
  probeVideoFrameRateMetrics,
  type VideoFrameRateTrack,
} from './video-frame-rate'

function metrics(overrides: Partial<VideoFrameRateMetrics> = {}): VideoFrameRateMetrics {
  return {
    underlyingFrameRate: 30000 / 1001,
    bestGuessFrameRate: 30000 / 1001,
    minFrameRate: 30000 / 1001,
    maxFrameRate: 30000 / 1001,
    averageFrameRate: 30000 / 1001,
    medianFrameRate: 30000 / 1001,
    frameRateIsConstant: true,
    probedPacketCount: 256,
    ...overrides,
  }
}

describe('probeVideoFrameRateMetrics', () => {
  it('uses MediaBunny bestGuessFrameRate and retains detailed timing classification', async () => {
    const resultMetrics = metrics({
      underlyingFrameRate: null,
      minFrameRate: 24,
      maxFrameRate: 30000 / 1001,
      averageFrameRate: 26.96,
      frameRateIsConstant: false,
      probedPacketCount: 108,
    })
    const computeFrameRateMetrics = vi.fn(async () => resultMetrics)

    const result = await probeVideoFrameRateMetrics({
      computeFrameRateMetrics,
    } satisfies VideoFrameRateTrack)

    expect(computeFrameRateMetrics).toHaveBeenCalledWith({
      targetPacketCount: FRAME_RATE_PROBE_PACKET_COUNT,
    })
    expect(result).toEqual({ fps: 30000 / 1001, metrics: resultMetrics })
  })

  it('rejects invalid metrics instead of persisting a corrupt source timebase', async () => {
    const track: VideoFrameRateTrack = {
      computeFrameRateMetrics: vi.fn(async () => metrics({ bestGuessFrameRate: 0 })),
    }

    await expect(probeVideoFrameRateMetrics(track)).rejects.toThrow(
      'invalid frame-rate metric bestGuessFrameRate',
    )
  })
})
