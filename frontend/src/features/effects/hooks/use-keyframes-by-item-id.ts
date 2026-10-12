import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useKeyframesStore } from '@/features/effects/deps/timeline-contract'
import type { ItemKeyframes } from '@/types/keyframe'

export function useKeyframesByItemId(itemIds: string[]): Map<string, ItemKeyframes | null> {
  return useKeyframesStore(
    useShallow(
      useCallback(
        (state) =>
          new Map<string, ItemKeyframes | null>(
            itemIds.map((itemId) => [itemId, state.keyframesByItemId[itemId] ?? null]),
          ),
        [itemIds],
      ),
    ),
  )
}
