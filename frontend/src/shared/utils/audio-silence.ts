export interface AudioSilenceRange {
  start: number
  end: number
}

export interface AudioSilenceDetectionOptions {
  /** Legacy alias for silenceThresholdDb. */
  thresholdDb?: number
  silenceThresholdDb?: number
  audioThresholdDb?: number
  minSilenceMs?: number
  minAudioMs?: number
  /** Legacy symmetric padding alias. */
  paddingMs?: number
  /** Silence retained after the preceding audible section. */
  paddingStartMs?: number
  /** Silence retained before the following audible section. */
  paddingEndMs?: number
  smoothingMs?: number
  windowMs?: number
  autoThresholds?: boolean
}

interface EstimatedSilenceThresholds {
  audioThresholdDb: number
  silenceThresholdDb: number
}

export interface AudioBufferLike {
  duration: number
  length: number
  numberOfChannels: number
  sampleRate: number
  getChannelData(channel: number): Float32Array
}

const DEFAULT_SILENCE_THRESHOLD_DB = -45
const DEFAULT_AUDIO_THRESHOLD_DB = -35
const DEFAULT_MIN_SILENCE_MS = 500
const DEFAULT_MIN_AUDIO_MS = 80
const DEFAULT_PADDING_MS = 100
const DEFAULT_SMOOTHING_MS = 0
const DEFAULT_WINDOW_MS = 20
const DB_FLOOR = -100

function dbToAmplitude(db: number): number {
  return 10 ** (db / 20)
}

function amplitudeToDb(amplitude: number): number {
  if (amplitude <= 0) return DB_FLOOR
  return Math.max(DB_FLOOR, 20 * Math.log10(amplitude))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampNumber(value: number | undefined, fallback: number, min: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, value)
}

function getWindowMaxRms(channels: Float32Array[], startSample: number, endSample: number): number {
  let maxRms = 0
  const sampleCount = Math.max(1, endSample - startSample)

  for (const channel of channels) {
    let sumSquares = 0
    for (let sample = startSample; sample < endSample; sample += 1) {
      const value = channel[sample] ?? 0
      sumSquares += value * value
    }
    maxRms = Math.max(maxRms, Math.sqrt(sumSquares / sampleCount))
  }

  return maxRms
}

interface WindowLevel {
  endSample: number
  rms: number
  startSample: number
}

function collectWindowLevels(
  audioBuffer: AudioBufferLike,
  windowMs: number,
  smoothingMs: number,
): WindowLevel[] {
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * audioBuffer.sampleRate))
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  )
  const levels: WindowLevel[] = []

  for (let startSample = 0; startSample < audioBuffer.length; startSample += windowSamples) {
    const endSample = Math.min(audioBuffer.length, startSample + windowSamples)
    levels.push({
      startSample,
      endSample,
      rms: getWindowMaxRms(channels, startSample, endSample),
    })
  }

  const smoothingWindows = Math.max(1, Math.round(smoothingMs / windowMs))
  if (smoothingWindows <= 1 || levels.length <= 1) return levels

  const radiusBefore = Math.floor((smoothingWindows - 1) / 2)
  const radiusAfter = smoothingWindows - 1 - radiusBefore
  const powerPrefix = new Float64Array(levels.length + 1)
  for (let index = 0; index < levels.length; index += 1) {
    const rms = levels[index]?.rms ?? 0
    powerPrefix[index + 1] = (powerPrefix[index] ?? 0) + rms * rms
  }

  return levels.map((level, index) => {
    const start = Math.max(0, index - radiusBefore)
    const end = Math.min(levels.length, index + radiusAfter + 1)
    const power = ((powerPrefix[end] ?? 0) - (powerPrefix[start] ?? 0)) / Math.max(1, end - start)
    return { ...level, rms: Math.sqrt(Math.max(0, power)) }
  })
}

function quantile(sorted: readonly number[], position: number): number {
  if (sorted.length === 0) return DB_FLOOR
  const index = clamp(position, 0, 1) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const fraction = index - lower
  const lowerValue = sorted[lower] ?? DB_FLOOR
  const upperValue = sorted[upper] ?? lowerValue
  return lowerValue + (upperValue - lowerValue) * fraction
}

function estimateSilenceThresholds(
  audioBuffer: AudioBufferLike,
  options: Pick<AudioSilenceDetectionOptions, 'smoothingMs' | 'windowMs'> = {},
): EstimatedSilenceThresholds {
  if (
    audioBuffer.length <= 0 ||
    audioBuffer.sampleRate <= 0 ||
    audioBuffer.numberOfChannels <= 0 ||
    audioBuffer.duration <= 0
  ) {
    return {
      silenceThresholdDb: DEFAULT_SILENCE_THRESHOLD_DB,
      audioThresholdDb: DEFAULT_AUDIO_THRESHOLD_DB,
    }
  }

  const windowMs = clampNumber(options.windowMs, DEFAULT_WINDOW_MS, 1)
  const smoothingMs = clampNumber(options.smoothingMs, DEFAULT_SMOOTHING_MS, 0)
  const levelsDb = collectWindowLevels(audioBuffer, windowMs, smoothingMs)
    .map((level) => amplitudeToDb(level.rms))
    .toSorted((left, right) => left - right)
  const noiseFloor = quantile(levelsDb, 0.2)
  const typicalAudio = quantile(levelsDb, 0.65)
  const silenceThresholdDb = clamp(noiseFloor + 4, -80, -20)
  const audioThresholdDb = clamp(
    Math.max(silenceThresholdDb + 6, typicalAudio - 6),
    silenceThresholdDb + 3,
    -6,
  )

  return { silenceThresholdDb, audioThresholdDb }
}

