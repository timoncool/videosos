/**
 * Sound "voices" — swappable sonic palettes.
 *
 * A {@link Voice} maps every semantic {@link SoundToken} to a synth {@link Recipe}.
 * Call sites emit intent (`'select'`, `'delete'`, …), never a specific sound, so
 * the whole feel of the interface can be re-themed by adding another voice here
 * without touching a single feature. New voices go in {@link VOICES}; add its key
 * to {@link VoiceName} and the picker/store pick it up.
 */

import type { Recipe } from './synth'

/**
 * Semantic interface events. These name *what happened*, not *how it sounds* —
 * the voice decides the latter. Keep this list small and intentional; every
 * token must be defined by every voice (enforced by the {@link Voice} type).
 */
export type SoundToken =
  | 'select' // a clip / element was selected
  | 'confirm' // an affirmative action completed
  | 'cancel' // an action was dismissed / reverted
  | 'toggleOn' // a switch turned on
  | 'toggleOff' // a switch turned off
  | 'delete' // something was removed
  | 'error' // an action failed / was blocked
  | 'hover' // pointer moved onto an interactive target

/** Identifier for a selectable voice. */
export type VoiceName = 'signature' | 'velvet' | 'crisp'

/** A complete mapping from every semantic token to a recipe. */
export type Voice = Record<SoundToken, Recipe>

/** The default voice applied on first run. */
export const DEFAULT_VOICE: VoiceName = 'signature'

/**
 * "Signature" — quiet, rounded sine/triangle tones. Designed as a bonus layer
 * that reads as feedback, never as the message. Gains are deliberately low
 * (≤0.32) because the user's volume setting multiplies on top.
 */
const SIGNATURE: Voice = {
  select: {
    layers: [{ type: 'sine', freq: 880 }],
    duration: 0.07,
    gain: 0.18,
    variation: 0.5,
  },
  hover: {
    layers: [{ type: 'sine', freq: 1320 }],
    duration: 0.04,
    gain: 0.08,
    variation: 0.6,
  },
  confirm: {
    // Gentle rising two-note (C5 → G5).
    layers: [
      { type: 'triangle', freq: 523.25 },
      { type: 'sine', freq: 783.99, delay: 0.05, gain: 0.8 },
    ],
    duration: 0.22,
    gain: 0.24,
    variation: 0.25,
  },
  cancel: {
    // Falling two-note (G5 → C5).
    layers: [
      { type: 'triangle', freq: 659.25 },
      { type: 'sine', freq: 440, delay: 0.05, gain: 0.8 },
    ],
    duration: 0.2,
    gain: 0.2,
    variation: 0.25,
  },
  toggleOn: {
    layers: [{ type: 'triangle', freq: 660, freqEnd: 990 }],
    duration: 0.11,
    gain: 0.22,
    variation: 0.3,
  },
  toggleOff: {
    layers: [{ type: 'triangle', freq: 660, freqEnd: 440 }],
    duration: 0.11,
    gain: 0.22,
    variation: 0.3,
  },
  delete: {
    // Low, soft thunk with the highs rolled off.
    layers: [{ type: 'triangle', freq: 200, freqEnd: 90 }],
    duration: 0.16,
    gain: 0.28,
    filter: { type: 'lowpass', freq: 900 },
    variation: 0.2,
  },
  error: {
    // Two low, slightly detuned pulses — noticeable without being harsh.
    layers: [
      { type: 'sine', freq: 220 },
      { type: 'sine', freq: 233, delay: 0.12, gain: 0.9 },
    ],
    duration: 0.28,
    gain: 0.32,
    filter: { type: 'lowpass', freq: 1400 },
    variation: 0.15,
  },
}

/**
 * "Velvet" — softer and mellower than Signature: pure sines, lower register,
 * longer tails. The most understated palette; reads as ambient confirmation.
 */
