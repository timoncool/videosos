import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { FloatingPanel } from '@/components/ui/floating-panel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { removeSilenceFromItems } from '../stores/timeline-actions'
import { useSilenceRemovalDialogStore } from '../stores/silence-removal-dialog-store'
import {
  analyzeSilenceForItems,
  applySilencePreviewOverlays,
  clearSilencePreviewOverlays,
  type SilenceRemovalSettings,
} from '../utils/silence-removal-preview'
import type { RemoveSilenceResult } from '../stores/actions/item-edit-actions'
import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { sourceSecondsToTimelineFrame } from '../utils/media-item-frames'
import { getItemSourceSpanSeconds, getMediaSourceFps } from '../utils/media-item-frames'
import { ClipWaveform } from './clip-waveform'
import type { TimelineItem } from '@/types/timeline'

function areSettingsEqual(a: SilenceRemovalSettings, b: SilenceRemovalSettings): boolean {
  return Object.entries(a).every(([key, value]) => b[key as keyof SilenceRemovalSettings] === value)
}

const logger = createLogger('SilenceRemovalDialog')
const SILENCE_REMOVAL_PANEL_STORAGE_KEY = 'timeline:silenceRemovalPanelBounds'
const SILENCE_REMOVAL_PANEL_DEFAULT_BOUNDS = { x: -1, y: -1, width: 420, height: 320 }

interface AuditionPlan {
  skipEndFrame?: number
  skipStartFrame?: number
  stopFrame: number
}

interface ReviewRange {
  end: number
  index: number
  key: string
  label: string
  mediaId: string
  start: number
}

interface ReviewWaveformModel {
  item: TimelineItem & { mediaId: string; type: 'audio' | 'video' }
  ranges: Array<{ endRatio: number; key: string; startRatio: number }>
  sourceDuration: number
  sourceEnd: number
  sourceStart: number
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.0s'
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function SettingControl({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  const commitValue = useCallback(
    (nextValue: number) => {
      onChange(clampNumber(nextValue, min, max))
    },
    [max, min, onChange],
  )

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => commitValue(Number(event.target.value))}
            className="h-7 w-16 px-2 text-right text-xs"
          />
          <span className="w-7 text-xs text-muted-foreground">{suffix}</span>
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([nextValue]) => {
          if (nextValue !== undefined) commitValue(nextValue)
        }}
      />
    </div>
  )
}

