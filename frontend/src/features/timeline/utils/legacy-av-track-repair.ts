import type { ItemKeyframes, PropertyKeyframes } from '@/types/keyframe'
import type {
  AudioItem,
  CompositionItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'
import { canLinkItems } from './linked-items'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { getTrackKind, type TrackKind } from './classic-tracks'
import { DEFAULT_TRACK_HEIGHT } from '../constants'

interface LegacyTimelineData {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
}

interface LegacyAvRepairParams extends LegacyTimelineData {
  fps: number
  videoHasAudioByMediaId: Record<string, boolean | undefined>
  createId?: () => string
}

export interface LegacyAvRepairResult extends LegacyTimelineData {
  changed: boolean
}

interface ExistingAudioPair {
  video: VideoItem | CompositionItem
  audio: AudioItem
  videoLaneIndex: number
}

function isAudioPairableVisualItem(item: TimelineItem): item is VideoItem | CompositionItem {
  return item.type === 'video' || item.type === 'composition'
}

function sortTracksByOrder(tracks: TimelineTrack[]): TimelineTrack[] {
  return [...tracks].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
}

function getVideoLaneIndex(trackIndex: number, totalVideoTracks: number): number {
  return Math.max(0, totalVideoTracks - trackIndex - 1)
}

function isVisualItem(item: TimelineItem): boolean {
  return item.type !== 'audio'
}

function inferTrackKinds(
  sortedTracks: TimelineTrack[],
  itemsByTrackId: Map<string, TimelineItem[]>,
): Map<string, TrackKind> {
  const preliminaryKinds = sortedTracks.map((track) => {
    const trackItems = itemsByTrackId.get(track.id) ?? []
    const hasVisualItems = trackItems.some(isVisualItem)
    const hasAudioItems = trackItems.some((item) => item.type === 'audio')

    if (hasVisualItems) return 'video' as const
    if (hasAudioItems) return 'audio' as const
    return getTrackKind(track)
  })

  const firstAudioIndex = preliminaryKinds.findIndex((kind) => kind === 'audio')
  const fallbackKind: TrackKind = firstAudioIndex === 0 ? 'audio' : 'video'
  const kindsByTrackId = new Map<string, TrackKind>()

  sortedTracks.forEach((track, index) => {
    const kind =
      preliminaryKinds[index] ??
      (firstAudioIndex !== -1 && index >= firstAudioIndex ? 'audio' : fallbackKind)
    kindsByTrackId.set(track.id, kind)
  })

  return kindsByTrackId
}

export function needsLegacyAvTrackLayoutRepair(params: {
  tracks: TimelineTrack[]
  items: TimelineItem[]
}): boolean {
  const { tracks, items } = params
  if (tracks.length === 0 || items.length === 0) {
    return false
  }

  const trackById = new Map(tracks.map((track) => [track.id, track]))
  return items.some((item) => {
    const track = trackById.get(item.trackId)
    if (!track) {
      return true
    }

    const trackKind = getTrackKind(track)
    if (trackKind === null) {
      return true
    }

    return item.type === 'audio' ? trackKind !== 'audio' : trackKind !== 'video'
  })
}

function buildTrackClone(params: {
  sourceTrack: TimelineTrack | null
  kind: TrackKind
  name: string
  order: number
  usedTrackIds: Set<string>
  createId: () => string
}): TimelineTrack {
  const { sourceTrack, kind, name, order, usedTrackIds, createId } = params
  const nextId =
    sourceTrack && !usedTrackIds.has(sourceTrack.id) ? sourceTrack.id : `track-${createId()}`
  usedTrackIds.add(nextId)

  return {
    id: nextId,
    name,
    kind,
    height: sourceTrack?.height ?? DEFAULT_TRACK_HEIGHT,
    locked: sourceTrack?.locked ?? false,
    syncLock: sourceTrack?.syncLock ?? true,
    visible: sourceTrack?.visible ?? true,
    muted: sourceTrack?.muted ?? false,
    solo: sourceTrack?.solo ?? false,
    volume: sourceTrack?.volume ?? 0,
    color: sourceTrack?.color,
    order,
    items: [],
  }
}

function findExistingAudioPairs(params: {
  items: TimelineItem[]
  videoTrackLaneIndex: Map<string, number>
  trackOrderMap: Map<string, number>
}): ExistingAudioPair[] {
  const sortedVideos = params.items
    .filter((item): item is VideoItem | CompositionItem => isAudioPairableVisualItem(item))
    .toSorted((left, right) => {
      const leftTrackOrder = params.trackOrderMap.get(left.trackId) ?? 0
      const rightTrackOrder = params.trackOrderMap.get(right.trackId) ?? 0
      if (leftTrackOrder !== rightTrackOrder) return leftTrackOrder - rightTrackOrder
      if (left.from !== right.from) return left.from - right.from
      return left.id.localeCompare(right.id)
    })
  const audioItems = params.items.filter((item): item is AudioItem => item.type === 'audio')
  const usedAudioIds = new Set<string>()
  const pairs: ExistingAudioPair[] = []

  for (const video of sortedVideos) {
    const videoLaneIndex = params.videoTrackLaneIndex.get(video.trackId)
    if (videoLaneIndex === undefined) continue

    const linkedAudio = getLinkedAudioCompanion(params.items, video)
    let audioCompanion = linkedAudio && !usedAudioIds.has(linkedAudio.id) ? linkedAudio : null

    if (!audioCompanion && video.type === 'video') {
      audioCompanion =
        audioItems.find((audio) => !usedAudioIds.has(audio.id) && canLinkItems([video, audio])) ??
        null
    }

    if (!audioCompanion) continue

    usedAudioIds.add(audioCompanion.id)
    pairs.push({ video, audio: audioCompanion, videoLaneIndex })
  }

  return pairs
}

export function cloneVolumeKeyframes(
  source: ItemKeyframes | undefined,
  itemId: string,
): ItemKeyframes | null {
  const volumeProperty = source?.properties.find((property) => property.property === 'volume')
  if (!volumeProperty || volumeProperty.keyframes.length === 0) {
    return null
  }

  const clonedProperty: PropertyKeyframes = {
    property: 'volume',
    keyframes: volumeProperty.keyframes.map((keyframe) => ({ ...keyframe })),
  }

  return {
    itemId,
    properties: [clonedProperty],
  }
}

export function makeGeneratedAudioItem(
  video: VideoItem,
  trackId: string,
  createId: () => string,
): AudioItem {
  return {
    id: createId(),
    type: 'audio',
    trackId,
    from: video.from,
    durationInFrames: video.durationInFrames,
    label: video.label,
    mediaId: video.mediaId,
    originId: video.originId,
    linkedGroupId: video.linkedGroupId,
    src: video.src,
    trimStart: video.trimStart,
    trimEnd: video.trimEnd,
    sourceStart: video.sourceStart,
    sourceEnd: video.sourceEnd,
    sourceDuration: video.sourceDuration,
    sourceFps: video.sourceFps,
    speed: video.speed,
    volume: video.volume,
    audioFadeIn: video.audioFadeIn,
    audioFadeOut: video.audioFadeOut,
    audioFadeInCurve: video.audioFadeInCurve,
    audioFadeOutCurve: video.audioFadeOutCurve,
    audioFadeInCurveX: video.audioFadeInCurveX,
    audioFadeOutCurveX: video.audioFadeOutCurveX,
    audioPitchSemitones: video.audioPitchSemitones,
    audioPitchCents: video.audioPitchCents,
    audioEqEnabled: video.audioEqEnabled,
    audioEqOutputGainDb: video.audioEqOutputGainDb,
    audioEqBand1Enabled: video.audioEqBand1Enabled,
    audioEqBand1Type: video.audioEqBand1Type,
    audioEqBand1FrequencyHz: video.audioEqBand1FrequencyHz,
    audioEqBand1GainDb: video.audioEqBand1GainDb,
    audioEqBand1Q: video.audioEqBand1Q,
    audioEqBand1SlopeDbPerOct: video.audioEqBand1SlopeDbPerOct,
    audioEqLowCutEnabled: video.audioEqLowCutEnabled,
    audioEqLowCutFrequencyHz: video.audioEqLowCutFrequencyHz,
    audioEqLowCutSlopeDbPerOct: video.audioEqLowCutSlopeDbPerOct,
    audioEqLowEnabled: video.audioEqLowEnabled,
    audioEqLowType: video.audioEqLowType,
    audioEqLowGainDb: video.audioEqLowGainDb,
    audioEqLowFrequencyHz: video.audioEqLowFrequencyHz,
    audioEqLowQ: video.audioEqLowQ,
    audioEqLowMidEnabled: video.audioEqLowMidEnabled,
    audioEqLowMidType: video.audioEqLowMidType,
    audioEqLowMidGainDb: video.audioEqLowMidGainDb,
    audioEqLowMidFrequencyHz: video.audioEqLowMidFrequencyHz,
    audioEqLowMidQ: video.audioEqLowMidQ,
    audioEqMidGainDb: video.audioEqMidGainDb,
    audioEqHighMidEnabled: video.audioEqHighMidEnabled,
    audioEqHighMidType: video.audioEqHighMidType,
    audioEqHighMidGainDb: video.audioEqHighMidGainDb,
    audioEqHighMidFrequencyHz: video.audioEqHighMidFrequencyHz,
    audioEqHighMidQ: video.audioEqHighMidQ,
    audioEqHighEnabled: video.audioEqHighEnabled,
    audioEqHighType: video.audioEqHighType,
    audioEqHighGainDb: video.audioEqHighGainDb,
    audioEqHighFrequencyHz: video.audioEqHighFrequencyHz,
    audioEqHighQ: video.audioEqHighQ,
    audioEqBand6Enabled: video.audioEqBand6Enabled,
    audioEqBand6Type: video.audioEqBand6Type,
    audioEqBand6FrequencyHz: video.audioEqBand6FrequencyHz,
    audioEqBand6GainDb: video.audioEqBand6GainDb,
    audioEqBand6Q: video.audioEqBand6Q,
    audioEqBand6SlopeDbPerOct: video.audioEqBand6SlopeDbPerOct,
    audioEqHighCutEnabled: video.audioEqHighCutEnabled,
    audioEqHighCutFrequencyHz: video.audioEqHighCutFrequencyHz,
    audioEqHighCutSlopeDbPerOct: video.audioEqHighCutSlopeDbPerOct,
    offset: video.offset,
  }
}

function groupItemsByTrackId(items: TimelineItem[]): Map<string, TimelineItem[]> {
  const itemsByTrackId = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const existing = itemsByTrackId.get(item.trackId)
    if (existing) {
      existing.push(item)
    } else {
      itemsByTrackId.set(item.trackId, [item])
    }
  }
  return itemsByTrackId
}

