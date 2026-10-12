import { useMemo } from 'react'
import { useItemsStore } from '@/features/preview/deps/timeline-store'
import { useRollingEditPreviewStore } from '@/features/preview/deps/timeline-edit-preview'
import { EditTwoUpPanels } from './edit-2up-panels'
import { getRollingEditPanelFrames } from './rolling-edit-overlay-utils'
import { resolveEditOverlayVisualItem } from './edit-overlay-visual-item'

interface RollingEditOverlayProps {
  fps: number
}

/**
 * 2-up frame comparison shown during rolling edits.
 */
export function RollingEditOverlay({ fps }: RollingEditOverlayProps) {
  const trimmedItemId = useRollingEditPreviewStore((s) => s.trimmedItemId)
  const neighborItemId = useRollingEditPreviewStore((s) => s.neighborItemId)
  const handle = useRollingEditPreviewStore((s) => s.handle)
  const neighborDelta = useRollingEditPreviewStore((s) => s.neighborDelta)
  const items = useItemsStore((s) => s.items)
  const itemsMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  if (!trimmedItemId || !neighborItemId || !handle) return null

  const trimmedOperationItem = itemsMap.get(trimmedItemId)
  const neighborOperationItem = itemsMap.get(neighborItemId)
  if (!trimmedOperationItem || !neighborOperationItem) return null

  const trimmedItem = resolveEditOverlayVisualItem(items, trimmedOperationItem)
  const neighborItem = resolveEditOverlayVisualItem(items, neighborOperationItem)

  const { leftItem, rightItem, outInfo, inInfo } = getRollingEditPanelFrames({
    trimmedItem,
    neighborItem,
    handle,
    neighborDelta,
    fps,
  })

  return (
    <EditTwoUpPanels
      leftPanel={{
        item: leftItem,
        sourceTime: outInfo.sourceTime,
        sourceFrame: outInfo.sourceFrame,
        timecode: outInfo.timecode,
        label: 'OUT',
      }}
      rightPanel={{
        item: rightItem,
        sourceTime: inInfo.sourceTime,
        sourceFrame: inInfo.sourceFrame,
        timecode: inInfo.timecode,
        label: 'IN',
      }}
    />
  )
}
