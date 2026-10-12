import { useCallback, useMemo, type FC, type ReactNode } from 'react'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { KeyframesContext } from './keyframes-context-core'
import { useLiveTimelineItemResolver } from './live-item-transform-context'

interface KeyframesProviderProps {
  keyframes: ItemKeyframes[] | undefined
  items?: TimelineItem[]
  canvas?: CanvasSettings
  children: ReactNode
}

export const KeyframesProvider: FC<KeyframesProviderProps> = ({
  keyframes,
  items = [],
  canvas,
  children,
}) => {
  const keyframesMap = useMemo(() => {
    const map = new Map<string, ItemKeyframes>()
    if (keyframes) {
      for (const kf of keyframes) {
        map.set(kf.itemId, kf)
      }
    }
    return map
  }, [keyframes])

  const getItemKeyframes = useCallback((itemId: string) => keyframesMap.get(itemId), [keyframesMap])
  const itemsMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const getLiveItem = useLiveTimelineItemResolver()
  const getItem = useCallback(
    (itemId: string) => getLiveItem(itemId) ?? itemsMap.get(itemId),
    [getLiveItem, itemsMap],
  )

  const value = useMemo(
    () => ({
      keyframes: keyframes ?? [],
      getItemKeyframes,
      getItem,
      canvas,
    }),
    [canvas, getItem, getItemKeyframes, keyframes],
  )

  return <KeyframesContext.Provider value={value}>{children}</KeyframesContext.Provider>
}
