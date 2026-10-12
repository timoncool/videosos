import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getTranscriptionOverallProgress,
  getTranscriptionProgressDetail,
  getTranscriptionProgressLabel,
  getTranscriptionStageLabel,
  isIndeterminateTranscriptionProgress,
} from '@/shared/utils/transcription-progress'
import { formatDuration } from '@/shared/utils/time-utils'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useMediaPreparationStore } from '../stores/media-preparation-store'

/**
 * Derives all background-task progress display state (proxy generation,
 * transcription, AI analysis, and media preparation): aggregate counts, average
 * progress, single-item stage labels, and the per-item rows shown when a
 * progress bar is expanded. Pure derivations extracted verbatim from
 * `MediaLibrary`; reads its own store slices.
 */
export function useMediaTaskProgress() {
  const { t } = useTranslation()
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)
  const proxyProgress = useMediaLibraryStore((s) => s.proxyProgress)
  const interpolationStatus = useMediaLibraryStore((s) => s.interpolationStatus)
  const interpolationProgress = useMediaLibraryStore((s) => s.interpolationProgress)
  const interpolationStage = useMediaLibraryStore((s) => s.interpolationStage)
  const interpolationEtaSeconds = useMediaLibraryStore((s) => s.interpolationEtaSeconds)
  const upscaleStatus = useMediaLibraryStore((s) => s.upscaleStatus)
  const upscaleProgress = useMediaLibraryStore((s) => s.upscaleProgress)
  const upscaleEtaSeconds = useMediaLibraryStore((s) => s.upscaleEtaSeconds)
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus)
  const transcriptProgress = useMediaLibraryStore((s) => s.transcriptProgress)
  const analysisProgress = useMediaLibraryStore((s) => s.analysisProgress)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const preparationTasks = useMediaPreparationStore((s) => s.tasks)

  const generatingCount = useMemo(() => {
    let count = 0
    for (const status of proxyStatus.values()) {
      if (status === 'generating') count++
    }
    return count
  }, [proxyStatus])

  const interpolatingCount = useMemo(() => {
    let count = 0
    for (const status of interpolationStatus.values()) {
      if (status === 'generating') count++
    }
    return count
  }, [interpolationStatus])

  const interpolatingAvgProgress = useMemo(() => {
    if (interpolatingCount === 0) return 0
    let total = 0
    let count = 0
    for (const [id, status] of interpolationStatus.entries()) {
      if (status === 'generating') {
        total += interpolationProgress.get(id) ?? 0
        count++
      }
    }
    return count > 0 ? total / count : 0
  }, [interpolationStatus, interpolationProgress, interpolatingCount])

  /**
   * The one-time 21MB RIFE download is worth calling out — otherwise the first run looks like
   * a stalled render. Any job still downloading flips the whole label.
   */
  const isDownloadingInterpolationModel = useMemo(() => {
    for (const [id, status] of interpolationStatus.entries()) {
      if (status === 'generating' && interpolationStage.get(id) === 'downloading-model') return true
    }
    return false
  }, [interpolationStatus, interpolationStage])

  /**
   * Only one interpolation renders at a time, so the longest remaining estimate is the active
   * job's. Queued jobs have no estimate at all, which is why this is a max and not a sum.
   */
  const interpolationEtaLabel = useMemo(() => {
    let longest: number | null = null
    for (const [id, status] of interpolationStatus.entries()) {
      if (status !== 'generating') continue
      const eta = interpolationEtaSeconds.get(id)
      if (eta !== undefined && (longest === null || eta > longest)) longest = eta
    }
    if (longest === null || longest < 1) return null
    return t('media.library.timeRemaining', { time: formatDuration(longest) })
  }, [interpolationStatus, interpolationEtaSeconds, t])

  const interpolationItemRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; percent: number }> = []
    for (const [id, status] of interpolationStatus.entries()) {
      if (status === 'generating') {
        rows.push({
          id,
          name: mediaById[id]?.fileName ?? id,
          percent: Math.round((interpolationProgress.get(id) ?? 0) * 100),
        })
      }
    }
    return rows
  }, [interpolationStatus, interpolationProgress, mediaById])

  const upscalingCount = useMemo(() => {
    let count = 0
    for (const status of upscaleStatus.values()) {
      if (status === 'generating') count++
    }
    return count
  }, [upscaleStatus])

  const upscalingAvgProgress = useMemo(() => {
    if (upscalingCount === 0) return 0
    let total = 0
    let count = 0
    for (const [id, status] of upscaleStatus.entries()) {
      if (status === 'generating') {
        total += upscaleProgress.get(id) ?? 0
        count++
      }
    }
    return count > 0 ? total / count : 0
  }, [upscaleStatus, upscaleProgress, upscalingCount])

  /**
   * Only one upscale renders at a time, so the longest remaining estimate is the active job's.
   * Queued jobs have no estimate at all, which is why this is a max and not a sum.
   */
  const upscaleEtaLabel = useMemo(() => {
    let longest: number | null = null
    for (const [id, status] of upscaleStatus.entries()) {
      if (status !== 'generating') continue
      const eta = upscaleEtaSeconds.get(id)
      if (eta !== undefined && (longest === null || eta > longest)) longest = eta
    }
    if (longest === null || longest < 1) return null
    return t('media.library.timeRemaining', { time: formatDuration(longest) })
  }, [upscaleStatus, upscaleEtaSeconds, t])

  const upscaleItemRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; percent: number }> = []
    for (const [id, status] of upscaleStatus.entries()) {
      if (status === 'generating') {
        rows.push({
          id,
          name: mediaById[id]?.fileName ?? id,
          percent: Math.round((upscaleProgress.get(id) ?? 0) * 100),
        })
      }
    }
    return rows
  }, [upscaleStatus, upscaleProgress, mediaById])

  const analysisPercent =
    analysisProgress && analysisProgress.total > 0
      ? (analysisProgress.completed / analysisProgress.total) * 100
      : 0

  const activePreparationTasks = useMemo(
    () =>
      [...preparationTasks.values()].filter(
        (task) => task.type !== 'import' && (task.status === 'queued' || task.status === 'running'),
      ),
    [preparationTasks],
  )

  const transcribingCount = useMemo(() => {
    let count = 0
    for (const status of transcriptStatus.values()) {
      if (status === 'queued' || status === 'transcribing') count++
    }
    return count
  }, [transcriptStatus])

  // Average progress of all generating proxies
  const generatingAvgProgress = useMemo(() => {
    if (generatingCount === 0) return 0
    let total = 0
    let count = 0
    for (const [id, status] of proxyStatus.entries()) {
      if (status === 'generating') {
        total += proxyProgress.get(id) ?? 0
        count++
      }
    }
    return count > 0 ? total / count : 0
  }, [proxyStatus, proxyProgress, generatingCount])

  const transcribingAvgProgress = useMemo(() => {
    if (transcribingCount === 0) return 0
    let total = 0
    let count = 0
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id)
        total += progress ? getTranscriptionOverallProgress(progress) : 0
        count++
      }
    }
    return count > 0 ? total / count : 0
  }, [transcriptStatus, transcriptProgress, transcribingCount])

  // Only meaningful for a single job — with several in flight there is no one stage to name.
  const singleTranscriptionProgress = useMemo(() => {
    if (transcribingCount !== 1) return null
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        return transcriptProgress.get(id) ?? null
      }
    }
    return null
  }, [transcriptStatus, transcriptProgress, transcribingCount])

  const singleTranscriptionStageLabel = singleTranscriptionProgress
    ? getTranscriptionProgressLabel(singleTranscriptionProgress)
    : null

  // Only the byte counter, never the compile prose: this bar lives in a ~250px panel, where
  // "Optimizing for your hardware" truncates to noise. The pulsing indeterminate bar alongside
  // "Preparing model" already says the compile is working. The dialog has room for the prose.
  const singleTranscriptionDetail =
    singleTranscriptionProgress?.stage === 'downloading'
      ? getTranscriptionProgressDetail(singleTranscriptionProgress)
      : null

  /** Some stages report no fraction at all — show a moving bar, not a stalled one. */
  const singleTranscriptionIndeterminate = singleTranscriptionProgress
    ? isIndeterminateTranscriptionProgress(singleTranscriptionProgress)
    : false

  // Per-item breakdowns shown when the aggregate progress bar is expanded.
  const proxyItemRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; percent: number }> = []
    for (const [id, status] of proxyStatus.entries()) {
      if (status === 'generating') {
        rows.push({
          id,
          name: mediaById[id]?.fileName ?? id,
          percent: Math.round((proxyProgress.get(id) ?? 0) * 100),
        })
      }
    }
    return rows
  }, [proxyStatus, proxyProgress, mediaById])

  const transcriptionItemRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; percent: number; stage: string | null }> = []
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id)
        rows.push({
          id,
          name: mediaById[id]?.fileName ?? id,
          percent: progress ? Math.round(getTranscriptionOverallProgress(progress) * 100) : 0,
          stage: progress ? getTranscriptionStageLabel(progress.stage) : null,
        })
      }
    }
    return rows
  }, [transcriptStatus, transcriptProgress, mediaById])

  const preparationItemRows = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string
        name: string
        kinds: string[]
        progress: number
        status: 'queued' | 'running'
        taskCount: number
      }
    >()

    for (const task of activePreparationTasks) {
      const kind =
        task.type === 'import'
          ? t('media.library.preparationType.import')
          : task.type === 'filmstrip'
            ? t('media.library.preparationType.filmstrip')
            : t('media.library.preparationType.waveform')
      const existing = groups.get(task.mediaId)
      if (existing) {
        existing.kinds.push(kind)
        existing.progress += task.progress
        existing.taskCount += 1
        if (task.status === 'running') {
          existing.status = 'running'
        }
        continue
      }

      groups.set(task.mediaId, {
        id: task.mediaId,
        name: mediaById[task.mediaId]?.fileName ?? task.mediaId,
        kinds: [kind],
        progress: task.progress,
        status: task.status === 'running' ? 'running' : 'queued',
        taskCount: 1,
      })
    }

    return [...groups.values()].map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kinds.join(' + '),
      percent: Math.round((row.progress / row.taskCount) * 100),
      progress: row.progress / row.taskCount,
      status: row.status,
    }))
  }, [activePreparationTasks, mediaById, t])

  const preparingCount = preparationItemRows.length
  const preparingAvgProgress = useMemo(() => {
    if (preparationItemRows.length === 0) return 0
    const total = preparationItemRows.reduce((sum, row) => sum + row.progress, 0)
    return total / preparationItemRows.length
  }, [preparationItemRows])
  const hasRunningPreparationTasks = preparationItemRows.some((row) => row.status === 'running')

  return {
    analysisProgress,
    analysisPercent,
    generatingCount,
    generatingAvgProgress,
    proxyItemRows,
    interpolatingCount,
    interpolatingAvgProgress,
    interpolationItemRows,
    interpolationEtaLabel,
    isDownloadingInterpolationModel,
    upscalingCount,
    upscalingAvgProgress,
    upscaleItemRows,
    upscaleEtaLabel,
    transcribingCount,
    transcribingAvgProgress,
    singleTranscriptionStageLabel,
    singleTranscriptionDetail,
    singleTranscriptionIndeterminate,
    transcriptionItemRows,
    preparationItemRows,
    preparingCount,
    preparingAvgProgress,
    hasRunningPreparationTasks,
  }
}
