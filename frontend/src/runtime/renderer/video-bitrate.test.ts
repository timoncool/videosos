// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { getPresetVideoBitrate, normalizeVideoCodec, resolveVideoBitrate } from './video-bitrate'

describe('video bitrate resolution', () => {
  it('uses a codec-aware 1080p30 baseline', () => {
    const base = {
      quality: 'medium' as const,
      width: 1920,
      height: 1080,
      fps: 30,
    }

    expect(getPresetVideoBitrate({ ...base, codec: 'h264' })).toBe(3_000_000)
    expect(getPresetVideoBitrate({ ...base, codec: 'h265' })).toBe(1_800_000)
    expect(getPresetVideoBitrate({ ...base, codec: 'av1' })).toBe(1_200_000)
  })

  it('scales with resolution and frame rate', () => {
    const hd30 = getPresetVideoBitrate({
      codec: 'h264',
      quality: 'high',
      width: 1920,
      height: 1080,
      fps: 30,
    })
    const hd60 = getPresetVideoBitrate({
      codec: 'h264',
      quality: 'high',
      width: 1920,
      height: 1080,
      fps: 60,
    })
    const uhd30 = getPresetVideoBitrate({
      codec: 'h264',
      quality: 'high',
      width: 3840,
      height: 2160,
      fps: 30,
    })

    expect(hd60).toBeGreaterThan(hd30)
    expect(uhd30).toBeGreaterThan(hd60)
  })

  it('uses source metadata in Auto mode while staying inside the quality tier', () => {
    expect(
      resolveVideoBitrate({
        codec: 'h264',
        quality: 'medium',
        width: 1920,
        height: 1080,
        fps: 30,
        sourceVideo: { bitrate: 2_879_532, fps: 60, codec: 'avc1.64002a' },
      }),
    ).toBe(3_054_000)
  })

  it('honors custom VBR and CBR targets', () => {
    for (const rateControl of ['variable', 'constant'] as const) {
      expect(
        resolveVideoBitrate({
          codec: 'h264',
          quality: 'medium',
          width: 1920,
          height: 1080,
          fps: 30,
          rateControl,
          customBitrate: 4_123_456,
        }),
      ).toBe(4_123_000)
    }
  })

  it('normalizes common codec metadata strings', () => {
    expect(normalizeVideoCodec('avc1.64002a')).toBe('h264')
    expect(normalizeVideoCodec('HEVC')).toBe('h265')
    expect(normalizeVideoCodec('vp09.00.10.08')).toBe('vp9')
    expect(normalizeVideoCodec('av01.0.08M.08')).toBe('av1')
  })
})
