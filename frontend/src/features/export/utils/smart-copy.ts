import type { AudioEqSettings } from '@/types/audio'
import type { ItemKeyframes } from '@/types/keyframe'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack, VideoItem, AudioItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { getMediaFileById, getMediaMetadataById } from '../deps/media-library'
import type { ClientExportSettings, ClientRenderResult, RenderProgress } from '../deps/renderer'
import { normalizeVideoCodec } from '../deps/renderer'

export type SmartCopyReason =
  | 'eligible'
  | 'disabled'
  | 'not-video'
  | 'range'
  | 'timeline-layout'
  | 'source-unavailable'
  | 'trimmed-or-retimed'
  | 'visual-processing'
  | 'audio-processing'
  | 'project-mismatch'
  | 'format-mismatch'

export interface SmartCopyAssessment {
  eligible: boolean
  reason: SmartCopyReason
  mediaId?: string
  source?: MediaMetadata
}

export interface SmartCopyContext {
  settings: ClientExportSettings
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  width: number
  height: number
  inPoint: number | null
  outPoint: number | null
  busAudioEq?: AudioEqSettings
  masterBusDb?: number
  source?: MediaMetadata
}

function nearlyEqual(a: number | undefined, b: number, tolerance = 0.01): boolean {
  return a === undefined || Math.abs(a - b) <= tolerance
}

function hasNonZeroField<T extends object>(value: T, fields: Array<keyof T>): boolean {
  return fields.some((field) => {
    const current = value[field]
    return typeof current === 'number' && current !== 0
  })
}

function hasEnabledField<T extends object>(value: T, fields: Array<keyof T>): boolean {
  return fields.some((field) => value[field] === true)
}

function hasEqProcessing(eq: AudioEqSettings | undefined): boolean {
  if (!eq) return false
  return (
    hasNonZeroField(eq, ['outputGainDb', 'midGainDb']) ||
    hasEnabledField(eq, [
      'band1Enabled',
      'lowCutEnabled',
      'lowEnabled',
      'lowMidEnabled',
      'highMidEnabled',
      'highEnabled',
      'band6Enabled',
      'highCutEnabled',
    ])
  )
}

function hasItemAudioProcessing(item: VideoItem | AudioItem): boolean {
  return (
    hasNonZeroField(item, [
      'volume',
      'audioFadeIn',
      'audioFadeOut',
      'audioPitchSemitones',
      'audioPitchCents',
      'audioEqOutputGainDb',
      'audioEqLowGainDb',
      'audioEqLowMidGainDb',
      'audioEqMidGainDb',
      'audioEqHighMidGainDb',
      'audioEqHighGainDb',
    ]) ||
    hasEnabledField(item, [
      'audioEqBand1Enabled',
      'audioEqLowCutEnabled',
      'audioEqLowEnabled',
      'audioEqLowMidEnabled',
      'audioEqHighMidEnabled',
      'audioEqHighEnabled',
      'audioEqBand6Enabled',
      'audioEqHighCutEnabled',
    ])
  )
}

function hasEntries(entries: readonly unknown[] | undefined): boolean {
  return Boolean(entries?.length)
}

function hasEnabledTranscriptCaptions(item: VideoItem): boolean {
  return item.transcriptCaptions?.enabled === true
}

function hasVisualProcessing(item: VideoItem, width: number, height: number): boolean {
  const transform = {
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    flipHorizontal: false,
    flipVertical: false,
    ...item.transform,
  }
  const transformChanged = [
    nearlyEqual(transform.x, 0),
    nearlyEqual(transform.y, 0),
    nearlyEqual(transform.width, width, 0.5),
    nearlyEqual(transform.height, height, 0.5),
    nearlyEqual(transform.rotation, 0),
    nearlyEqual(transform.opacity, 1),
    nearlyEqual(transform.cornerRadius, 0),
  ].some((matchesDefault) => !matchesDefault)
  const flagsChanged = [
    transform.flipHorizontal,
    transform.flipVertical,
    item.crop,
    item.cornerPin,
    hasEnabledTranscriptCaptions(item),
  ].some(Boolean)
  const collectionsChanged = [
    hasEntries(item.effects),
    hasEntries(item.motionModifiers),
    hasEntries(item.motionLayers),
  ].some(Boolean)
  return [
    transformChanged,
    flagsChanged,
    collectionsChanged,
    hasNonZeroField(item, ['fadeIn', 'fadeOut']),
    ![undefined, 'normal'].includes(item.blendMode),
  ].some(Boolean)
}