function resolveVideoLaneMaps(
  sortedTracks: TimelineTrack[],
  kindsByTrackId: Map<string, TrackKind>,
): {
  videoTrackSourceIds: string[]
  audioTrackSourceIds: string[]
  videoTrackLaneIndex: Map<string, number>
  videoTrackSourceIdsByLane: string[]
  trackOrderMap: Map<string, number>
} {
  const videoTrackSourceIds = sortedTracks
    .filter((track) => kindsByTrackId.get(track.id) === 'video')
    .map((track) => track.id)
  const audioTrackSourceIds = sortedTracks
    .filter((track) => kindsByTrackId.get(track.id) === 'audio')
    .map((track) => track.id)
  const videoTrackLaneIndex = new Map(
    videoTrackSourceIds.map((trackId, index) => [
      trackId,
      getVideoLaneIndex(index, videoTrackSourceIds.length),
    ]),
  )
  return {
    videoTrackSourceIds,
    audioTrackSourceIds,
    videoTrackLaneIndex,
    videoTrackSourceIdsByLane: [...videoTrackSourceIds].reverse(),
    trackOrderMap: new Map(sortedTracks.map((track) => [track.id, track.order ?? 0])),
  }
}

function collectPairedAudioLaneIndices(
  existingAudioPairs: ExistingAudioPair[],
  items: TimelineItem[],
  videoTrackLaneIndex: Map<string, number>,
  videoHasAudioByMediaId: Record<string, boolean | undefined>,
): Set<number> {
  const pairedAudioLaneIndices = new Set<number>(
    existingAudioPairs.map((pair) => pair.videoLaneIndex),
  )
  for (const item of items) {
    if (item.type !== 'video') continue
    if (!item.mediaId || videoHasAudioByMediaId[item.mediaId] !== true) continue
    const laneIndex = videoTrackLaneIndex.get(item.trackId)
    if (laneIndex !== undefined) {
      pairedAudioLaneIndices.add(laneIndex)
    }
  }
  return pairedAudioLaneIndices
}

