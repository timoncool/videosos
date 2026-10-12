import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'

/**
 * Live "recording" bar drawn over the timeline while a voiceover take is being
 * captured. It grows from the record-start frame to the live playhead.
 *
 * It is NOT a real timeline item — mutating an item every frame would pollute
 * undo history and trigger transition repairs. Instead it's a lightweight
 * overlay positioned with direct real-pixel values. Anchoring the width to the
 * playhead (not an independent timer) keeps it exactly aligned with where the
 * committed clip will land, and self-heals after clock catch-up or live zoom.
 */
export const TimelineRecordingOverlay = memo(function TimelineRecordingOverlay() {
  const { t } = useTranslation()
  const status = useMicRecordingStore((s) => s.status)
  const recordStartFrame = useMicRecordingStore((s) => s.recordStartFrame)
  const fps = useTimelineSettingsStore((s) => s.fps)
  const barRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)

  const active = status === 'recording' || status === 'paused' || status === 'finalizing'

  useEffect(() => {
    if (!active) return
    const el = barRef.current
    const label = labelRef.current
    if (!el || !label) return

    const update = () => {
      const pixelsPerFrame = fps > 0 ? useZoomStore.getState().pixelsPerSecond / fps : 0
      const frames = Math.max(0, usePlaybackStore.getState().currentFrame - recordStartFrame)
      const left = recordStartFrame * pixelsPerFrame
      el.style.left = `${left}px`
      el.style.width = `${frames * pixelsPerFrame}px`
      label.style.left = `${left}px`
    }
    update()
    const unsubscribePlayback = usePlaybackStore.subscribe((state, prev) => {
      if (state.currentFrame !== prev.currentFrame) update()
    })
    const unsubscribeZoom = useZoomStore.subscribe((state, prev) => {
      if (state.pixelsPerSecond !== prev.pixelsPerSecond) update()
    })
    return () => {
      unsubscribePlayback()
      unsubscribeZoom()
    }
  }, [active, fps, recordStartFrame])

  if (!active) return null

  const pixelsPerFrame = fps > 0 ? useZoomStore.getState().pixelsPerSecond / fps : 0
  const left = recordStartFrame * pixelsPerFrame
  const width =
    Math.max(0, usePlaybackStore.getState().currentFrame - recordStartFrame) * pixelsPerFrame

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 z-10 h-10">
      <div
        ref={barRef}
        className="absolute top-0 h-full rounded-sm border border-destructive/70 bg-destructive/20"
        style={{
          left: `${left}px`,
          width: `${width}px`,
        }}
      />
      <div
        ref={labelRef}
        className="absolute top-1 flex items-center gap-1 rounded-sm bg-destructive/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
        style={{ left: `${left}px` }}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full bg-white ${status === 'recording' ? 'animate-pulse' : ''}`}
          aria-hidden="true"
        />
        {status === 'finalizing' ? t('recording.saving') : t('recording.rec')}
      </div>
    </div>
  )
})
