/**
 * Tiny Web Audio synthesis primitives for interface sounds.
 *
 * A {@link Recipe} is a declarative description of a short, synthesized sound —
 * one or more oscillator {@link ToneLayer}s shaped by a shared amplitude
 * envelope and an optional low/high-pass filter. Recipes carry no audio state;
 * {@link renderRecipe} realizes one into a running graph that self-disposes when
 * it finishes. Keeping recipes data-only is what lets the theme ("voice") layer
 * swap the entire sonic palette without touching call sites.
 */

/** A single oscillator within a recipe. */
export interface ToneLayer {
  /** Oscillator waveform. */
  type: OscillatorType
  /** Starting frequency in Hz. */
  freq: number
  /** Optional glide target in Hz; the oscillator sweeps freq → freqEnd. */
  freqEnd?: number
  /** Relative gain of this layer, 0..1. Default 1. */
  gain?: number
  /** Detune in cents. Default 0. */
  detune?: number
  /** Delay in seconds before this layer starts, relative to the sound. Default 0. */
  delay?: number
}

/** A complete, data-only description of one interface sound. */
export interface Recipe {
  /** Oscillator layers played together. */
  layers: ToneLayer[]
  /** Total length of the amplitude envelope in seconds. */
  duration: number
  /** Attack time in seconds (silence → peak). Default 0.006. */
  attack?: number
  /** Recipe-level gain applied on top of the master/user volume, 0..1. Default 1. */
  gain?: number
  /** Optional shaping filter applied to the whole sound. */
  filter?: { type: BiquadFilterType; freq: number; q?: number }
  /**
   * Per-trigger randomness, 0..1. Detunes each layer by up to ±(variation * 60)
   * cents and jitters gain by up to ±(variation * 0.15) so repeated triggers are
   * "never identical twice". Default 0 (deterministic).
   */
  variation?: number
}

const MIN_GAIN = 0.0001

function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200)
}

/**
 * Realize a recipe into a live audio graph connected to `destination`.
 *
 * All nodes are scheduled ahead on `ctx.currentTime` and stopped at the end of
 * the envelope; oscillators are garbage-collected once stopped, so callers do
 * not need to track or dispose the returned graph. `rand` supplies the
 * per-trigger variation (pass `Math.random` in app runtime).
 */
export function renderRecipe(
  ctx: AudioContext,
  destination: AudioNode,
  recipe: Recipe,
  startTime: number,
  masterGain: number,
  rand: () => number,
): void {
  const { layers, duration } = recipe
  if (layers.length === 0 || duration <= 0 || masterGain <= 0) return

  const attack = Math.max(0.001, Math.min(recipe.attack ?? 0.006, duration * 0.5))
  const peak = Math.max(MIN_GAIN, (recipe.gain ?? 1) * masterGain)
  const variation = recipe.variation ?? 0
  const end = startTime + duration

  // Shared amplitude envelope: silence → peak (linear) → silence (exponential
  // decay for a natural tail, floored at MIN_GAIN then hard-zeroed).
  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(MIN_GAIN, startTime)
  envelope.gain.linearRampToValueAtTime(peak, startTime + attack)
  envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, end)
  envelope.gain.setValueAtTime(0, end)

  let filter: BiquadFilterNode | null = null
  if (recipe.filter) {
    filter = ctx.createBiquadFilter()
    filter.type = recipe.filter.type
    filter.frequency.setValueAtTime(recipe.filter.freq, startTime)
    if (recipe.filter.q != null) filter.Q.setValueAtTime(recipe.filter.q, startTime)
    envelope.connect(filter)
    filter.connect(destination)
  } else {
    envelope.connect(destination)
  }

  // Once every oscillator has stopped, tear down the shared envelope/filter so
  // they don't linger connected to the destination (which would keep them alive
  // and slowly leak nodes over a long editing session).
  let pending = layers.length
  const releaseShared = () => {
    pending -= 1
    if (pending > 0) return
    envelope.disconnect()
    filter?.disconnect()
  }

  for (const layer of layers) {
    const osc = ctx.createOscillator()
    osc.type = layer.type

    // Per-trigger pitch variation so repeats never sound mechanically identical.
    const detuneJitter = variation > 0 ? (rand() * 2 - 1) * variation * 60 : 0
    const freqRatio = centsToRatio((layer.detune ?? 0) + detuneJitter)
    const layerStart = startTime + Math.max(0, layer.delay ?? 0)

    osc.frequency.setValueAtTime(Math.max(1, layer.freq * freqRatio), layerStart)
    if (layer.freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.freqEnd * freqRatio), end)
    }

    const gainJitter = variation > 0 ? (rand() * 2 - 1) * variation * 0.15 : 0
    const layerGain = ctx.createGain()
    layerGain.gain.setValueAtTime(
      Math.max(MIN_GAIN, (layer.gain ?? 1) * (1 + gainJitter)),
      startTime,
    )

    osc.connect(layerGain)
    layerGain.connect(envelope)
    osc.start(layerStart)
    osc.stop(end)
    // Release graph references once the oscillator has stopped.
    osc.onended = () => {
      osc.disconnect()
      layerGain.disconnect()
      releaseShared()
    }
  }
}
