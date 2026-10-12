import { getOrDecodeAudioSliceForPlayback } from '@/features/timeline/deps/composition-runtime'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import {
  mediaTranscriptionService,
  runMediaTranscriptionJob,
} from '@/features/timeline/deps/media-transcription-service'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { createLogger } from '@/shared/logging/logger'
import type { MediaTranscript } from '@/types/storage'
import {
  applyRemovalPreviewOverlays,
  clearRemovalPreviewOverlays,
  isAudioVideoItem,
} from '@/features/timeline/utils/removal-preview-overlays'
import { getItemSourceSpanSeconds } from '@/features/timeline/utils/media-item-frames'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import {
  detectSilentRanges,
  type AudioBufferLike,
  type AudioSilenceDetectionOptions,
  type AudioSilenceRange,
} from '@/shared/utils/audio-silence'

const logger = createLogger('SilenceRemovalPreview')
const SILENCE_REMOVAL_PREVIEW_OVERLAY_ID = 'silence-removal-preview'
const MAX_CONCURRENT_MEDIA_ANALYSES = 2

export type SilenceDetectionMode = 'signal' | 'speech'

export interface SilenceRemovalSettings {
  mode: SilenceDetectionMode
  autoThresholds: boolean
  thresholdDb: number
  audioThresholdDb: number
  minSilenceMs: number
  minAudioMs: number
  paddingStartMs: number
  paddingEndMs: number
  smoothingMs: number
  windowMs: number
}

export const DEFAULT_SILENCE_REMOVAL_SETTINGS: SilenceRemovalSettings = {
  mode: 'signal',
  autoThresholds: true,
  thresholdDb: -45,
  audioThresholdDb: -35,
  minSilenceMs: 500,
  minAudioMs: 80,
  paddingStartMs: 100,
  paddingEndMs: 100,
  smoothingMs: 50,
  windowMs: 20,
}

export function normalizeSilenceRemovalSettings(
  settings: Partial<SilenceRemovalSettings> & { paddingMs?: number } = {},
): SilenceRemovalSettings {
  const legacyPadding = Number.isFinite(settings.paddingMs) ? settings.paddingMs : undefined
  return {
    ...DEFAULT_SILENCE_REMOVAL_SETTINGS,
    ...settings,
    paddingStartMs:
      settings.paddingStartMs ?? legacyPadding ?? DEFAULT_SILENCE_REMOVAL_SETTINGS.paddingStartMs,
    paddingEndMs:
      settings.paddingEndMs ?? legacyPadding ?? DEFAULT_SILENCE_REMOVAL_SETTINGS.paddingEndMs,
  }
}

export type SilenceRangesByMediaId = Record<string, AudioSilenceRange[]>

export interface SilencePreviewSummary {
  rangeCount: number
  totalSeconds: number
}

export interface SilenceAnalysisResult {
  analyzedMediaIds: string[]
  failedMediaIds: string[]
  rangesByMediaId: SilenceRangesByMediaId
}

export interface SilenceAnalysisOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

interface SourceSpan {
  end: number
  start: number
}

interface MediaAnalysisTarget {
  mediaId: string
  spans: SourceSpan[]
}

interface SerializedAudioSegment {
  channels: ArrayBuffer[]
  offsetSeconds: number
  sampleRate: number
}

interface WorkerResponse {
  error?: string
  id: string
  ranges?: AudioSilenceRange[]
}