function assignPairedAudioSources(options: {
  pairedAudioLaneOrder: number[]
  pairedAudioTrackSourceIdByLane: Map<number, string>
  emptyAudioTrackSourceIds: string[]
  videoTrackSourceIdsByLane: string[]
}): { pairedAudioSourceIds: string[]; consumedAudioSourceIds: Set<string> } {
  const {
    pairedAudioLaneOrder,
    pairedAudioTrackSourceIdByLane,
    emptyAudioTrackSourceIds,
    videoTrackSourceIdsByLane,
  } = options
  const pairedAudioSourceIds: string[] = []
  const consumedAudioSourceIds = new Set<string>()
  for (const laneIndex of pairedAudioLaneOrder) {
    const sourceTrackId =
      pairedAudioTrackSourceIdByLane.get(laneIndex) ??
      emptyAudioTrackSourceIds.shift() ??
      videoTrackSourceIdsByLane[laneIndex] ??
      null
    if (sourceTrackId) {
      pairedAudioSourceIds.push(sourceTrackId)
      consumedAudioSourceIds.add(sourceTrackId)
    } else {
      pairedAudioSourceIds.push(
        videoTrackSourceIdsByLane[laneIndex] ?? `generated-audio-source-${laneIndex}`,
      )
    }
  }
  return { pairedAudioSourceIds, consumedAudioSourceIds }
}

