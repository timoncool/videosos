import type { ReactNode } from 'react'
import {
  LiveItemTransformContext,
  type LiveItemTransformSource,
} from './live-item-transform-context'

export function LiveItemTransformProvider({
  source,
  children,
}: {
  source?: LiveItemTransformSource
  children: ReactNode
}) {
  return (
    <LiveItemTransformContext.Provider value={source ?? null}>
      {children}
    </LiveItemTransformContext.Provider>
  )
}
