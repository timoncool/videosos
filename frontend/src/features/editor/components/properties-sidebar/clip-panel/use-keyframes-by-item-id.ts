import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useKeyframesStore } from '@/features/editor/deps/timeline-store'
import type { ItemKeyframes } from '@/types/keyframe'

/**
 * Subscribes to keyframes for `itemIds` and indexes them by item id.
 * Shared by the clip-panel sections (audio / fill / layout) so the store
 * subscription shape stays identical everywhere.
 */
export function useKeyframesByItemId(itemIds: string[]): Map<string, ItemKeyframes | null> {
  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback((s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null), [itemIds]),
    ),
  )
  return useMemo(() => {
    const map = new Map<string, ItemKeyframes | null>()
    for (const [index, itemId] of itemIds.entries()) {
      map.set(itemId, itemKeyframes[index] ?? null)
    }
    return map
  }, [itemIds, itemKeyframes])
}