function collectStandaloneAudioTrackIds(
  items: TimelineItem[],
  pairedAudioIds: Set<string>,
  trackOrderMap: Map<string, number>,
): string[] {
  return items
    .filter((item): item is AudioItem => item.type === 'audio' && !pairedAudioIds.has(item.id))
    .toSorted((left, right) => {
      const leftOrder = trackOrderMap.get(left.trackId) ?? 0
      const rightOrder = trackOrderMap.get(right.trackId) ?? 0
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      if (left.from !== right.from) return left.from - right.from
      return left.id.localeCompare(right.id)
    })
    .map((item) => item.trackId)
    .filter((trackId, index, array) => array.indexOf(trackId) === index)
}

function rebuildRepairedTracks(options: {
  videoTrackSourceIds: string[]
  videoTrackLaneIndex: Map<string, number>
  pairedAudioSourceIds: string[]
  pairedAudioLaneOrder: number[]
  standaloneAudioSourceIds: string[]
  pairedAudioLaneCount: number
  trackById: Map<string, TimelineTrack>
  createId: () => string
}): {
  repairedTracks: TimelineTrack[]
  repairedVideoTrackIdsByLane: Map<number, string>
  repairedAudioTrackIdsByLane: Map<number, string>
  repairedStandaloneAudioTrackIdsBySource: Map<string, string>
} {
  const {
    videoTrackSourceIds,
    videoTrackLaneIndex,
    pairedAudioSourceIds,
    pairedAudioLaneOrder,
    standaloneAudioSourceIds,
    pairedAudioLaneCount,
    trackById,
    createId,
  } = options
  const usedTrackIds = new Set<string>()
  const repairedTracks: TimelineTrack[] = []
  const repairedVideoTrackIdsByLane = new Map<number, string>()
  const repairedAudioTrackIdsByLane = new Map<number, string>()
  const repairedStandaloneAudioTrackIdsBySource = new Map<string, string>()

  videoTrackSourceIds.forEach((sourceTrackId, trackIndex) => {
    const laneIndex = videoTrackLaneIndex.get(sourceTrackId) ?? 0
    const nextTrack = buildTrackClone({
      sourceTrack: trackById.get(sourceTrackId) ?? null,
      kind: 'video',
      name: `V${laneIndex + 1}`,
      order: trackIndex,
      usedTrackIds,
      createId,
    })
    repairedTracks.push(nextTrack)
    repairedVideoTrackIdsByLane.set(laneIndex, nextTrack.id)
  })

  pairedAudioSourceIds.forEach((sourceTrackId, pairedLaneIndex) => {
    const laneIndex = pairedAudioLaneOrder[pairedLaneIndex] ?? pairedLaneIndex
    const nextTrack = buildTrackClone({
      sourceTrack: trackById.get(sourceTrackId) ?? null,
      kind: 'audio',
      name: `A${pairedLaneIndex + 1}`,
      order: videoTrackSourceIds.length + pairedLaneIndex,
      usedTrackIds,
      createId,
    })
    repairedTracks.push(nextTrack)
    repairedAudioTrackIdsByLane.set(laneIndex, nextTrack.id)
  })

  standaloneAudioSourceIds.forEach((sourceTrackId, index) => {
    const laneNumber = pairedAudioLaneCount + index + 1
    const nextTrack = buildTrackClone({
      sourceTrack: trackById.get(sourceTrackId) ?? null,
      kind: 'audio',
      name: `A${laneNumber}`,
      order: videoTrackSourceIds.length + pairedAudioLaneCount + index,
      usedTrackIds,
      createId,
    })
    repairedTracks.push(nextTrack)
    repairedStandaloneAudioTrackIdsBySource.set(sourceTrackId, nextTrack.id)
  })

  return {
    repairedTracks,
    repairedVideoTrackIdsByLane,
    repairedAudioTrackIdsByLane,
    repairedStandaloneAudioTrackIdsBySource,
  }
}

