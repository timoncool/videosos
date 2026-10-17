import { useEffect, useRef } from 'react'
import { useCompactLayout } from '@/shared/hooks/use-compact-layout'
import { useEditorStore } from '@/shared/state/editor'

/**
 * On a compact screen the media and properties panels open over the preview instead of beside it, so the editor
 * starts with both closed; the desktop's own choice comes back when the screen widens again.
 */
export function useCompactSidebars(): boolean {
  const compact = useCompactLayout()
  const wide = useRef<{ left: boolean; right: boolean } | null>(null)
  useEffect(() => {
    const store = useEditorStore.getState()
    if (compact) {
      wide.current = { left: store.leftSidebarOpen, right: store.rightSidebarOpen }
      store.setLeftSidebarOpen(false)
      store.setRightSidebarOpen(false)
    } else if (wide.current) {
      store.setLeftSidebarOpen(wide.current.left)
      store.setRightSidebarOpen(wide.current.right)
      wide.current = null
    }
  }, [compact])
  return compact
}
