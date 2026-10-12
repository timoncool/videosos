import type { SceneCut } from './scene-detection-types'

/**
 * Seek video and wait for the requested time. A timed-out or mismatched seek
 * rejects so callers never analyze a silently stale frame.
 */
export async function seekVideo(
  video: HTMLVideoElement,
  timeSec: number,
  timeoutMs = 1500,
): Promise<void> {
  const epsilon = 0.05
  if (Math.abs(video.currentTime - timeSec) <= epsilon) return

  return new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      clearTimeout(timeout)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const onSeeked = () => {
      if (Math.abs(video.currentTime - timeSec) > epsilon) {
        finish(new Error(`Video seek landed at ${video.currentTime} instead of ${timeSec}`))
        return
      }
      finish()
    }
    const onError = () => finish(new Error(`Video seek failed at ${timeSec}`))
    const timeout = setTimeout(() => {
      finish(new Error(`Video seek timed out at ${timeSec}`))
    }, timeoutMs)

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    try {
      video.currentTime = timeSec
    } catch (error) {
      finish(error instanceof Error ? error : new Error(`Video seek failed at ${timeSec}`))
    }
  })
}

/**
 * Cluster scene cuts that are closer than `minGapSec` and keep only
 * the one with the highest detector score in each fixed window.
 */
export function deduplicateCuts(cuts: SceneCut[], minGapSec: number): SceneCut[] {
  if (cuts.length <= 1) return cuts

  const result: SceneCut[] = []
  let clusterStartTime = cuts[0]!.time
  let clusterBest = cuts[0]!

  for (let i = 1; i < cuts.length; i++) {
    const cut = cuts[i]!
    if (cut.time - clusterStartTime < minGapSec) {
      if (cut.score > clusterBest.score) {
        clusterBest = cut
      }
    } else {
      result.push(clusterBest)
      clusterStartTime = cut.time
      clusterBest = cut
    }
  }
  result.push(clusterBest)

  return result
}