function deepCloneKeyframes(keyframes: ItemKeyframes[]): ItemKeyframes[] {
  return keyframes.map((entry) => ({
    ...entry,
    properties: entry.properties.map((property) => ({
      ...property,
      keyframes: property.keyframes.map((keyframe) => ({ ...keyframe })),
    })),
  }))
}

interface AvItemRepairContext {
  existingAudioPairs: ExistingAudioPair[]
  existingAudioByVideoId: Map<string, AudioItem>
  repairedAudioTrackIdsByLane: Map<number, string>
  repairedVideoTrackIdsByLane: Map<number, string>
  repairedStandaloneAudioTrackIdsBySource: Map<string, string>
  standaloneAudioTrackIndexFallback: string | undefined
  videoTrackLaneIndex: Map<string, number>
  videoHasAudioByMediaId: Record<string, boolean | undefined>
  keyframesByItemId: Map<string, ItemKeyframes>
  repairedItems: TimelineItem[]
  repairedKeyframes: ItemKeyframes[]
  generatedAudioItems: AudioItem[]
  generatedVideoGroupIds: Map<string, string>
  createId: () => string
}

function repairPairedAudioItem(
  originalItem: AudioItem,
  pair: ExistingAudioPair,
  ctx: AvItemRepairContext,
): void {
  const repairedTrackId =
    ctx.repairedAudioTrackIdsByLane.get(pair.videoLaneIndex) ?? originalItem.trackId
  const linkedGroupId =
    ctx.generatedVideoGroupIds.get(pair.video.id) ??
    pair.video.linkedGroupId ??
    pair.audio.linkedGroupId ??
    ctx.createId()
  ctx.generatedVideoGroupIds.set(pair.video.id, linkedGroupId)
  const repairedAudio =
    pair.audio.trackId === repairedTrackId && pair.audio.linkedGroupId === linkedGroupId
      ? pair.audio
      : { ...pair.audio, trackId: repairedTrackId, linkedGroupId }

  const existingAudioVolumeKeyframes = ctx.keyframesByItemId
    .get(originalItem.id)
    ?.properties.some((property) => property.property === 'volume')
  if (!existingAudioVolumeKeyframes) {
    const clonedVolumeKeyframes = cloneVolumeKeyframes(
      ctx.keyframesByItemId.get(pair.video.id),
      originalItem.id,
    )
    if (clonedVolumeKeyframes) {
      ctx.repairedKeyframes.push(clonedVolumeKeyframes)
    }
  }

  ctx.repairedItems.push(repairedAudio)
}

