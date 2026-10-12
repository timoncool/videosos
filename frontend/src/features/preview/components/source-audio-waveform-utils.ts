interface SourceWaveformSamplingOptions {
  peaks: Float32Array
  sampleRate: number
  stereo: boolean
  durationSeconds: number
  startTimeSeconds?: number
  endTimeSeconds?: number
  width: number
  maxPeak: number
}

interface SourceWaveformSeekOptions {
  clientX: number
  clientY: number
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  durationSeconds: number
  detailStartTimeSeconds: number
  detailEndTimeSeconds: number
  overviewHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function sampleSourceWaveformAmplitudes({
  peaks,
  sampleRate,
  stereo,
  durationSeconds,
  startTimeSeconds = 0,
  endTimeSeconds = durationSeconds,
  width,
  maxPeak,
}: SourceWaveformSamplingOptions): Float32Array {
  const safeWidth = Math.max(0, Math.floor(width))
  const amplitudes = new Float32Array(safeWidth)
  const sampleCount = stereo ? Math.floor(peaks.length / 2) : peaks.length
  const normalizationPeak = maxPeak > 0 ? maxPeak : 1
  const startTime = clamp(startTimeSeconds, 0, durationSeconds)
  const endTime = Math.max(startTime, Math.min(durationSeconds, endTimeSeconds))
  const sampleDuration = endTime - startTime

  if (safeWidth === 0 || sampleRate <= 0 || sampleDuration <= 0 || sampleCount === 0) {
    return amplitudes
  }

  for (let x = 0; x < safeWidth; x += 1) {
    const bucketStartTime = startTime + (x / safeWidth) * sampleDuration
    const bucketEndTime = startTime + ((x + 1) / safeWidth) * sampleDuration
    const startIndex = Math.max(
      0,
      Math.min(sampleCount - 1, Math.floor(bucketStartTime * sampleRate)),
    )
    const endIndex = Math.max(
      startIndex + 1,
      Math.min(sampleCount, Math.ceil(bucketEndTime * sampleRate)),
    )

    let peak = 0
    for (let i = startIndex; i < endIndex; i += 1) {
      const value = stereo ? Math.max(peaks[i * 2] ?? 0, peaks[i * 2 + 1] ?? 0) : (peaks[i] ?? 0)
      if (value > peak) {
        peak = value
      }
    }

    amplitudes[x] = clamp(peak / normalizationPeak, 0, 1)
  }

  return amplitudes
}

export function getSourceWaveformSeekTime({
  clientX,
  clientY,
  rect,
  durationSeconds,
  detailStartTimeSeconds,
  detailEndTimeSeconds,
  overviewHeight,
}: SourceWaveformSeekOptions): number {
  if (rect.width <= 0 || durationSeconds <= 0) {
    return 0
  }

  const progress = clamp((clientX - rect.left) / rect.width, 0, 1)
  const localY = clientY - rect.top
  if (localY <= overviewHeight) {
    return progress * durationSeconds
  }

  const detailStart = clamp(detailStartTimeSeconds, 0, durationSeconds)
  const detailEnd = clamp(detailEndTimeSeconds, detailStart, durationSeconds)
  return detailStart + progress * (detailEnd - detailStart)
}