function pushPaddedRange(
  ranges: AudioSilenceRange[],
  startSample: number,
  endSample: number,
  sampleRate: number,
  paddingStartSamples: number,
  paddingEndSamples: number,
): void {
  const paddedStart = Math.min(endSample, startSample + paddingStartSamples)
  const paddedEnd = Math.max(paddedStart, endSample - paddingEndSamples)
  if (paddedEnd <= paddedStart) return
  ranges.push({ start: paddedStart / sampleRate, end: paddedEnd / sampleRate })
}

interface SilenceDetectionConfig {
  audioThreshold: number
  levels: WindowLevel[]
  minAudioSamples: number
  minSilenceSamples: number
  paddingEndSamples: number
  paddingStartSamples: number
  silenceThreshold: number
}

function resolveDetectionConfig(
  audioBuffer: AudioBufferLike,
  options: AudioSilenceDetectionOptions,
): SilenceDetectionConfig {
  const windowMs = clampNumber(options.windowMs, DEFAULT_WINDOW_MS, 1)
  const smoothingMs = clampNumber(options.smoothingMs, DEFAULT_SMOOTHING_MS, 0)
  const estimated = options.autoThresholds
    ? estimateSilenceThresholds(audioBuffer, { windowMs, smoothingMs })
    : null
  const silenceThresholdDb =
    estimated?.silenceThresholdDb ??
    options.silenceThresholdDb ??
    options.thresholdDb ??
    DEFAULT_SILENCE_THRESHOLD_DB
  const requestedAudioThresholdDb =
    estimated?.audioThresholdDb ?? options.audioThresholdDb ?? DEFAULT_AUDIO_THRESHOLD_DB
  const symmetricPaddingMs = clampNumber(options.paddingMs, DEFAULT_PADDING_MS, 0)
  const toSamples = (milliseconds: number) =>
    Math.round((milliseconds / 1000) * audioBuffer.sampleRate)

  return {
    audioThreshold: dbToAmplitude(Math.max(silenceThresholdDb + 1, requestedAudioThresholdDb)),
    levels: collectWindowLevels(audioBuffer, windowMs, smoothingMs),
    minAudioSamples: toSamples(clampNumber(options.minAudioMs, DEFAULT_MIN_AUDIO_MS, 1)),
    minSilenceSamples: toSamples(clampNumber(options.minSilenceMs, DEFAULT_MIN_SILENCE_MS, 1)),
    paddingEndSamples: toSamples(clampNumber(options.paddingEndMs, symmetricPaddingMs, 0)),
    paddingStartSamples: toSamples(clampNumber(options.paddingStartMs, symmetricPaddingMs, 0)),
    silenceThreshold: dbToAmplitude(silenceThresholdDb),
  }
}

export function detectSilentRanges(
  audioBuffer: AudioBufferLike,
  options: AudioSilenceDetectionOptions = {},
): AudioSilenceRange[] {
  if (
    audioBuffer.length <= 0 ||
    audioBuffer.sampleRate <= 0 ||
    audioBuffer.numberOfChannels <= 0 ||
    audioBuffer.duration <= 0
  ) {
    return []
  }

  const config = resolveDetectionConfig(audioBuffer, options)
  const ranges: AudioSilenceRange[] = []
  let belowThresholdStart: number | null = null
  let silenceStart: number | null = null
  let aboveThresholdStart: number | null = null

  for (const level of config.levels) {
    if (silenceStart === null) {
      if (level.rms <= config.silenceThreshold) {
        belowThresholdStart ??= level.startSample
        if (level.endSample - belowThresholdStart >= config.minSilenceSamples) {
          silenceStart = belowThresholdStart
          aboveThresholdStart = null
        }
      } else {
        belowThresholdStart = null
      }
      continue
    }

    if (level.rms >= config.audioThreshold) {
      aboveThresholdStart ??= level.startSample
      if (level.endSample - aboveThresholdStart >= config.minAudioSamples) {
        pushPaddedRange(
          ranges,
          silenceStart,
          aboveThresholdStart,
          audioBuffer.sampleRate,
          config.paddingStartSamples,
          config.paddingEndSamples,
        )
        silenceStart = null
        belowThresholdStart = null
        aboveThresholdStart = null
      }
    } else {
      aboveThresholdStart = null
    }
  }

  if (silenceStart !== null) {
    pushPaddedRange(
      ranges,
      silenceStart,
      audioBuffer.length,
      audioBuffer.sampleRate,
      config.paddingStartSamples,
      config.paddingEndSamples,
    )
  }

  return ranges
}