export function SilenceRemovalDialog() {
  const { t } = useTranslation()
  const isOpen = useSilenceRemovalDialogStore((state) => state.isOpen)
  const itemIds = useSilenceRemovalDialogStore((state) => state.itemIds)
  const settings = useSilenceRemovalDialogStore((state) => state.settings)
  const rangesByMediaId = useSilenceRemovalDialogStore((state) => state.rangesByMediaId)
  const summary = useSilenceRemovalDialogStore((state) => state.summary)
  const failedMediaCount = useSilenceRemovalDialogStore((state) => state.failedMediaCount)
  const analyzedMediaCount = useSilenceRemovalDialogStore((state) => state.analyzedMediaCount)
  const updatePreview = useSilenceRemovalDialogStore((state) => state.updatePreview)
  const close = useSilenceRemovalDialogStore((state) => state.close)
  const [draft, setDraft] = useState<SilenceRemovalSettings>(settings)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [waveformZoom, setWaveformZoom] = useState(1)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const auditionPlanRef = useRef<AuditionPlan | null>(null)
  const analyzedCurrentOpenRef = useRef(false)
  const itemById = useItemsStore((state) => state.itemById)
  const timelineFps = useTimelineSettingsStore((state) => state.fps)

  const reviewRanges = useMemo<ReviewRange[]>(() => {
    const labelByMediaId = new Map<string, string>()
    for (const itemId of itemIds) {
      const item = itemById[itemId]
      if ((item?.type === 'audio' || item?.type === 'video') && item.mediaId) {
        labelByMediaId.set(item.mediaId, item.label)
      }
    }
    return Object.entries(rangesByMediaId).flatMap(([mediaId, ranges]) =>
      ranges.map((range, index) => ({
        ...range,
        index,
        key: `${mediaId}:${index}:${range.start}:${range.end}`,
        label: labelByMediaId.get(mediaId) ?? mediaId,
        mediaId,
      })),
    )
  }, [itemById, itemIds, rangesByMediaId])

  const reviewWaveform = useMemo<ReviewWaveformModel | null>(() => {
    const item = itemIds
      .map((itemId) => itemById[itemId])
      .find(
        (
          candidate,
        ): candidate is TimelineItem & {
          mediaId: string
          type: 'audio' | 'video'
        } => (candidate?.type === 'audio' || candidate?.type === 'video') && !!candidate.mediaId,
      )
    if (!item) return null
    const span = getItemSourceSpanSeconds(item, timelineFps)
    if (!span) return null
    const sourceFps = getMediaSourceFps(item, timelineFps)
    const sourceDuration = Math.max(
      span.end,
      item.sourceDuration !== undefined ? item.sourceDuration / sourceFps : span.end,
    )
    const itemRanges = rangesByMediaId[item.mediaId] ?? []
    const ranges = itemRanges.flatMap((range, index) => {
      const mappedStart = sourceSecondsToTimelineFrame(item, range.start, timelineFps)
      const mappedEnd = sourceSecondsToTimelineFrame(item, range.end, timelineFps)
      const startRatio = Math.max(
        0,
        Math.min(1, (Math.min(mappedStart, mappedEnd) - item.from) / item.durationInFrames),
      )
      const endRatio = Math.max(
        0,
        Math.min(1, (Math.max(mappedStart, mappedEnd) - item.from) / item.durationInFrames),
      )
      return endRatio > startRatio
        ? [{ startRatio, endRatio, key: `${item.mediaId}:${index}:${range.start}:${range.end}` }]
        : []
    })
    return { item, ranges, sourceDuration, sourceEnd: span.end, sourceStart: span.start }
  }, [itemById, itemIds, rangesByMediaId, timelineFps])

  useEffect(() => {
    if (isOpen) {
      setDraft(settings)
      setWaveformZoom(1)
    }
  }, [isOpen, settings])

  const handleClose = useCallback(() => {
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null
    if (auditionPlanRef.current) {
      usePlaybackStore.getState().pause()
      auditionPlanRef.current = null
    }
    clearSilencePreviewOverlays(itemIds)
    close()
  }, [close, itemIds])

  useEffect(
    () =>
      usePlaybackStore.subscribe((state, previous) => {
        const plan = auditionPlanRef.current
        if (!plan || state.currentFrame === previous.currentFrame) return
        if (
          plan.skipStartFrame !== undefined &&
          plan.skipEndFrame !== undefined &&
          state.currentFrame >= plan.skipStartFrame &&
          state.currentFrame < plan.skipEndFrame
        ) {
          state.setCurrentFrame(plan.skipEndFrame)
          return
        }
        if (state.currentFrame >= plan.stopFrame) {
          state.pause()
          auditionPlanRef.current = null
        }
      }),
    [],
  )

  const handlePanelClose = useCallback(() => handleClose(), [handleClose])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture-phase + consume so the timeline's global keydown doesn't also
      // react to Escape (e.g. clearing selection) while we're closing.
      event.preventDefault()
      event.stopPropagation()
      handleClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleClose, isOpen])

  const runPreviewAnalysis = useCallback(
    (nextSettings: SilenceRemovalSettings) => {
      const run = async () => {
        const abortController = new AbortController()
        analysisAbortRef.current?.abort()
        analysisAbortRef.current = abortController
        setIsAnalyzing(true)
        setAnalysisProgress(0)
        try {
          const analysis = await analyzeSilenceForItems(itemIds, nextSettings, {
            signal: abortController.signal,
            onProgress: setAnalysisProgress,
          })
          if (abortController.signal.aborted) return
          const nextRangesByMediaId = analysis.rangesByMediaId
          const nextSummary = applySilencePreviewOverlays(itemIds, nextRangesByMediaId)
          updatePreview({
            settings: nextSettings,
            rangesByMediaId: nextRangesByMediaId,
            summary: nextSummary,
            analyzedMediaCount: analysis.analyzedMediaIds.length,
            failedMediaCount: analysis.failedMediaIds.length,
          })
          if (analysis.failedMediaIds.length > 0) {
            toast.warning(
              t('timeline.silenceRemoval.partialFailure', {
                count: analysis.failedMediaIds.length,
              }),
            )
          }
          if (nextSummary.rangeCount === 0) {
            toast.info(t('timeline.silenceRemoval.toastNoRemovable'))
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return
          logger.warn('Silence preview failed', error)
          toast.error(
            error instanceof Error
              ? error.message
              : t('timeline.silenceRemoval.toastPreviewFailed'),
          )
        } finally {
          if (analysisAbortRef.current === abortController) {
            analysisAbortRef.current = null
            setIsAnalyzing(false)
            setAnalysisProgress(0)
          }
        }
      }

      void run()
    },
    [itemIds, t, updatePreview],
  )

  const handleUpdatePreview = useCallback(() => {
    runPreviewAnalysis(draft)
  }, [draft, runPreviewAnalysis])

  const handleModeChange = useCallback(
    (mode: SilenceRemovalSettings['mode']) => {
      if (draft.mode === mode) return
      const nextDraft = { ...draft, mode }
      setDraft(nextDraft)
      runPreviewAnalysis(nextDraft)
    },
    [draft, runPreviewAnalysis],
  )

  useEffect(() => {
    if (!isOpen) {
      analyzedCurrentOpenRef.current = false
      return
    }
    if (analyzedCurrentOpenRef.current) return
    analyzedCurrentOpenRef.current = true
    runPreviewAnalysis(settings)
  }, [isOpen, runPreviewAnalysis, settings])

  const handleApply = useCallback(() => {
    if (!areSettingsEqual(draft, settings)) {
      toast.info(t('timeline.silenceRemoval.toastSettingsChanged'))
      return
    }

    let result: RemoveSilenceResult | null = null
    try {
      result = removeSilenceFromItems(itemIds, rangesByMediaId)
    } finally {
      clearSilencePreviewOverlays(itemIds)
      close()
    }

    if (!result || result.removedItemCount === 0) {
      toast.info(t('timeline.silenceRemoval.toastNoneInClips'))
      return
    }

    toast.success(t('timeline.silenceRemoval.toastRemoved', { count: result.removedRangeCount }))
  }, [close, draft, itemIds, rangesByMediaId, settings, t])

  const commitReviewedRanges = useCallback(
    (nextRangesByMediaId: typeof rangesByMediaId) => {
      const nextSummary = applySilencePreviewOverlays(itemIds, nextRangesByMediaId)
      updatePreview({
        settings,
        rangesByMediaId: nextRangesByMediaId,
        summary: nextSummary,
        analyzedMediaCount,
        failedMediaCount,
      })
    },
    [analyzedMediaCount, failedMediaCount, itemIds, settings, updatePreview],
  )

  const handleKeepRange = useCallback(
    (range: ReviewRange) => {
      const nextRanges = (rangesByMediaId[range.mediaId] ?? []).filter(
        (_, index) => index !== range.index,
      )
      const nextRangesByMediaId = { ...rangesByMediaId }
      if (nextRanges.length > 0) nextRangesByMediaId[range.mediaId] = nextRanges
      else delete nextRangesByMediaId[range.mediaId]
      commitReviewedRanges(nextRangesByMediaId)
    },
    [commitReviewedRanges, rangesByMediaId],
  )

  const handleRangeBoundaryChange = useCallback(
    (range: ReviewRange, boundary: 'end' | 'start', value: number) => {
      if (!Number.isFinite(value)) return
      const mediaRanges = rangesByMediaId[range.mediaId] ?? []
      const current = mediaRanges[range.index]
      if (!current) return
      const next =
        boundary === 'start'
          ? { ...current, start: Math.max(0, Math.min(value, current.end - 0.01)) }
          : { ...current, end: Math.max(current.start + 0.01, value) }
      const nextMediaRanges = mediaRanges.map((candidate, index) =>
        index === range.index ? next : candidate,
      )
      commitReviewedRanges({ ...rangesByMediaId, [range.mediaId]: nextMediaRanges })
    },
    [commitReviewedRanges, rangesByMediaId],
  )

  const findAuditionFrames = useCallback(
    (range: ReviewRange) => {
      const fps = timelineFps
      for (const itemId of itemIds) {
        const item = itemById[itemId]
        if ((item?.type !== 'audio' && item?.type !== 'video') || item.mediaId !== range.mediaId) {
          continue
        }
        const mappedStart = sourceSecondsToTimelineFrame(item, range.start, fps)
        const mappedEnd = sourceSecondsToTimelineFrame(item, range.end, fps)
        const startFrame = Math.max(item.from, Math.min(mappedStart, mappedEnd))
        const endFrame = Math.min(
          item.from + item.durationInFrames,
          Math.max(mappedStart, mappedEnd),
        )
        if (endFrame > startFrame) return { endFrame, fps, item, startFrame }
      }
      return null
    },
    [itemById, itemIds, timelineFps],
  )

  const handlePlayRange = useCallback(
    (range: ReviewRange) => {
      const target = findAuditionFrames(range)
      if (!target) return
      auditionPlanRef.current = { stopFrame: target.endFrame }
      const playback = usePlaybackStore.getState()
      playback.pause()
      playback.setCurrentFrame(target.startFrame)
      playback.play()
    },
    [findAuditionFrames],
  )

  const handlePreviewCut = useCallback(
    (range: ReviewRange) => {
      const target = findAuditionFrames(range)
      if (!target) return
      const handleFrames = Math.max(1, Math.round(target.fps * 0.5))
      const previewStart = Math.max(target.item.from, target.startFrame - handleFrames)
      const previewEnd = Math.min(
        target.item.from + target.item.durationInFrames,
        target.endFrame + handleFrames,
      )
      auditionPlanRef.current = {
        skipStartFrame: target.startFrame,
        skipEndFrame: target.endFrame,
        stopFrame: previewEnd,
      }
      const playback = usePlaybackStore.getState()
      playback.pause()
      playback.setCurrentFrame(previewStart)
      playback.play()
    },
    [findAuditionFrames],
  )

  if (!isOpen) {
    return null
  }

  return (
    <FloatingPanel
      title={t('timeline.silenceRemoval.title')}
      defaultBounds={SILENCE_REMOVAL_PANEL_DEFAULT_BOUNDS}
      minWidth={420}
      minHeight={320}
      storageKey={SILENCE_REMOVAL_PANEL_STORAGE_KEY}
      onClose={handlePanelClose}
      resizable={false}
      autoHeight
      className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90"
    >
      <section
        role="dialog"
        aria-label={t('timeline.silenceRemoval.title')}
        aria-modal="false"
        className="flex flex-col"
      >
        <div className="space-y-4 p-3">
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm leading-tight">
            <div className="font-medium">
              {t('timeline.silenceRemoval.rangesSelected', { count: summary.rangeCount })}
            </div>
            {failedMediaCount > 0 && (
              <div className="mt-1 text-xs text-amber-400">
                {t('timeline.silenceRemoval.partialFailure', { count: failedMediaCount })}
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              {t('timeline.silenceRemoval.aboutWillBeRemoved', {
                duration: formatSeconds(summary.totalSeconds),
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/40 p-1">
            <Button
              type="button"
              size="sm"
              variant={draft.mode === 'signal' ? 'secondary' : 'ghost'}
              onClick={() => handleModeChange('signal')}
              disabled={isAnalyzing && draft.mode === 'signal'}
            >
              {t('timeline.silenceRemoval.signalMode')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={draft.mode === 'speech' ? 'secondary' : 'ghost'}
              onClick={() => handleModeChange('speech')}
              disabled={isAnalyzing && draft.mode === 'speech'}
            >
              {t('timeline.silenceRemoval.speechMode')}
            </Button>
          </div>

          <div className="space-y-3.5">
            {draft.mode === 'signal' && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="silence-auto-thresholds" className="text-xs font-medium">
                    {t('timeline.silenceRemoval.autoThresholds')}
                  </Label>
                  <Switch
                    id="silence-auto-thresholds"
                    checked={draft.autoThresholds}
                    onCheckedChange={(autoThresholds) =>
                      setDraft((current) => ({ ...current, autoThresholds }))
                    }
                  />
                </div>
                {!draft.autoThresholds && (
                  <>
                    <SettingControl
                      id="silence-threshold"
                      label={t('timeline.silenceRemoval.silenceThreshold')}
                      value={draft.thresholdDb}
                      min={-80}
                      max={-20}
                      step={1}
                      suffix="dB"
                      onChange={(thresholdDb) =>
                        setDraft((current) => ({ ...current, thresholdDb }))
                      }
                    />
                    <SettingControl
                      id="audio-threshold"
                      label={t('timeline.silenceRemoval.audioThreshold')}
                      value={draft.audioThresholdDb}
                      min={Math.min(-19, draft.thresholdDb + 1)}
                      max={-6}
                      step={1}
                      suffix="dB"
                      onChange={(audioThresholdDb) =>
                        setDraft((current) => ({ ...current, audioThresholdDb }))
                      }
                    />
                  </>
                )}
              </>
            )}
            <SettingControl
              id="silence-duration"
              label={t('timeline.silenceRemoval.minimumSilence')}
              value={draft.minSilenceMs}
              min={100}
              max={3000}
              step={50}
              suffix="ms"
              onChange={(minSilenceMs) => setDraft((current) => ({ ...current, minSilenceMs }))}
            />
            {draft.mode === 'signal' && (
              <SettingControl
                id="audio-duration"
                label={t('timeline.silenceRemoval.minimumAudio')}
                value={draft.minAudioMs}
                min={20}
                max={1000}
                step={20}
                suffix="ms"
                onChange={(minAudioMs) => setDraft((current) => ({ ...current, minAudioMs }))}
              />
            )}
            <SettingControl
              id="silence-padding-start"
              label={t('timeline.silenceRemoval.keepAfterAudio')}
              value={draft.paddingStartMs}
              min={0}
              max={1000}
              step={25}
              suffix="ms"
              onChange={(paddingStartMs) => setDraft((current) => ({ ...current, paddingStartMs }))}
            />
            <SettingControl
              id="silence-padding-end"
              label={t('timeline.silenceRemoval.keepBeforeAudio')}
              value={draft.paddingEndMs}
              min={0}
              max={1000}
              step={25}
              suffix="ms"
              onChange={(paddingEndMs) => setDraft((current) => ({ ...current, paddingEndMs }))}
            />
          </div>

          {reviewRanges.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">
                {t('timeline.silenceRemoval.reviewRanges')}
              </Label>
              {reviewWaveform && (
                <div className="space-y-1.5 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {reviewWaveform.item.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-7 px-0"
                        aria-label={t('timeline.toolbar.zoomOut')}
                        disabled={waveformZoom <= 1}
                        onClick={() => setWaveformZoom((zoom) => Math.max(1, zoom / 2))}
                      >
                        −
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        aria-label={t('timeline.toolbar.zoomToFit')}
                        onClick={() => setWaveformZoom(1)}
                      >
                        {waveformZoom}×
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-7 px-0"
                        aria-label={t('timeline.toolbar.zoomIn')}
                        disabled={waveformZoom >= 8}
                        onClick={() => setWaveformZoom((zoom) => Math.min(8, zoom * 2))}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded bg-muted/30">
                    <div
                      className="relative h-20 min-w-full"
                      style={{ width: `${Math.round(360 * waveformZoom)}px` }}
                    >
                      <ClipWaveform
                        mediaId={reviewWaveform.item.mediaId}
                        clipWidth={Math.round(360 * waveformZoom)}
                        sourceStart={reviewWaveform.sourceStart}
                        sourceEnd={reviewWaveform.sourceEnd}
                        sourceDuration={reviewWaveform.sourceDuration}
                        trimStart={0}
                        speed={reviewWaveform.item.speed ?? 1}
                        isReversed={reviewWaveform.item.isReversed}
                        fps={timelineFps}
                        isVisible
                        pixelsPerSecond={
                          Math.round(360 * waveformZoom) /
                          Math.max(0.01, reviewWaveform.item.durationInFrames / timelineFps)
                        }
                      />
                      {reviewWaveform.ranges.map((range) => (
                        <div
                          key={range.key}
                          className="pointer-events-none absolute inset-y-0 border-x border-red-400/80 bg-red-500/25"
                          style={{
                            left: `${range.startRatio * 100}%`,
                            width: `${(range.endRatio - range.startRatio) * 100}%`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <ScrollArea className="h-48 rounded-md border">
                <div className="divide-y">
                  {reviewRanges.map((range) => (
                    <div
                      key={range.key}
                      className="space-y-2 p-2 [contain-intrinsic-size:0_72px] [content-visibility:auto]"
                    >
                      <div className="truncate text-xs font-medium" title={range.label}>
                        {range.label}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[11px] text-muted-foreground">
                          {t('timeline.silenceRemoval.rangeStart')}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.05}
                          value={Number(range.start.toFixed(3))}
                          onChange={(event) =>
                            handleRangeBoundaryChange(range, 'start', Number(event.target.value))
                          }
                          className="h-7 w-20 px-1.5 text-xs"
                        />
                        <Label className="text-[11px] text-muted-foreground">
                          {t('timeline.silenceRemoval.rangeEnd')}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.05}
                          value={Number(range.end.toFixed(3))}
                          onChange={(event) =>
                            handleRangeBoundaryChange(range, 'end', Number(event.target.value))
                          }
                          className="h-7 w-20 px-1.5 text-xs"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handlePlayRange(range)}
                        >
                          {t('timeline.silenceRemoval.playRange')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handlePreviewCut(range)}
                        >
                          {t('timeline.silenceRemoval.previewCut')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleKeepRange(range)}
                        >
                          {t('timeline.silenceRemoval.keepRange')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/10 p-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={isAnalyzing ? () => analysisAbortRef.current?.abort() : handleUpdatePreview}
          >
            {isAnalyzing
              ? `${t('timeline.silenceRemoval.cancelAnalysis')} ${Math.round(analysisProgress * 100)}%`
              : t('timeline.silenceRemoval.updatePreview')}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isAnalyzing || summary.rangeCount === 0}
          >
            {t('timeline.silenceRemoval.remove')}
          </Button>
        </div>
      </section>
    </FloatingPanel>
  )
}