function abortError(): DOMException {
  return new DOMException('Silence analysis cancelled', 'AbortError')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

function mergeSpans(spans: readonly SourceSpan[]): SourceSpan[] {
  const sorted = spans
    .filter(
      (span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start,
    )
    .toSorted((left, right) => left.start - right.start)
  const merged: SourceSpan[] = []
  for (const span of sorted) {
    const previous = merged.at(-1)
    if (previous && span.start <= previous.end + 0.25) {
      previous.end = Math.max(previous.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

function collectTargets(itemIds: readonly string[]): MediaAnalysisTarget[] {
  const itemById = useItemsStore.getState().itemById
  const timelineFps = useTimelineSettingsStore.getState().fps
  const spansByMediaId = new Map<string, SourceSpan[]>()

  for (const itemId of itemIds) {
    const item = itemById[itemId]
    if (!isAudioVideoItem(item)) continue
    const span = getItemSourceSpanSeconds(item, timelineFps)
    if (!span) continue
    const spans = spansByMediaId.get(item.mediaId) ?? []
    spans.push(span)
    spansByMediaId.set(item.mediaId, spans)
  }

  return Array.from(spansByMediaId, ([mediaId, spans]) => ({ mediaId, spans: mergeSpans(spans) }))
}

function serializeSlice(
  buffer: AudioBuffer,
  sliceStartTime: number,
  span: SourceSpan,
): SerializedAudioSegment {
  const startSample = Math.max(0, Math.round((span.start - sliceStartTime) * buffer.sampleRate))
  const endSample = Math.min(
    buffer.length,
    Math.max(startSample, Math.round((span.end - sliceStartTime) * buffer.sampleRate)),
  )
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel).slice(startSample, endSample).buffer,
  )
  return { channels, offsetSeconds: span.start, sampleRate: buffer.sampleRate }
}

function detectSerializedSegments(
  segments: readonly SerializedAudioSegment[],
  settings: SilenceRemovalSettings,
): AudioSilenceRange[] {
  return segments.flatMap((segment) => {
    const channels = segment.channels.map((channel) => new Float32Array(channel))
    const length = channels[0]?.length ?? 0
    const buffer: AudioBufferLike = {
      duration: length / segment.sampleRate,
      length,
      numberOfChannels: channels.length,
      sampleRate: segment.sampleRate,
      getChannelData: (channel) => channels[channel] ?? new Float32Array(),
    }
    return detectSilentRanges(buffer, settings satisfies AudioSilenceDetectionOptions).map(
      (range) => ({
        start: range.start + segment.offsetSeconds,
        end: range.end + segment.offsetSeconds,
      }),
    )
  })
}

function analyzeSegmentsInWorker(
  segments: SerializedAudioSegment[],
  settings: SilenceRemovalSettings,
  signal: AbortSignal | undefined,
): Promise<AudioSilenceRange[]> {
  throwIfAborted(signal)
  if (typeof Worker === 'undefined') {
    return Promise.resolve(detectSerializedSegments(segments, settings))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/silence-detection-worker.ts', import.meta.url), {
      type: 'module',
    })
    const id = crypto.randomUUID()
    let settled = false
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => finish(() => reject(abortError()))
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return
      finish(() => {
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.ranges ?? [])
      })
    })
    worker.addEventListener('error', (event) => {
      finish(() => reject(event.error instanceof Error ? event.error : new Error(event.message)))
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.postMessage(
      { id, segments, settings },
      segments.flatMap((segment) => segment.channels),
    )
  })
}

async function analyzeSignalTarget(
  target: MediaAnalysisTarget,
  settings: SilenceRemovalSettings,
  signal: AbortSignal | undefined,
): Promise<AudioSilenceRange[]> {
  const url = await resolveMediaUrl(target.mediaId)
  if (!url) throw new Error('Could not load media for silence detection')

  const segments: SerializedAudioSegment[] = []
  for (const span of target.spans) {
    throwIfAborted(signal)
    const slice = await getOrDecodeAudioSliceForPlayback(target.mediaId, url, {
      targetTimeSeconds: span.start,
      minReadySeconds: Math.max(1, span.end - span.start),
      preRollSeconds: 0,
      waitTimeoutMs: 0,
    })
    throwIfAborted(signal)
    segments.push(serializeSlice(slice.buffer, slice.startTime, span))
  }
  return analyzeSegmentsInWorker(segments, settings, signal)
}

async function getOrCreateTranscript(mediaId: string, signal: AbortSignal | undefined) {
  throwIfAborted(signal)
  const existing = await mediaTranscriptionService.getTranscript(mediaId).catch(() => null)
  throwIfAborted(signal)
  if (existing?.segments.length) return existing
  const result = await runMediaTranscriptionJob(mediaId)
  throwIfAborted(signal)
  if (result.status === 'cancelled') throw abortError()
  return result.transcript
}

function collectSpeechRanges(transcript: MediaTranscript): SourceSpan[] {
  const wordRanges = transcript.segments.flatMap((segment) =>
    (segment.words ?? []).map((word) => ({ start: word.start, end: word.end })),
  )
  const ranges = wordRanges.length
    ? wordRanges
    : transcript.segments.map((segment) => ({ start: segment.start, end: segment.end }))
  return mergeSpans(ranges)
}

function getSpeechGapRange(
  start: number,
  end: number,
  minSilenceSeconds: number,
  paddingStartSeconds: number,
  paddingEndSeconds: number,
): AudioSilenceRange | null {
  if (end - start < minSilenceSeconds) return null
  const paddedStart = start + paddingStartSeconds
  const paddedEnd = end - paddingEndSeconds
  return paddedEnd > paddedStart ? { start: paddedStart, end: paddedEnd } : null
}

function detectSpeechSilenceForSpan(
  span: SourceSpan,
  speech: readonly SourceSpan[],
  minSilenceSeconds: number,
  paddingStartSeconds: number,
  paddingEndSeconds: number,
): AudioSilenceRange[] {
  const overlappingSpeech = speech.filter(
    (spoken) => spoken.end > span.start && spoken.start < span.end,
  )

  // Deliberately no early return when nothing overlaps. Such a span contains no
  // speech at all, so it is removable in full — and the trailing-gap call below
  // yields exactly that, since `cursor` never advances past `span.start`. An
  // early return here made a clip section before the first word, after the last
  // word, or inside an untranscribed gap preview and apply as if there were
  // nothing to remove.
  //
  // A transcript with no speech *anywhere* is a different case, guarded one
  // level up in `detectSpeechSilenceRanges`, so this cannot wipe a clip whose
  // audio was never transcribed.
  const ranges: AudioSilenceRange[] = []
  let cursor = span.start
  for (const spoken of overlappingSpeech) {
    const gap = getSpeechGapRange(
      cursor,
      Math.max(span.start, spoken.start),
      minSilenceSeconds,
      paddingStartSeconds,
      paddingEndSeconds,
    )
    if (gap) ranges.push(gap)
    cursor = Math.max(cursor, Math.min(span.end, spoken.end))
  }
  const trailingGap = getSpeechGapRange(
    cursor,
    span.end,
    minSilenceSeconds,
    paddingStartSeconds,
    paddingEndSeconds,
  )
  if (trailingGap) ranges.push(trailingGap)
  return ranges
}

