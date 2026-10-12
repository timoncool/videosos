import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_VOICE, type VoiceName } from '@/infrastructure/audio/ui-sound'

/**
 * Persisted preferences for interface sounds.
 *
 * Sound is opt-in (`enabled` defaults to false) — a video editor is an
 * audio-sensitive tool and pros should never get surprise chirps while
 * monitoring. The choice is remembered across sessions in localStorage.
 */
interface UiSoundState {
  /** Master on/off. Off by default (opt-in). */
  enabled: boolean
  /** User volume for interface sounds, 0..1. */
  volume: number
  /** Active sonic palette. */
  voice: VoiceName
  setEnabled: (enabled: boolean) => void
  setVolume: (volume: number) => void
  setVoice: (voice: VoiceName) => void
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export const useUiSoundStore = create<UiSoundState>()(
  persist(
    (set) => ({
      enabled: false,
      volume: 0.6,
      voice: DEFAULT_VOICE,
      setEnabled: (enabled) => set({ enabled }),
      setVolume: (volume) => set({ volume: clamp01(volume) }),
      setVoice: (voice) => set({ voice }),
    }),
    {
      name: 'freecut-ui-sound',
      partialize: (state) => ({
        enabled: state.enabled,
        volume: state.volume,
        voice: state.voice,
      }),
    },
  ),
)