const VELVET: Voice = {
  select: {
    layers: [{ type: 'sine', freq: 587.33 }],
    duration: 0.1,
    gain: 0.16,
    filter: { type: 'lowpass', freq: 1600 },
    variation: 0.5,
  },
  hover: {
    layers: [{ type: 'sine', freq: 880 }],
    duration: 0.05,
    gain: 0.07,
    variation: 0.6,
  },
  confirm: {
    layers: [
      { type: 'sine', freq: 440 },
      { type: 'sine', freq: 659.25, delay: 0.06, gain: 0.75 },
    ],
    duration: 0.3,
    gain: 0.22,
    filter: { type: 'lowpass', freq: 2000 },
    variation: 0.2,
  },
  cancel: {
    layers: [
      { type: 'sine', freq: 523.25 },
      { type: 'sine', freq: 349.23, delay: 0.06, gain: 0.75 },
    ],
    duration: 0.28,
    gain: 0.2,
    filter: { type: 'lowpass', freq: 1800 },
    variation: 0.2,
  },
  toggleOn: {
    layers: [{ type: 'sine', freq: 523.25, freqEnd: 698.46 }],
    duration: 0.14,
    gain: 0.2,
    variation: 0.25,
  },
  toggleOff: {
    layers: [{ type: 'sine', freq: 523.25, freqEnd: 392 }],
    duration: 0.14,
    gain: 0.2,
    variation: 0.25,
  },
  delete: {
    layers: [{ type: 'sine', freq: 174.61, freqEnd: 87.31 }],
    duration: 0.2,
    gain: 0.3,
    filter: { type: 'lowpass', freq: 700 },
    variation: 0.15,
  },
  error: {
    layers: [
      { type: 'sine', freq: 196 },
      { type: 'sine', freq: 207.65, delay: 0.14, gain: 0.9 },
    ],
    duration: 0.32,
    gain: 0.3,
    filter: { type: 'lowpass', freq: 1000 },
    variation: 0.1,
  },
}

/**
 * "Crisp" — bright, short, and percussive: higher register with a little
 * square-wave bite. The most present palette; good for fast, tactile feedback.
 */
const CRISP: Voice = {
  select: {
    layers: [{ type: 'square', freq: 1046.5, gain: 0.6 }],
    duration: 0.045,
    gain: 0.14,
    filter: { type: 'lowpass', freq: 4000 },
    variation: 0.5,
  },
  hover: {
    layers: [{ type: 'square', freq: 1568, gain: 0.5 }],
    duration: 0.03,
    gain: 0.06,
    filter: { type: 'lowpass', freq: 5000 },
    variation: 0.6,
  },
  confirm: {
    layers: [
      { type: 'triangle', freq: 783.99 },
      { type: 'square', freq: 1174.66, delay: 0.04, gain: 0.4 },
    ],
    duration: 0.16,
    gain: 0.22,
    filter: { type: 'lowpass', freq: 4500 },
    variation: 0.25,
  },
  cancel: {
    layers: [
      { type: 'triangle', freq: 880 },
      { type: 'square', freq: 587.33, delay: 0.04, gain: 0.4 },
    ],
    duration: 0.15,
    gain: 0.2,
    filter: { type: 'lowpass', freq: 4000 },
    variation: 0.25,
  },
  toggleOn: {
    layers: [{ type: 'square', freq: 880, freqEnd: 1318.51, gain: 0.6 }],
    duration: 0.08,
    gain: 0.2,
    filter: { type: 'lowpass', freq: 5000 },
    variation: 0.3,
  },
  toggleOff: {
    layers: [{ type: 'square', freq: 880, freqEnd: 587.33, gain: 0.6 }],
    duration: 0.08,
    gain: 0.2,
    filter: { type: 'lowpass', freq: 5000 },
    variation: 0.3,
  },
  delete: {
    layers: [{ type: 'square', freq: 261.63, freqEnd: 130.81, gain: 0.55 }],
    duration: 0.12,
    gain: 0.26,
    filter: { type: 'lowpass', freq: 1800 },
    variation: 0.2,
  },
  error: {
    layers: [
      { type: 'square', freq: 293.66, gain: 0.5 },
      { type: 'square', freq: 311.13, delay: 0.1, gain: 0.45 },
    ],
    duration: 0.24,
    gain: 0.28,
    filter: { type: 'lowpass', freq: 2200 },
    variation: 0.12,
  },
}

/** All available voices, keyed by {@link VoiceName}. */
export const VOICES: Record<VoiceName, Voice> = {
  signature: SIGNATURE,
  velvet: VELVET,
  crisp: CRISP,
}

/**
 * Voices in display order, with their (untranslated) proper-noun labels for the
 * picker. Order here is the order shown in Settings.
 */
export const VOICE_OPTIONS: ReadonlyArray<{ value: VoiceName; label: string }> = [
  { value: 'signature', label: 'Signature' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'crisp', label: 'Crisp' },
]
