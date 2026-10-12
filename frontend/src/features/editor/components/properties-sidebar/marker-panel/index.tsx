import { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { MapPin, Trash2 } from 'lucide-react'
import {
  removeMarker,
  updateMarker,
  useMarkersStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { formatTimecodeDotFrames } from '@/shared/utils/time-utils'
import { getMarkerOrdinals } from '@/shared/timeline/marker-names'
import { PropertySection, PropertyRow, NumberInput, ColorPicker } from '../components'
import { MarkerList } from './marker-list'

const DEFAULT_MARKER_COLOR = 'oklch(0.65 0.20 250)'

// Preset colors for quick selection
const MARKER_PRESET_COLORS = [
  'oklch(0.65 0.20 250)', // Blue (default)
  'oklch(0.65 0.20 30)', // Red
  'oklch(0.70 0.20 140)', // Green
  'oklch(0.70 0.18 85)', // Yellow
  'oklch(0.60 0.20 310)', // Purple
  'oklch(0.70 0.15 180)', // Cyan
]

/**
 * Marker properties panel - shown when a marker is selected.
 * Allows editing frame position, label, and color.
 */
export function MarkerPanel() {
  const { t } = useTranslation()
  // Granular selectors (Zustand v5 best practice)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const markers = useMarkersStore((s) => s.markers)
  const fps = useTimelineSettingsStore((s) => s.fps)

  // Derive selected marker
  const selectedMarker = useMemo(
    () => markers.find((m) => m.id === selectedMarkerId),
    [markers, selectedMarkerId],
  )

  // The name this marker shows while its label is empty, used as the input's
  // placeholder so the field previews what the ruler and list already display.
  const defaultName = useMemo(() => {
    if (!selectedMarkerId) return ''
    const ordinal = getMarkerOrdinals(markers).get(selectedMarkerId)
    return ordinal === undefined ? '' : t('timeline.markerName', { index: ordinal })
  }, [markers, selectedMarkerId, t])

  // Handle frame change
  const handleFrameChange = useCallback(
    (frame: number) => {
      if (selectedMarkerId) {
        updateMarker(selectedMarkerId, { frame: Math.max(0, Math.round(frame)) })
      }
    },
    [selectedMarkerId],
  )

  // Handle label change
  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (selectedMarkerId) {
        // Store undefined if empty string to keep data clean
        updateMarker(selectedMarkerId, { label: e.target.value || undefined })
      }
    },
    [selectedMarkerId],
  )

  // Handle color change
  const handleColorChange = useCallback(
    (color: string) => {
      if (selectedMarkerId) {
        updateMarker(selectedMarkerId, { color })
      }
    },
    [selectedMarkerId],
  )

  // Handle delete
  const handleDelete = useCallback(() => {
    if (selectedMarkerId) {
      removeMarker(selectedMarkerId)
      clearSelection()
    }
  }, [selectedMarkerId, clearSelection])

  // Handle reset color to default
  const handleResetColor = useCallback(() => {
    if (selectedMarkerId && selectedMarker?.color !== DEFAULT_MARKER_COLOR) {
      updateMarker(selectedMarkerId, { color: DEFAULT_MARKER_COLOR })
    }
  }, [selectedMarkerId, selectedMarker?.color])

  if (!selectedMarker) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <MapPin className="w-8 h-8 text-muted-foreground/50 mb-2" />
          <p className="text-xs text-muted-foreground">{t('editor.markerPanel.notFound')}</p>
        </div>
        <Separator />
        <MarkerList />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PropertySection title={t('editor.markerPanel.title')} icon={MapPin} defaultOpen={true}>
        {/* Frame position */}
        <PropertyRow label={t('editor.markerPanel.frame')}>
          <NumberInput
            value={selectedMarker.frame}
            onChange={handleFrameChange}
            min={0}
            step={1}
            unit="fr"
            className="flex-1 min-w-0"
          />
        </PropertyRow>

        {/* Timecode (read-only) */}
        <PropertyRow label={t('editor.markerPanel.time')}>
          <span className="text-xs font-mono tabular-nums text-muted-foreground">
            {formatTimecodeDotFrames(selectedMarker.frame, fps)}
          </span>
        </PropertyRow>

        {/* Label */}
        <PropertyRow label={t('editor.markerPanel.label')}>
          <Input
            value={selectedMarker.label || ''}
            onChange={handleLabelChange}
            placeholder={defaultName}
            className="h-7 text-xs flex-1 min-w-0"
          />
        </PropertyRow>

        {/* Color */}
        <ColorPicker
          label={t('editor.markerPanel.color')}
          color={selectedMarker.color}
          onChange={handleColorChange}
          onReset={handleResetColor}
          defaultColor={DEFAULT_MARKER_COLOR}
          presets={MARKER_PRESET_COLORS}
        />

        {/* Delete button */}
        <div className="pt-2">
          <Button
            variant="destructive"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleDelete}
          >
            <Trash2 className="w-3 h-3 mr-1.5" />
            {t('editor.markerPanel.deleteMarker')}
          </Button>
        </div>
      </PropertySection>

      <Separator />

      {/* All markers — jump between / manage the full set from the same panel */}
      <MarkerList />
    </div>
  )
}
