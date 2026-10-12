export interface AudioSkimMeterLevel {
  left: number
  right: number
  trackId?: string
  expiresAt: number
  version: number
}

let currentLevel: AudioSkimMeterLevel | null = null
let version = 0
let clearTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

export function publishAudioSkimMeterLevel(level: {
  left: number
  right: number
  trackId?: string
  ttlMs?: number
}): void {
  const ttlMs = level.ttlMs ?? 70
  currentLevel = {
    left: Math.max(0, level.left),
    right: Math.max(0, level.right),
    trackId: level.trackId,
    expiresAt: performance.now() + ttlMs,
    version: version + 1,
  }
  if (clearTimer !== null) {
    clearTimeout(clearTimer)
  }
  clearTimer = setTimeout(() => {
    clearTimer = null
    clearAudioSkimMeterLevel()
  }, ttlMs)
  notify()
}

export function clearAudioSkimMeterLevel(): void {
  if (!currentLevel) return
  if (clearTimer !== null) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  currentLevel = null
  notify()
}

export function getAudioSkimMeterLevel(): AudioSkimMeterLevel | null {
  if (!currentLevel) return null
  if (performance.now() > currentLevel.expiresAt) {
    currentLevel = null
    return null
  }
  return currentLevel
}

export function subscribeAudioSkimMeterLevel(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function getAudioSkimMeterVersion(): number {
  getAudioSkimMeterLevel()
  return version
}
