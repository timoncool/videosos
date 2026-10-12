import { useCallback } from 'react'
import { useKeyframesStore } from '@/runtime/composition-runtime/deps/stores'
import { useItemKeyframesFromContext } from '../../contexts/keyframes-context'

export function useRuntimeItemKeyframes(itemId: string) {
  const contextKeyframes = useItemKeyframesFromContext(itemId)
  const storeKeyframes = useKeyframesStore(
    useCallback((state) => state.keyframesByItemId[itemId], [itemId]),
  )

  return contextKeyframes ?? storeKeyframes
}
