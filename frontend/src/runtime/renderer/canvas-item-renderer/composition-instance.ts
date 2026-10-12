import type { CompositionItem, TimelineItem } from '@/types/timeline'
import { applyCompositionControlOverrides } from '@/shared/utils/composition-controls'
import type { ItemRenderContext, SubCompRenderData } from './types'

/** Resolve one reusable composition instance without mutating its shared source data. */
export function resolveSubCompRenderDataForInstance(
  item: CompositionItem,
  rctx: ItemRenderContext,
): SubCompRenderData | undefined {
  const source = rctx.subCompRenderData.get(item.compositionId)
  const overrides = item.compositionControlOverrides
  if (
    !source?.compositionControls?.controls.some(
      (control) => typeof overrides?.[control.id] === 'string',
    ) ||
    !overrides
  ) {
    return source
  }

  const cached = rctx.instanceSubCompRenderDataCache?.get(item.id)
  if (cached?.source === source && cached.overrides === overrides) return cached.resolved

  const sourceItems = source.itemsById
    ? [...source.itemsById.values()]
    : source.sortedTracks.flatMap((track) => track.items)
  const resolvedItems = applyCompositionControlOverrides(
    sourceItems,
    source.compositionControls,
    overrides,
  )
  const itemsById = new Map<string, TimelineItem>(
    resolvedItems.map((resolvedItem) => [resolvedItem.id, resolvedItem]),
  )
  const resolved: SubCompRenderData = {
    ...source,
    sortedTracks: source.sortedTracks.map((track) => ({
      ...track,
      items: track.items.map((trackItem) => itemsById.get(trackItem.id) ?? trackItem),
    })),
    itemsById,
  }
  rctx.instanceSubCompRenderDataCache?.set(item.id, { source, overrides, resolved })
  return resolved
}
