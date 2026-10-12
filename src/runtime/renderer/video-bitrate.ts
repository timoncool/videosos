import type { ExportSettings, SourceVideoEncodingInfo, VideoRateControl } from '@/types/export'

export interface ResolveVideoBitrateOptions {
  codec: ExportSettings['codec']
  quality: ExportSettings['quality']
  width: number
  height: number
  fps: number
  rateControl?: VideoRateControl
  customBitrate?: number
  sourceVideo?: SourceVideoEncodingInfo
}

const REFERENCE_PIXELS = 1920 * 1080
const REFERENCE_FPS = 30
const REFERENCE_BITRATE = 3_000_000

const QUALITY_FACTORS: Record<ExportSettings['quality'], number> = {
  low: 0.6,
  medium: 1,
  high: 2,
  ultra: 4,
}

const CODEC_FACTORS: Record<ExportSettings['codec'], number> = {
  h264: 1,
  h265: 0.6,
  vp8: 1.2,
  vp9: 0.6,
  av1: 0.4,
  prores: 220_000_000 / REFERENCE_BITRATE,
}

export function normalizeVideoCodec(codec: string): ExportSettings['codec'] | null {
  const normalized = codec.trim().toLowerCase()
  if (/^(h\.?264|avc|avc1)/.test(normalized)) return 'h264'
  if (/^(h\.?265|hevc|hvc1|hev1)/.test(normalized)) return 'h265'
  if (/^(vp0?8)/.test(normalized)) return 'vp8'
  if (/^(vp0?9)/.test(normalized)) return 'vp9'
  if (/^(av0?1)/.test(normalized)) return 'av1'
  if (normalized.includes('prores')) return 'prores'
  return null
}

function roundBitrate(bitrate: number): number {
  return Math.max(100_000, Math.round(bitrate / 1000) * 1000)
}

export function getPresetVideoBitrate(options: ResolveVideoBitrateOptions): number {
  const pixels = Math.max(1, options.width * options.height)
  const resolutionScale = Math.pow(pixels / REFERENCE_PIXELS, 0.95)
  // Frame-rate cost grows sub-linearly because inter-frame prediction reuses information.
  const frameRateScale = Math.pow(Math.max(1, options.fps) / REFERENCE_FPS, 0.5)
  return roundBitrate(
    REFERENCE_BITRATE *
      resolutionScale *
      frameRateScale *
      QUALITY_FACTORS[options.quality] *
      CODEC_FACTORS[options.codec],
  )
}

function getSourceAwareBitrate(
  options: ResolveVideoBitrateOptions,
  presetBitrate: number,
  source: SourceVideoEncodingInfo,
): number {
  if (source.bitrate <= 0 || source.fps <= 0) return presetBitrate

  const sourceCodec = normalizeVideoCodec(source.codec)
  const sourceCodecFactor = sourceCodec ? CODEC_FACTORS[sourceCodec] : CODEC_FACTORS.h264
  const targetCodecFactor = CODEC_FACTORS[options.codec]
  const frameRateScale = Math.pow(Math.max(1, options.fps) / source.fps, 0.5)
  // Re-encoding needs headroom over the source to limit generation loss.
  const sourceEquivalent =
    source.bitrate * (targetCodecFactor / sourceCodecFactor) * frameRateScale * 1.5

  // Source metadata guides Auto without allowing pathological source files to
  // overwhelm the selected quality tier.
  return roundBitrate(
    Math.min(presetBitrate * 1.25, Math.max(presetBitrate * 0.75, sourceEquivalent)),
  )
}

export function resolveVideoBitrate(options: ResolveVideoBitrateOptions): number {
  const rateControl = options.rateControl ?? 'auto'
  if (rateControl !== 'auto' && options.customBitrate && options.customBitrate > 0) {
    return roundBitrate(options.customBitrate)
  }

  const presetBitrate = getPresetVideoBitrate(options)
  return options.sourceVideo
    ? getSourceAwareBitrate(options, presetBitrate, options.sourceVideo)
    : presetBitrate
}