function containerFromSource(source: MediaMetadata): ClientExportSettings['container'] | null {
  const extension = source.fileName.split('.').pop()?.toLowerCase()
  if (extension === 'mp4' || extension === 'mov' || extension === 'webm' || extension === 'mkv') {
    return extension
  }
  if (source.mimeType.includes('webm')) return 'webm'
  if (source.mimeType.includes('matroska')) return 'mkv'
  if (source.mimeType.includes('quicktime')) return 'mov'
  if (source.mimeType.includes('mp4')) return 'mp4'
  return null
}

function sameSourceTiming(video: VideoItem, audio: AudioItem): boolean {
  return [
    video.mediaId === audio.mediaId,
    video.from === audio.from,
    video.durationInFrames === audio.durationInFrames,
    (video.sourceStart ?? 0) === (audio.sourceStart ?? 0),
    video.sourceEnd === audio.sourceEnd,
    video.linkedGroupId !== undefined,
    video.linkedGroupId === audio.linkedGroupId,
  ].every(Boolean)
}

interface SmartCopyCandidate {
  video: VideoItem
  audio?: AudioItem
}

function getSmartCopyCandidate(items: TimelineItem[]): SmartCopyCandidate | null {
  const videos = items.filter((item): item is VideoItem => item.type === 'video')
  const audios = items.filter((item): item is AudioItem => item.type === 'audio')
  if (videos.length !== 1 || items.length > 2 || audios.length > 1) return null
  const video = videos[0]!
  const audio = audios[0]
  if (audio && !sameSourceTiming(video, audio)) return null
  return { video, audio }
}

function isFullSourceAtNormalSpeed(
  video: VideoItem,
  source: MediaMetadata,
  projectFps: number,
): boolean {
  const fullSourceFrames = video.sourceDuration ?? Math.round(source.duration * source.fps)
  const expectedTimelineFrames = Math.round((fullSourceFrames * projectFps) / source.fps)
  return [
    video.from === 0,
    (video.sourceStart ?? 0) === 0,
    Math.abs((video.sourceEnd ?? fullSourceFrames) - fullSourceFrames) <= 1,
    (video.trimStart ?? 0) === 0,
    (video.trimEnd ?? 0) === 0,
    (video.speed ?? 1) === 1,
    video.isReversed !== true,
    Math.abs(video.durationInFrames - expectedTimelineFrames) <= 1,
  ].every(Boolean)
}

interface CandidateTracks {
  video: TimelineTrack
  audio?: TimelineTrack
}

function getActiveCandidateTracks(
  tracks: TimelineTrack[],
  candidate: SmartCopyCandidate,
): CandidateTracks | null {
  const videoTrack = tracks.find((track) => track.id === candidate.video.trackId)
  const audioTrack = candidate.audio
    ? tracks.find((track) => track.id === candidate.audio?.trackId)
    : undefined
  if (!videoTrack?.visible || videoTrack.muted) return null
  if (candidate.audio && (!audioTrack || audioTrack.muted)) return null
  return { video: videoTrack, audio: audioTrack }
}

function hasTimelineVisualProcessing(context: SmartCopyContext, video: VideoItem): boolean {
  return (
    [context.transitions, context.keyframes].some((entries) => entries.length > 0) ||
    hasVisualProcessing(video, context.width, context.height)
  )
}

function hasTimelineAudioProcessing(
  context: SmartCopyContext,
  candidate: SmartCopyCandidate,
  tracks: CandidateTracks,
): boolean {
  const itemProcessing = [candidate.video, candidate.audio]
    .filter((item): item is VideoItem | AudioItem => item !== undefined)
    .some(hasItemAudioProcessing)
  const trackProcessing = [tracks.video, tracks.audio]
    .filter((track): track is TimelineTrack => track !== undefined)
    .some((track) => (track.volume ?? 0) !== 0 || hasEqProcessing(track.audioEq))
  return (
    candidate.video.embeddedAudioMuted === true ||
    itemProcessing ||
    trackProcessing ||
    (context.masterBusDb ?? 0) !== 0 ||
    hasEqProcessing(context.busAudioEq)
  )
}

