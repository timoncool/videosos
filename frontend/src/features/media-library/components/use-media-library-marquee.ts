import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MediaMetadata } from '@/types/storage'
import { useMarqueeSelection, type MarqueeItem } from '@/shared/marquee/use-marquee-selection'

interface UseMediaLibraryMarqueeParams {
  compositions: ReadonlyArray<{ id: string }>
  filteredMediaItems: MediaMetadata[]
  selectedMediaIds: string[]
  selectedCompositionIds: string[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  setSelection: (selection: { mediaIds: string[]; compositionIds: string[] }) => void
}

/**
 * Marquee (drag-rectangle) selection for the media library grid, including the
 * live preview highlight applied directly to media/composition card DOM nodes
 * (bypassing React for throttled per-frame updates). Commits the final selection
 * to the media-library store. Extracted verbatim from `MediaLibrary`.
 */
export function useMediaLibraryMarquee({
  compositions,
  filteredMediaItems,
  selectedMediaIds,
  selectedCompositionIds,
  scrollContainerRef,
  setSelection,
}: UseMediaLibraryMarqueeParams) {
  const previewAssetIdsRef = useRef<string[]>([])

  const setPreviewAssetIds = useCallback(
    (ids: string[]) => {
      const container = scrollContainerRef.current
      if (!container) {
        previewAssetIdsRef.current = ids
        return
      }

      const nextIds = new Set(ids)
      for (const previousId of previewAssetIdsRef.current) {
        if (nextIds.has(previousId)) {
          continue
        }

        if (previousId.startsWith('media:')) {
          container
            .querySelector(`[data-media-id="${previousId.slice('media:'.length)}"]`)
            ?.classList.remove('media-marquee-preview')
        } else if (previousId.startsWith('composition:')) {
          container
            .querySelector(`[data-composition-id="${previousId.slice('composition:'.length)}"]`)
            ?.classList.remove('composition-marquee-preview')
        }
      }

      const previousIds = new Set(previewAssetIdsRef.current)
      for (const id of ids) {
        if (previousIds.has(id)) {
          continue
        }

        if (id.startsWith('media:')) {
          container
            .querySelector(`[data-media-id="${id.slice('media:'.length)}"]`)
            ?.classList.add('media-marquee-preview')
        } else if (id.startsWith('composition:')) {
          container
            .querySelector(`[data-composition-id="${id.slice('composition:'.length)}"]`)
            ?.classList.add('composition-marquee-preview')
        }
      }

      previewAssetIdsRef.current = ids
    },
    [scrollContainerRef],
  )

  useEffect(() => {
    return () => {
      setPreviewAssetIds([])
    }
  }, [setPreviewAssetIds])

  const marqueeItems: MarqueeItem[] = useMemo(
    () => [
      ...compositions.map((composition) => ({
        id: `composition:${composition.id}`,
        getBoundingRect: () => {
          const element = scrollContainerRef.current?.querySelector(
            `[data-composition-id="${composition.id}"]`,
          )
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        },
      })),
      ...filteredMediaItems.map((media) => ({
        id: `media:${media.id}`,
        getBoundingRect: () => {
          const element = scrollContainerRef.current?.querySelector(`[data-media-id="${media.id}"]`)
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        },
      })),
    ],
    [compositions, filteredMediaItems, scrollContainerRef],
  )
  const committedSelectionIds = useMemo(
    () => [
      ...selectedCompositionIds.map((id) => `composition:${id}`),
      ...selectedMediaIds.map((id) => `media:${id}`),
    ],
    [selectedCompositionIds, selectedMediaIds],
  )

  const { marquee } = useMarqueeSelection({
    containerRef: scrollContainerRef as React.RefObject<HTMLElement>,
    items: marqueeItems,
    enabled: marqueeItems.length > 0,
    onPreviewSelectionChange: setPreviewAssetIds,
    committedSelectionIds,
    commitSelectionOnMouseUp: true,
    liveCommitThrottleMs: 66,
    onSelectionChange: (ids) => {
      const nextMediaIds: string[] = []
      const nextCompositionIds: string[] = []

      for (const id of ids) {
        if (id.startsWith('media:')) {
          nextMediaIds.push(id.slice('media:'.length))
        } else if (id.startsWith('composition:')) {
          nextCompositionIds.push(id.slice('composition:'.length))
        }
      }

      setSelection({ mediaIds: nextMediaIds, compositionIds: nextCompositionIds })
    },
  })

  return { marquee }
}