function repairStandaloneAudioItem(originalItem: AudioItem, ctx: AvItemRepairContext): void {
  const repairedTrackId =
    ctx.repairedStandaloneAudioTrackIdsBySource.get(originalItem.trackId) ??
    ctx.standaloneAudioTrackIndexFallback
  ctx.repairedItems.push(
    repairedTrackId && originalItem.trackId !== repairedTrackId
      ? { ...originalItem, trackId: repairedTrackId }
      : originalItem,
  )
}

function linkVideoToExistingAudio(
  repairedVideo: VideoItem,
  originalItem: VideoItem,
  existingAudio: AudioItem,
  ctx: AvItemRepairContext,
): VideoItem {
  const linkedGroupId =
    ctx.generatedVideoGroupIds.get(originalItem.id) ??
    repairedVideo.linkedGroupId ??
    existingAudio.linkedGroupId ??
    ctx.createId()
  if (repairedVideo.linkedGroupId !== linkedGroupId) {
    repairedVideo = { ...repairedVideo, linkedGroupId }
  }
  ctx.generatedVideoGroupIds.set(originalItem.id, linkedGroupId)
  return repairedVideo
}

function generateMissingVideoAudio(
  repairedVideo: VideoItem,
  originalItem: VideoItem,
  laneIndex: number,
  ctx: AvItemRepairContext,
): VideoItem {
  const audioTrackId = ctx.repairedAudioTrackIdsByLane.get(laneIndex)
  if (!audioTrackId) return repairedVideo
  const linkedGroupId = repairedVideo.linkedGroupId ?? ctx.createId()
  if (repairedVideo.linkedGroupId !== linkedGroupId) {
    repairedVideo = { ...repairedVideo, linkedGroupId }
  }

  const generatedAudio = makeGeneratedAudioItem(repairedVideo, audioTrackId, ctx.createId)
  ctx.generatedAudioItems.push(generatedAudio)

  const clonedVolumeKeyframes = cloneVolumeKeyframes(
    ctx.keyframesByItemId.get(originalItem.id),
    generatedAudio.id,
  )
  if (clonedVolumeKeyframes) {
    ctx.repairedKeyframes.push(clonedVolumeKeyframes)
  }
  return repairedVideo
}

