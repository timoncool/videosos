/**
 * Interface-sound engine — owns a single shared {@link AudioContext} dedicated
 * to UI feedback, separate from the timeline/preview audio graph so the two
 * never fight for the master bus or the audio device.
 *
 * The context is created lazily on the first {@link playSound} call, which by
 * design happens inside a user gesture (a click), satisfying the browser
 * autoplay policy. Repeated triggers of the same token within a short window are
 * dropped ({@link RATE_LIMIT_S}) so high-frequency editing gestures (drag, snap,
 * multi-select) can't turn the interface into a buzzer.
 *
 * Gating (respecting the user's mute/volume and suppressing during media
 * playback) lives one layer up in `@/shared/ui/ui-sound`; this module only
 * knows how to make a sound.
 */

import { renderRecipe, type Recipe } from './synth'

/** Minimum seconds between two triggers of the same token. */
const RATE_LIMIT_S = 0.05

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** Last trigger time (in ctx time) per token, for rate limiting. */
const lastPlayed = new Map<string, number>()

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  )
}

/**
 * Lazily create (and resume) the shared context. Returns null when Web Audio is
 * unavailable or creation fails — callers treat a null result as "no sound".
 */
function ensureContext(): { ctx: AudioContext; master: GainNode } | null {
  if (ctx && master) {
    if (ctx.state === 'suspended') void ctx.resume()
    return { ctx, master }
  }

  const Ctor = getAudioContextCtor()
  if (!Ctor) return null

  try {
    ctx = new Ctor({ latencyHint: 'interactive' })
    master = ctx.createGain()
    master.gain.value = 1
    master.connect(ctx.destination)
    return { ctx, master }
  } catch {
    ctx = null
    master = null
    return null
  }
}

/**
 * Play `recipe` for the given `token` at `volume` (0..1). No-ops when volume is
 * zero, Web Audio is unavailable, or the same token fired within the rate-limit
 * window. Safe to call from any user-gesture handler.
 */
export function playSound(token: string, recipe: Recipe, volume: number): void {
  if (volume <= 0) return

  const nodes = ensureContext()
  if (!nodes) return

  const now = nodes.ctx.currentTime
  const last = lastPlayed.get(token)
  if (last != null && now - last < RATE_LIMIT_S) return
  lastPlayed.set(token, now)

  // Start a hair in the future so scheduled ramps don't clip against "now".
  renderRecipe(nodes.ctx, nodes.master, recipe, now + 0.001, volume, Math.random)
}