function projectMatchesSource(context: SmartCopyContext, source: MediaMetadata): boolean {
  return [
    source.width === context.width,
    source.height === context.height,
    Math.abs(source.fps - context.fps) <= 0.01,
    context.settings.resolution.width === source.width,
    context.settings.resolution.height === source.height,
  ].every(Boolean)
}

function outputMatchesSource(context: SmartCopyContext, source: MediaMetadata): boolean {
  const requestedCodec =
    context.settings.codec === 'avc'
      ? 'h264'
      : context.settings.codec === 'hevc'
        ? 'h265'
        : context.settings.codec
  return [
    normalizeVideoCodec(source.codec) === requestedCodec,
    containerFromSource(source) === context.settings.container,
  ].every(Boolean)
}

export function assessSmartCopyEligibility(context: SmartCopyContext): SmartCopyAssessment {
  if (context.settings.smartCopy === false) return { eligible: false, reason: 'disabled' }
  if (context.settings.mode !== 'video') return { eligible: false, reason: 'not-video' }
  if (context.inPoint !== null || context.outPoint !== null) {
    return { eligible: false, reason: 'range' }
  }

  const candidate = getSmartCopyCandidate(context.items)
  if (!candidate) {
    return { eligible: false, reason: 'timeline-layout' }
  }

  const source = context.source ?? getMediaMetadataById(candidate.video.mediaId)
  if (!source || !source.mimeType.startsWith('video/')) {
    return { eligible: false, reason: 'source-unavailable', mediaId: candidate.video.mediaId }
  }

  if (!isFullSourceAtNormalSpeed(candidate.video, source, context.fps)) {
    return {
      eligible: false,
      reason: 'trimmed-or-retimed',
      mediaId: candidate.video.mediaId,
      source,
    }
  }

  const candidateTracks = getActiveCandidateTracks(context.tracks, candidate)
  if (!candidateTracks) {
    return { eligible: false, reason: 'audio-processing', mediaId: candidate.video.mediaId, source }
  }

  if (hasTimelineVisualProcessing(context, candidate.video)) {
    return {
      eligible: false,
      reason: 'visual-processing',
      mediaId: candidate.video.mediaId,
      source,
    }
  }

  if (hasTimelineAudioProcessing(context, candidate, candidateTracks)) {
    return { eligible: false, reason: 'audio-processing', mediaId: candidate.video.mediaId, source }
  }

  if (!projectMatchesSource(context, source)) {
    return { eligible: false, reason: 'project-mismatch', mediaId: candidate.video.mediaId, source }
  }

  if (!outputMatchesSource(context, source)) {
    return { eligible: false, reason: 'format-mismatch', mediaId: candidate.video.mediaId, source }
  }

  return { eligible: true, reason: 'eligible', mediaId: candidate.video.mediaId, source }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
}

export async function trySmartCopyExport(
  context: SmartCopyContext,
  signal: AbortSignal,
  onProgress: (progress: RenderProgress) => void,
): Promise<{ assessment: SmartCopyAssessment; result?: ClientRenderResult }> {
  const assessment = assessSmartCopyEligibility(context)
  if (!assessment.eligible || !assessment.mediaId || !assessment.source) return { assessment }

  throwIfAborted(signal)
  onProgress({ phase: 'preparing', progress: 25, message: 'Checking source for smart copy…' })
  const blob = await getMediaFileById(assessment.mediaId)
  throwIfAborted(signal)
  if (!blob) {
    return {
      assessment: { ...assessment, eligible: false, reason: 'source-unavailable' },
    }
  }

  onProgress({
    phase: 'finalizing',
    progress: 100,
    message: 'Copied original media without re-encoding',
  })
  return {
    assessment,
    result: {
      blob,
      mimeType: blob.type || assessment.source.mimeType,
      duration: assessment.source.duration,
      fileSize: blob.size,
    },
  }
}