export function detectSpeechSilenceRanges(
  transcript: MediaTranscript,
  spans: readonly SourceSpan[],
  settings: Pick<SilenceRemovalSettings, 'minSilenceMs' | 'paddingEndMs' | 'paddingStartMs'>,
): AudioSilenceRange[] {
  const speech = collectSpeechRanges(transcript)
  if (speech.length === 0) return []
  const minSilenceSeconds = Math.max(0, settings.minSilenceMs) / 1000
  const paddingStartSeconds = Math.max(0, settings.paddingStartMs) / 1000
  const paddingEndSeconds = Math.max(0, settings.paddingEndMs) / 1000
  return spans.flatMap((span) =>
    detectSpeechSilenceForSpan(
      span,
      speech,
      minSilenceSeconds,
      paddingStartSeconds,
      paddingEndSeconds,
    ),
  )
}

async function analyzeSpeechTarget(
  target: MediaAnalysisTarget,
  settings: SilenceRemovalSettings,
  signal: AbortSignal | undefined,
): Promise<AudioSilenceRange[]> {
  const transcript = await getOrCreateTranscript(target.mediaId, signal)
  return detectSpeechSilenceRanges(transcript, target.spans, settings)
}

async function settleTargets(
  targets: readonly MediaAnalysisTarget[],
  settings: SilenceRemovalSettings,
  options: SilenceAnalysisOptions,
): Promise<Array<PromiseSettledResult<{ mediaId: string; ranges: AudioSilenceRange[] }>>> {
  const results: Array<PromiseSettledResult<{ mediaId: string; ranges: AudioSilenceRange[] }>> =
    new Array(targets.length)
  let cursor = 0
  let completed = 0

  const run = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      const target = targets[index]
      if (!target) return
      try {
        throwIfAborted(options.signal)
        const ranges =
          settings.mode === 'speech'
            ? await analyzeSpeechTarget(target, settings, options.signal)
            : await analyzeSignalTarget(target, settings, options.signal)
        results[index] = { status: 'fulfilled', value: { mediaId: target.mediaId, ranges } }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      } finally {
        completed += 1
        options.onProgress?.(targets.length > 0 ? completed / targets.length : 1)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_MEDIA_ANALYSES, targets.length) }, () => run()),
  )
  return results
}

interface AnalysisAccumulator {
  analyzedMediaIds: string[]
  failedMediaIds: string[]
  rangesByMediaId: SilenceRangesByMediaId
}

function collectSettledTarget(
  accumulator: AnalysisAccumulator,
  target: MediaAnalysisTarget,
  result: PromiseSettledResult<{ mediaId: string; ranges: AudioSilenceRange[] }>,
): void {
  if (result.status === 'fulfilled') {
    accumulator.analyzedMediaIds.push(result.value.mediaId)
    if (result.value.ranges.length > 0) {
      accumulator.rangesByMediaId[result.value.mediaId] = result.value.ranges
    }
    return
  }
  if (result.reason instanceof DOMException && result.reason.name === 'AbortError') {
    throw result.reason
  }
  accumulator.failedMediaIds.push(target.mediaId)
  logger.warn('Silence detection failed for media', {
    mediaId: target.mediaId,
    reason: result.reason,
  })
}

export async function analyzeSilenceForItems(
  itemIds: readonly string[],
  settings: SilenceRemovalSettings,
  options: SilenceAnalysisOptions = {},
): Promise<SilenceAnalysisResult> {
  throwIfAborted(options.signal)
  const targets = collectTargets(itemIds)
  const results = await settleTargets(targets, settings, options)
  const accumulator: AnalysisAccumulator = {
    analyzedMediaIds: [],
    failedMediaIds: [],
    rangesByMediaId: {},
  }

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const target = targets[index]
    if (!result || !target) continue
    collectSettledTarget(accumulator, target, result)
  }

  if (accumulator.analyzedMediaIds.length === 0 && targets.length > 0) {
    throw new Error('Could not analyze media for silence detection')
  }
  return accumulator
}

export function clearSilencePreviewOverlays(itemIds: readonly string[]): void {
  clearRemovalPreviewOverlays(itemIds, SILENCE_REMOVAL_PREVIEW_OVERLAY_ID)
}

export function applySilencePreviewOverlays(
  itemIds: readonly string[],
  rangesByMediaId: SilenceRangesByMediaId,
): SilencePreviewSummary {
  return applyRemovalPreviewOverlays({
    itemIds,
    rangesByMediaId,
    overlayId: SILENCE_REMOVAL_PREVIEW_OVERLAY_ID,
    labelNoun: 'silent',
    tone: 'error',
  })
}
