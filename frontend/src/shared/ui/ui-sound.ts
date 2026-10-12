/**
 * Interface-sound facade for the rest of the app.
 *
 * This is the single place feature code touches to make an interface sound. It
 * layers gating on top of the low-level engine:
 *  - respects the user's persisted mute / volume ({@link useUiSoundStore}),
 *  - suppresses sounds while the preview is actively playing so UI chirps never
 *    pollute the audio the user is monitoring.
 *
 * Call {@link emitUiSound} from anywhere (event handlers, store actions). Emit
 * *intent* (`'select'`, `'delete'`), never a specific sound — the active voice
 * decides how it sounds.
 */

import { playSound, VOICES, type SoundToken, type VoiceName } from '@/infrastructure/audio/ui-sound'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useUiSoundStore } from '@/shared/state/ui-sound-store'

const log = createLogger('ui-sound')

/**
 * Play the interface sound for `token`, honoring the user's settings and the
 * current playback state. No-ops when sounds are disabled, muted, or the preview
 * is playing. Safe to call outside React and from hot paths (rate-limited by the
 * engine).
 */
export function emitUiSound(token: SoundToken): void {
  const { enabled, volume, voice } = useUiSoundStore.getState()
  if (!enabled || volume <= 0) return

  // Don't chirp over the thing the user is listening to. (Exports run in a
  // worker that never imports this module, so renders are silent by construction.)
  if (usePlaybackStore.getState().isPlaying) return

  const recipe = VOICES[voice]?.[token]
  if (!recipe) {
    log.warn('No recipe for token in active voice — sound skipped', { voice, token })
    return
  }

  playSound(token, recipe, volume)
}

/**
 * Audition a specific `voice` without changing the user's selection. Unlike
 * {@link emitUiSound} this is an explicit user request (a preview button), so it
 * ignores the current voice and the "suppress during playback" gate — it still
 * respects the enabled/volume settings. Keyed per voice so previewing several
 * voices in quick succession doesn't rate-limit them against each other.
 */
export function previewUiSound(voice: VoiceName, token: SoundToken = 'confirm'): void {
  const { enabled, volume } = useUiSoundStore.getState()
  if (!enabled || volume <= 0) return
  const recipe = VOICES[voice]?.[token]
  if (!recipe) {
    log.warn('No recipe for token in previewed voice — preview skipped', { voice, token })
    return
  }
  playSound(`preview:${voice}`, recipe, volume)
}
