import type { TimelineItem } from '@/types/timeline'
import { getSynchronizedLinkedItems } from '@/features/preview/deps/timeline-contract'

function isVisualItem(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'image' || item.type === 'composition'
}

/**
 * Keep edit operations anchored to their original item while resolving a
 * synchronized visual companion for the comparison panels.
 */
export function resolveEditOverlayVisualItem(
  items: TimelineItem[],
  operationItem: TimelineItem,
): TimelineItem {
  if (isVisualItem(operationItem) || operationItem.type !== 'audio') {
    return operationItem
  }

  return getSynchronizedLinkedItems(items, operationItem.id).find(isVisualItem) ?? operationItem
}
