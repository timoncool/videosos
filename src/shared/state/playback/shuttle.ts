const SHUTTLE_RATES = [1, 2, 4] as const

type ShuttleDirection = -1 | 1

export function getNextShuttleRate(currentRate: number, direction: ShuttleDirection): number {
  if (!Number.isFinite(currentRate) || Math.sign(currentRate) !== direction) {
    return direction
  }

  const currentMagnitude = Math.abs(currentRate)
  const nextMagnitude = SHUTTLE_RATES.find((rate) => rate > currentMagnitude) ?? 4
  return direction * nextMagnitude
}

export function getBrowserMediaPlaybackRate(authoredRate: number, transportRate: number): number {
  const safeAuthoredRate = Number.isFinite(authoredRate) && authoredRate > 0 ? authoredRate : 1
  const safeTransportRate = Number.isFinite(transportRate) && transportRate > 0 ? transportRate : 1

  return Math.max(0.0625, Math.min(16, safeAuthoredRate * safeTransportRate))
}
