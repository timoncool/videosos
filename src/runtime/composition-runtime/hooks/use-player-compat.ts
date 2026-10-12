/**
 * Composition compatibility layer for the custom player.
 *
 * These hooks provide a Composition-like API using the custom Clock-based player.
 * Export uses Canvas + WebCodecs (client-render-engine.ts), not Composition's renderer.
 */

import { useVideoConfig as useCustomVideoConfig } from '@/runtime/composition-runtime/deps/player'
import { useBridgedIsPlaying } from '@/runtime/composition-runtime/deps/player'

/**
 * Get video config (fps, width, height, durationInFrames) from the custom player context.
 */
export function useVideoConfig() {
  return useCustomVideoConfig()
}

/**
 * Get playing state from the custom player's Clock.
 */
export function useIsPlaying(): boolean {
  return useBridgedIsPlaying()
}
