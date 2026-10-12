// Single source of truth for "if-defined-then-clamp" timeline-item field
// normalization. Used by both the runtime items-store normalizer and the
// project-load migration normalizer so a new audio/frame field only needs to
// be registered once.

import { clampAudioFadeCurve, clampAudioFadeCurveX } from '@/shared/utils/audio-fade-curve'
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  clampAudioEqCutSlopeDbPerOct,
  clampAudioEqFrequencyHz,
  clampAudioEqGainDb,
  clampAudioEqQ,
} from '@/shared/utils/audio-eq'
import { clampAudioPitchCents, clampAudioPitchSemitones } from '@/shared/utils/audio-pitch'
import { normalizeCropSettings } from '@/shared/utils/media-crop'
import type { CropSettings } from '@/types/transform'

export function roundFrame(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

export function roundDuration(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

export function roundOptionalFrame(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return roundFrame(value)
}

export function normalizeOptionalFps(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value * 1000) / 1000
}

interface EqBandSpec {
  prefix: string
  freq?: { min: number; max: number; def: number }
  qDefault?: number
  hasEnabled?: boolean
  hasGain?: boolean
  hasSlope?: boolean
}

// EQ bands ordered low → high. Band1 and Band6 are full-featured aliases
// for the cut bands kept for legacy projects; LowCut and HighCut carry the
// enabled/freq/slope subset used by the simplified UI.
const EQ_BANDS: readonly EqBandSpec[] = [
  {
    prefix: 'audioEqBand1',
    hasEnabled: true,
    hasGain: true,
    hasSlope: true,
    qDefault: AUDIO_EQ_LOW_MID_Q,
    freq: {
      min: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqLowCut',
    hasEnabled: true,
    hasSlope: true,
    freq: {
      min: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqLow',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_LOW_MID_Q,
    freq: {
      min: AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqLowMid',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_LOW_MID_Q,
    freq: {
      min: AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    },
  },
  { prefix: 'audioEqMid', hasGain: true },
  {
    prefix: 'audioEqHighMid',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_HIGH_MID_Q,
    freq: {
      min: AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqHigh',
    hasEnabled: true,
    hasGain: true,
    qDefault: AUDIO_EQ_HIGH_MID_Q,
    freq: {
      min: AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqBand6',
    hasEnabled: true,
    hasGain: true,
    hasSlope: true,
    qDefault: AUDIO_EQ_HIGH_MID_Q,
    freq: {
      min: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    },
  },
  {
    prefix: 'audioEqHighCut',
    hasEnabled: true,
    hasSlope: true,
    freq: {
      min: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      max: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      def: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    },
  },
]

interface FieldClamp {
  key: string
  clamp: (value: unknown) => unknown
}

function buildEqBandClamps(band: EqBandSpec): FieldClamp[] {
  const clamps: FieldClamp[] = []
  if (band.hasEnabled) {
    clamps.push({ key: `${band.prefix}Enabled`, clamp: (v) => !!v })
  }
  if (band.hasGain) {
    clamps.push({
      key: `${band.prefix}GainDb`,
      clamp: (v) => clampAudioEqGainDb(v as number),
    })
  }
  if (band.freq) {
    const { min, max, def } = band.freq
    clamps.push({
      key: `${band.prefix}FrequencyHz`,
      clamp: (v) => clampAudioEqFrequencyHz(v as number, min, max, def),
    })
  }
  if (band.qDefault !== undefined) {
    const qDef = band.qDefault
    clamps.push({ key: `${band.prefix}Q`, clamp: (v) => clampAudioEqQ(v as number, qDef) })
  }
  if (band.hasSlope) {
    clamps.push({
      key: `${band.prefix}SlopeDbPerOct`,
      clamp: (v) => clampAudioEqCutSlopeDbPerOct(v as number),
    })
  }
  return clamps
}

const OPTIONAL_FIELD_CLAMPS: ReadonlyArray<FieldClamp> = [
  // Frame fields
  { key: 'trimStart', clamp: (v) => roundFrame(v as number) },
  { key: 'trimEnd', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceStart', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceEnd', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceDuration', clamp: (v) => roundFrame(v as number) },
  { key: 'sourceFps', clamp: (v) => normalizeOptionalFps(v as number) },
  { key: 'crop', clamp: (v) => normalizeCropSettings(v as CropSettings) },
  // Audio fades
  { key: 'audioFadeInCurve', clamp: (v) => clampAudioFadeCurve(v as number) },
  { key: 'audioFadeOutCurve', clamp: (v) => clampAudioFadeCurve(v as number) },
  { key: 'audioFadeInCurveX', clamp: (v) => clampAudioFadeCurveX(v as number) },
  { key: 'audioFadeOutCurveX', clamp: (v) => clampAudioFadeCurveX(v as number) },
  // Pitch
  { key: 'audioPitchSemitones', clamp: (v) => clampAudioPitchSemitones(v as number) },
  { key: 'audioPitchCents', clamp: (v) => clampAudioPitchCents(v as number) },
  // EQ output + bands
  { key: 'audioEqOutputGainDb', clamp: (v) => clampAudioEqGainDb(v as number) },
  ...EQ_BANDS.flatMap(buildEqBandClamps),
]

export function applyOptionalClamps(target: Record<string, unknown>): void {
  for (const { key, clamp } of OPTIONAL_FIELD_CLAMPS) {
    const current = target[key]
    if (current === undefined) continue
    target[key] = clamp(current)
  }
}
