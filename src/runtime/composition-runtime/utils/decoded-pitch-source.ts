export interface DecodedPitchSourceWindow {
  sourceStartOffsetSec: number
  coverageEndSec: number
  isComplete: boolean
}

export function needsDecodedPitchSourceExtension<T extends DecodedPitchSourceWindow>(
  source: T | null,
  playing: boolean,
  targetTime: number,
  isReverseShuttle: boolean,
  extensionTriggerSeconds: number,
): source is T {
  if (!source || source.isComplete || !playing) return false
  const remainingCoverage = isReverseShuttle
    ? targetTime - source.sourceStartOffsetSec
    : source.coverageEndSec - targetTime
  const targetOutsideSource =
    targetTime < source.sourceStartOffsetSec || targetTime >= source.coverageEndSec
  return targetOutsideSource || remainingCoverage <= extensionTriggerSeconds
}
