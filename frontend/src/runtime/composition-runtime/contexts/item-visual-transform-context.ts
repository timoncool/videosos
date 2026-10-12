import { createContext, useContext } from 'react'
import type { ResolvedTransform } from '@/types/transform'

type ItemVisualSize = Pick<ResolvedTransform, 'width' | 'height'>

const ItemVisualTransformContext = createContext<ItemVisualSize | null>(null)

export const ItemVisualTransformProvider = ItemVisualTransformContext.Provider

export function useItemVisualTransform(): ItemVisualSize | null {
  return useContext(ItemVisualTransformContext)
}
