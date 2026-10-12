import { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Trash2 } from 'lucide-react'
import {
  clearAllMarkers,
  removeMarker,
  useMarkersStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { cn } from '@/shared/ui/cn'
import { formatTimecodeDotFrames } from '@/shared/utils/time-utils'
import { resolveMarkerNames } from '@/shared/timeline/marker-names'
import { PropertySection } from '../components'

/**
 * List of all project markers, sorted by frame. Provides the global "manage
 * markers" surface that the per-marker MarkerPanel lacks: click a row to select
 * the marker and seek the playhead to it, remove individual markers, or clear
 * all. Rendered both below the individual editor in MarkerPanel and in
 * CanvasPanel (the default panel), so markers are reachable regardless of
 * selection state.
 */
export function MarkerList({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const { t } = useTranslation()
  const markers = useMarkersStore((s) => s.markers)
  const fps = useTimelineSettingsStore((s) => s.fps)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const selectMarker = useSelectionStore((s) => s.selectMarker)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)

  // Don't mutate the store array; sort a copy for stable display order.
  const sortedMarkers = useMemo(() => [...markers].sort((a, b) => a.frame - b.frame), [markers])

  const markerNames = useMemo(
    () => resolveMarkerNames(markers, (index) => t('timeline.markerName', { index })),
    [markers, t],
  )

  const handleSelect = useCallback(
    (id: string, frame: number) => {
      selectMarker(id)
      setCurrentFrame(frame)
    },
    [selectMarker, setCurrentFrame],
  )

  const handleRemove = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      removeMarker(id)
      // Only drop selection if we just deleted the selected marker.
      if (useSelectionStore.getState().selectedMarkerId === id) {
        clearSelection()
      }
    },
    [clearSelection],
  )

  const handleClearAll = useCallback(() => {
    clearAllMarkers()
    clearSelection()
  }, [clearSelection])

  return (
    <PropertySection title={t('editor.markerList.title')} icon={MapPin} defaultOpen={defaultOpen}>
      {sortedMarkers.length === 0 ? (
        <div className="px-2 py-3 text-center">
          <p className="text-xs text-muted-foreground">{t('editor.markerList.empty')}</p>
          <p className="mt-1 text-[10px] leading-tight text-muted-foreground/70">
            {t('editor.markerList.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {sortedMarkers.map((marker) => {
            const isActive = marker.id === selectedMarkerId
            return (
              <div
                key={marker.id}
                className={cn(
                  'group flex items-center h-7 rounded-md transition-colors',
                  isActive ? 'bg-secondary' : 'hover:bg-secondary/50',
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(marker.id, marker.frame)}
                  className="flex-1 min-w-0 flex items-center gap-2 h-full pl-2 pr-1 text-left"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/20"
                    style={{ backgroundColor: marker.color }}
                  />
                  <span className="flex-1 min-w-0 truncate text-xs">
                    {markerNames.get(marker.id)}
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                    {formatTimecodeDotFrames(marker.frame, fps)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, marker.id)}
                  className="shrink-0 grid place-items-center w-6 h-full rounded-r-md text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive transition-opacity"
                  aria-label={t('editor.markerList.remove')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )
          })}
          <div className="pt-1.5 px-2">
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              {t('editor.markerList.clearAll')}
            </button>
          </div>
        </div>
      )}
    </PropertySection>
  )
}
