import { createContext, useContext } from 'react'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'

interface KeyframesContextValue {
  keyframes: ItemKeyframes[]
  getItemKeyframes: (itemId: string) => ItemKeyframes | undefined
  getItem: (itemId: string) => TimelineItem | undefined
  canvas?: CanvasSettings
}

export const KeyframesContext = createContext<KeyframesContextValue | null>(null)

export function useItemKeyframesFromContext(itemId: string): ItemKeyframes | undefined {
  const context = useContext(KeyframesContext)
  return context?.getItemKeyframes(itemId)
}