function repairVideoItem(originalItem: VideoItem, ctx: AvItemRepairContext): void {
  const laneIndex = ctx.videoTrackLaneIndex.get(originalItem.trackId) ?? 0
  const repairedTrackId = ctx.repairedVideoTrackIdsByLane.get(laneIndex) ?? originalItem.trackId
  const existingAudio = ctx.existingAudioByVideoId.get(originalItem.id)

  let repairedVideo: VideoItem =
    repairedTrackId !== originalItem.trackId
      ? { ...originalItem, trackId: repairedTrackId }
      : originalItem

  if (existingAudio) {
    repairedVideo = linkVideoToExistingAudio(repairedVideo, originalItem, existingAudio, ctx)
  }

  if (
    !existingAudio &&
    originalItem.mediaId &&
    ctx.videoHasAudioByMediaId[originalItem.mediaId] === true
  ) {
    repairedVideo = generateMissingVideoAudio(repairedVideo, originalItem, laneIndex, ctx)
  }

  ctx.repairedItems.push(repairedVideo)
}

function seedPairedAudioTrackSources(existingAudioPairs: ExistingAudioPair[]): Map<number, string> {
  const pairedAudioTrackSourceIdByLane = new Map<number, string>()
  for (const pair of existingAudioPairs) {
    if (!pairedAudioTrackSourceIdByLane.has(pair.videoLaneIndex)) {
      pairedAudioTrackSourceIdByLane.set(pair.videoLaneIndex, pair.audio.trackId)
    }
  }
  return pairedAudioTrackSourceIdByLane
}

function repairOtherVisualItem(originalItem: TimelineItem, itemCtx: AvItemRepairContext): void {
  const laneIndex = itemCtx.videoTrackLaneIndex.get(originalItem.trackId) ?? 0
  const repairedTrackId = itemCtx.repairedVideoTrackIdsByLane.get(laneIndex) ?? originalItem.trackId
  itemCtx.repairedItems.push(
    repairedTrackId !== originalItem.trackId
      ? { ...originalItem, trackId: repairedTrackId }
      : originalItem,
  )
}

function repairLegacyItems(
  items: TimelineItem[],
  existingAudioPairs: ExistingAudioPair[],
  itemCtx: AvItemRepairContext,
): void {
  for (const originalItem of items) {
    if (originalItem.type === 'audio') {
      const pair = existingAudioPairs.find((candidate) => candidate.audio.id === originalItem.id)
      if (pair) {
        repairPairedAudioItem(originalItem, pair, itemCtx)
      } else {
        repairStandaloneAudioItem(originalItem, itemCtx)
      }
      continue
    }

    if (originalItem.type === 'video') {
      repairVideoItem(originalItem, itemCtx)
      continue
    }

    if (isVisualItem(originalItem)) {
      repairOtherVisualItem(originalItem, itemCtx)
      continue
    }

    itemCtx.repairedItems.push(originalItem)
  }
}

function haveRepairOutputsChanged(
  params: LegacyAvRepairParams,
  repairedTracks: TimelineTrack[],
  repairedItems: TimelineItem[],
  repairedKeyframes: ItemKeyframes[],
): boolean {
  return (
    JSON.stringify({
      tracks: params.tracks,
      items: params.items,
      keyframes: params.keyframes,
    }) !==
    JSON.stringify({
      tracks: repairedTracks,
      items: repairedItems,
      keyframes: repairedKeyframes,
    })
  )
}

