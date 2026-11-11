import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useGenerationPlacementsStore, type GenerationPlacement } from '@/shared/state/generation-placements-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'

/** A picture's clip length when the model's form does not say how long its result is: the editor's still. */
const STILL_FRAMES = 150
const ROW = 36

const PlaceholderBar = memo(function PlaceholderBar({ placement, row }: { placement: GenerationPlacement; row: number }) {
  const { t } = useTranslation()
  const fps = useTimelineSettingsStore((s) => s.fps)
  const pixelsPerSecond = useZoomStore((s) => s.pixelsPerSecond)
  const playheadFrame = usePlaybackStore((s) => (placement.at === null ? s.currentFrame : 0))
  const startSeconds = placement.at ?? (fps > 0 ? playheadFrame / fps : 0)
  const seconds = placement.seconds ?? (fps > 0 ? STILL_FRAMES / fps : 0)
  const state =
    placement.status === 'running' && placement.progress !== null
      ? `${Math.round(placement.progress * 100)}%`
      : t(`generate.status.${placement.status}`)
  const label = t('generate.placeholder', { model: placement.model, state })
  return (
    <div
      className="absolute flex h-8 items-center gap-1.5 overflow-hidden rounded-sm border border-dashed border-primary/70 bg-primary/15 px-1.5 text-[11px] font-medium text-foreground"
      style={{
        left: `${startSeconds * pixelsPerSecond}px`,
        width: `${Math.max(seconds * pixelsPerSecond, 24)}px`,
        [placement.lane === 'sound' ? 'bottom' : 'top']: `${4 + row * ROW}px`,
      }}
      title={label}
      aria-label={label}
      role="status"
    >
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  )
})

/**
 * Generations that will land on the timeline, drawn where their results go while they run, as the recording
 * bar is: not timeline items, so they leave undo and the project alone; the finished result replaces them.
 */
export const TimelineGenerationOverlay = memo(function TimelineGenerationOverlay() {
  const placements = useGenerationPlacementsStore((s) => s.placements)
  if (placements.length === 0) return null
  const rows = { picture: 0, sound: 0 }
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {placements.map((placement) => (
        <PlaceholderBar key={placement.id} placement={placement} row={rows[placement.lane]++} />
      ))}
    </div>
  )
})
