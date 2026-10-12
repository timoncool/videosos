import { useEffect, useMemo } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem } from '@/types/timeline'
import {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  useCompositionsStore,
} from '@/features/preview/deps/timeline-contract'
import { acquireComparisonCompositionRenderSession } from './comparison-composition-render-session'
import { getSourceFrameInfo } from './edit-overlay-utils'
import { resolveEditOverlayVisualItem } from './edit-overlay-visual-item'

interface UseSelectedComparisonCompositionPrewarmOptions {
  fps: number
  items: TimelineItem[]
  useProxyMedia: boolean
  blobUrlVersion: number
}

export function useSelectedComparisonCompositionPrewarm({
  fps,
  items,
  useProxyMedia,
  blobUrlVersion,
}: UseSelectedComparisonCompositionPrewarmOptions): void {
  const selectedItemIds = useSelectionStore((state) => state.selectedItemIds)
  const compositionById = useCompositionsStore((state) => state.compositionById)
  const selectedCompositionItem = useMemo(() => {
    const selectedIds = new Set(selectedItemIds)
    for (const item of items) {
      if (!selectedIds.has(item.id)) continue
      const visualItem = resolveEditOverlayVisualItem(items, item)
      if (visualItem.type === 'composition') return visualItem
    }
    return null
  }, [items, selectedItemIds])

  const warmupPlan = useMemo(() => {
    if (!selectedCompositionItem || selectedCompositionItem.type !== 'composition') return null
    const composition = compositionById[selectedCompositionItem.compositionId]
    if (!composition) return null
    const graphSignature = buildSubCompositionPreviewSignature(composition.id, compositionById)
    if (!graphSignature) return null

    const input = buildSubCompositionInput(composition)
    const lastLocalFrame = Math.max(0, selectedCompositionItem.durationInFrames - 1)
    const sourceFrames = [
      getSourceFrameInfo(selectedCompositionItem, 0, fps).sourceFrame,
      getSourceFrameInfo(selectedCompositionItem, lastLocalFrame, fps).sourceFrame,
    ]
      .map((frame) => Math.min(Math.max(0, frame), Math.max(0, composition.durationInFrames - 1)))
      .filter((frame, index, frames) => frames.indexOf(frame) === index)
    const resolutionKey = `${composition.id}:${graphSignature}:${useProxyMedia ? 'proxy' : 'source'}:${blobUrlVersion}`
    return {
      key: `${resolutionKey}:${composition.width}x${composition.height}`,
      compositionId: composition.id,
      input: { ...input, tracks: structuredClone(input.tracks) },
      width: composition.width,
      height: composition.height,
      useProxyMedia,
      sourceFrames,
    }
  }, [blobUrlVersion, compositionById, fps, selectedCompositionItem, useProxyMedia])

  useEffect(() => {
    if (!warmupPlan || typeof OffscreenCanvas === 'undefined') return
    const leases = warmupPlan.sourceFrames.map((priorityFrame) =>
      acquireComparisonCompositionRenderSession({ ...warmupPlan, priorityFrame }),
    )
    return () => {
      for (const lease of leases) lease.release()
    }
  }, [warmupPlan])
}
