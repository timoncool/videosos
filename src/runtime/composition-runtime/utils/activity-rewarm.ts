/**
 * Signals "the user is about to interact again" so paused video elements can
 * re-warm their decoders before a likely play press.
 *
 * Chrome suspends the media pipeline of paused/backgrounded <video> elements
 * after a period of inactivity. The next play() then pays 200-300ms of
 * pipeline re-initialization during which the compositor produces no frames
 * at all (rAF stalls with an idle main thread). Re-warming on the activity
 * that precedes a play press — the first input after an idle stretch, or the
 * tab becoming visible again — hides that cost: by the time the user actually
 * presses play, the decoder is hot and playback starts in ~2 frames.
 *
 * Subscribers fire on:
 * - the first pointer/key event after `IDLE_THRESHOLD_MS` of no input
 * - the document becoming visible (background tabs always suspend media)
 */

const IDLE_THRESHOLD_MS = 10_000

type WarmupActivityCallback = () => void

const callbacks = new Set<WarmupActivityCallback>()
let lastActivityMs = 0
let listenersInstalled = false

function fireCallbacks(): void {
  for (const callback of [...callbacks]) {
    callback()
  }
}

function handleInputActivity(): void {
  const now = performance.now()
  const wasIdle = now - lastActivityMs >= IDLE_THRESHOLD_MS
  lastActivityMs = now
  if (wasIdle) {
    fireCallbacks()
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return
  // Returning to the tab always re-warms: hidden tabs suspend media
  // pipelines regardless of how recently the user was active.
  lastActivityMs = performance.now()
  fireCallbacks()
}

function installListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true
  lastActivityMs = performance.now()
  window.addEventListener('pointermove', handleInputActivity, { passive: true })
  window.addEventListener('pointerdown', handleInputActivity, { passive: true })
  window.addEventListener('keydown', handleInputActivity, { passive: true })
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function removeListeners(): void {
  if (!listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = false
  window.removeEventListener('pointermove', handleInputActivity)
  window.removeEventListener('pointerdown', handleInputActivity)
  window.removeEventListener('keydown', handleInputActivity)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

/**
 * Subscribe to activity-after-idle / tab-return signals. Returns an
 * unsubscribe function. Listeners are installed lazily on first subscribe
 * and removed when the last subscriber leaves.
 */
export function subscribeToWarmupActivity(callback: WarmupActivityCallback): () => void {
  callbacks.add(callback)
  installListeners()
  return () => {
    callbacks.delete(callback)
    if (callbacks.size === 0) {
      removeListeners()
    }
  }
}