export function repairLegacyAvTrackLayout(params: LegacyAvRepairParams): LegacyAvRepairResult {
  const createId = params.createId ?? (() => crypto.randomUUID())
  const sortedTracks = sortTracksByOrder(params.tracks)
  const trackById = new Map(sortedTracks.map((track) => [track.id, track]))
  const itemsByTrackId = groupItemsByTrackId(params.items)

  const kindsByTrackId = inferTrackKinds(sortedTracks, itemsByTrackId)
  const {
    videoTrackSourceIds,
    audioTrackSourceIds,
    videoTrackLaneIndex,
    videoTrackSourceIdsByLane,
    trackOrderMap,
  } = resolveVideoLaneMaps(sortedTracks, kindsByTrackId)

  const existingAudioPairs = findExistingAudioPairs({
    items: params.items,
    videoTrackLaneIndex,
    trackOrderMap,
  })
  const existingAudioByVideoId = new Map(
    existingAudioPairs.map((pair) => [pair.video.id, pair.audio]),
  )
  const pairedAudioTrackSourceIdByLane = seedPairedAudioTrackSources(existingAudioPairs)

  const pairedAudioLaneIndices = collectPairedAudioLaneIndices(
    existingAudioPairs,
    params.items,
    videoTrackLaneIndex,
    params.videoHasAudioByMediaId,
  )

  const pairedAudioLaneOrder = [...pairedAudioLaneIndices].sort((left, right) => left - right)
  const pairedAudioLaneCount = pairedAudioLaneOrder.length
  const emptyAudioTrackSourceIds = audioTrackSourceIds.filter(
    (trackId) => (itemsByTrackId.get(trackId)?.length ?? 0) === 0,
  )
  const { pairedAudioSourceIds, consumedAudioSourceIds } = assignPairedAudioSources({
    pairedAudioLaneOrder,
    pairedAudioTrackSourceIdByLane,
    emptyAudioTrackSourceIds,
    videoTrackSourceIdsByLane,
  })

  const pairedAudioIds = new Set(existingAudioPairs.map((pair) => pair.audio.id))
  const standaloneAudioTrackIds = collectStandaloneAudioTrackIds(
    params.items,
    pairedAudioIds,
    trackOrderMap,
  )

  const remainingAudioTrackSourceIds = audioTrackSourceIds.filter(
    (trackId) => !consumedAudioSourceIds.has(trackId),
  )
  const standaloneAudioSourceIds = [
    ...standaloneAudioTrackIds,
    ...remainingAudioTrackSourceIds.filter((trackId) => !standaloneAudioTrackIds.includes(trackId)),
  ]

  const {
    repairedTracks,
    repairedVideoTrackIdsByLane,
    repairedAudioTrackIdsByLane,
    repairedStandaloneAudioTrackIdsBySource,
  } = rebuildRepairedTracks({
    videoTrackSourceIds,
    videoTrackLaneIndex,
    pairedAudioSourceIds,
    pairedAudioLaneOrder,
    standaloneAudioSourceIds,
    pairedAudioLaneCount,
    trackById,
    createId,
  })

  const keyframesByItemId = new Map(params.keyframes.map((entry) => [entry.itemId, entry]))
  const repairedKeyframes = deepCloneKeyframes(params.keyframes)
  const repairedItems: TimelineItem[] = []
  const generatedAudioItems: AudioItem[] = []
  const generatedVideoGroupIds = new Map<string, string>()

  const standaloneAudioTrackIndexFallback = standaloneAudioSourceIds[0]
    ? repairedStandaloneAudioTrackIdsBySource.get(standaloneAudioSourceIds[0])
    : repairedAudioTrackIdsByLane.get(0)

  const itemCtx: AvItemRepairContext = {
    existingAudioPairs,
    existingAudioByVideoId,
    repairedAudioTrackIdsByLane,
    repairedVideoTrackIdsByLane,
    repairedStandaloneAudioTrackIdsBySource,
    standaloneAudioTrackIndexFallback,
    videoTrackLaneIndex,
    videoHasAudioByMediaId: params.videoHasAudioByMediaId,
    keyframesByItemId,
    repairedItems,
    repairedKeyframes,
    generatedAudioItems,
    generatedVideoGroupIds,
    createId,
  }

  repairLegacyItems(params.items, existingAudioPairs, itemCtx)

  repairedItems.push(...generatedAudioItems)

  return {
    tracks: repairedTracks,
    items: repairedItems,
    keyframes: repairedKeyframes,
    changed: haveRepairOutputsChanged(params, repairedTracks, repairedItems, repairedKeyframes),
  }
}
