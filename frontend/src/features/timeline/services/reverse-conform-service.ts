import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  importCanvasRenderOrchestrator,
  type ClientExportSettings,
  type RenderProgress,
} from '../deps/export-contract'
import {
  mirrorBlobToWorkspace,
  readWorkspaceBlob,
} from '@/infrastructure/storage/workspace-fs/cache-mirror'
import { reverseConformFilePath } from '@/infrastructure/storage/workspace-fs/paths'
import { opfsService } from '../deps/media-library-service'
import { resolveMediaUrls } from '../deps/media-library-resolver'
import { useMediaLibraryStore } from '../deps/media-library-store'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'

export interface ReverseConformResult {
  itemId: string
  src: string
  path: string
  key: string
  quality: ReverseConformQuality
  usesProxy: boolean
  isSourceLevel: boolean
  sourceDuration?: number
  conformFps?: number
}

type ReverseConformQuality = 'preview' | 'full'

interface ReverseConformPrepareOptions {
  quality?: ReverseConformQuality
  useProxy?: boolean
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

interface SharedReverseConformJob {
  promise: Promise<{ blob: Blob; opfsPath: string }>
  progressListeners: Set<(progress: number) => void>
  lastProgress: number
  /** Cancels the underlying render once every waiter has aborted. */
  controller: AbortController
  /** Number of prepareVideo callers currently awaiting this job. */
  waiterCount: number
}

function emitSharedProgress(job: SharedReverseConformJob, value: number): void {
  job.lastProgress = value
  for (const listener of job.progressListeners) {
    listener(value)
  }
}

const inFlightByKey = new Map<string, SharedReverseConformJob>()
const objectUrlByPath = new Map<string, string>()

function toSafeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)
}

function getSourceStart(item: VideoItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0
}

function resolveSourceFps(item: VideoItem, timelineFps: number): number {
  if (item.sourceFps !== undefined && item.sourceFps > 0) return item.sourceFps
  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  if (media?.fps && media.fps > 0) return media.fps
  return timelineFps
}

function getSourceDuration(item: VideoItem, timelineFps: number): number | undefined {
  if (item.sourceDuration !== undefined && item.sourceDuration > 0) {
    return item.sourceDuration
  }

  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  if (!media || media.duration <= 0) {
    return item.sourceEnd !== undefined && item.sourceEnd > 0 ? item.sourceEnd : undefined
  }

  const sourceFps = item.sourceFps ?? (media.fps || timelineFps)
  return Math.round(media.duration * sourceFps)
}

function getConformDurationInFrames(item: VideoItem, timelineFps: number): number {
  if (Number.isFinite(item.durationInFrames) && item.durationInFrames > 0) {
    return Math.round(item.durationInFrames)
  }

  const sourceFps = resolveSourceFps(item, timelineFps)
  const speed = item.speed ?? 1
  const sourceStart = getSourceStart(item)

  if (item.sourceEnd !== undefined && item.sourceEnd > sourceStart) {
    if (sourceFps > 0 && speed > 0) {
      return Math.max(
        1,
        Math.round(((item.sourceEnd - sourceStart) * timelineFps) / (speed * sourceFps)),
      )
    }
  }

  const sourceDuration = getSourceDuration(item, timelineFps)
  if (sourceDuration !== undefined && sourceDuration > sourceStart) {
    if (sourceFps > 0 && speed > 0) {
      return Math.max(
        1,
        Math.round(((sourceDuration - sourceStart) * timelineFps) / (speed * sourceFps)),
      )
    }
  }

  return 0
}

function getSourceEnd(item: VideoItem, timelineFps: number, durationInFrames: number): number {
  const sourceFps = resolveSourceFps(item, timelineFps)
  const speed = item.speed ?? 1
  const sourceFramesNeeded = (durationInFrames * speed * sourceFps) / timelineFps
  const sourceStart = getSourceStart(item)
  const derivedSourceEnd = sourceStart + sourceFramesNeeded
  const sourceDuration = getSourceDuration(item, timelineFps)
  if (item.sourceEnd !== undefined && item.sourceEnd > sourceStart) {
    return item.sourceEnd
  }
  return sourceDuration !== undefined
    ? Math.min(sourceDuration, derivedSourceEnd)
    : derivedSourceEnd
}

function getSegmentReverseConformKey(
  item: VideoItem,
  timelineFps: number,
  quality: ReverseConformQuality,
  useProxy: boolean,
): string {
  const durationInFrames = getConformDurationInFrames(item, timelineFps)
  return toSafeKey(
    [
      'v2',
      quality,
      quality === 'preview' && useProxy ? 'proxy' : 'source',
      item.mediaId ?? 'legacy',
      item.mediaId ? `media:${item.mediaId}` : item.src,
      getSourceStart(item),
      getSourceEnd(item, timelineFps, durationInFrames),
      durationInFrames,
      item.sourceFps ?? timelineFps,
      timelineFps,
      item.speed ?? 1,
    ].join('__'),
  )
}

function getMediaFingerprint(item: VideoItem): string {
  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  if (media?.contentHash) return `hash-${media.contentHash}`
  if (media) {
    return [
      'file',
      media.fileSize,
      media.fileLastModified ?? 0,
      media.duration,
      media.width,
      media.height,
      media.fps,
    ].join('-')
  }
  return `legacy-${item.src ?? item.id}-${item.sourceDuration ?? 0}`
}

function getSourcePreviewKey(item: VideoItem, useProxy: boolean): string {
  const sourceFps = resolveSourceFps(item, 30)
  const sourceDuration = getSourceDuration(item, sourceFps) ?? 0
  const { width, height } = getConformDimensions(item, 'preview')
  return toSafeKey(
    [
      'v3-source',
      useProxy ? 'proxy' : 'source',
      item.mediaId ?? item.id,
      `${width}x${height}`,
      sourceDuration,
      sourceFps,
      getMediaFingerprint(item),
    ].join('__'),
  )
}

function getSharedObjectUrl(path: string, blob: Blob): string {
  const existing = objectUrlByPath.get(path)
  if (existing) return existing
  const url = URL.createObjectURL(new Blob([blob], { type: blob.type || 'video/mp4' }))
  objectUrlByPath.set(path, url)
  return url
}

async function saveBlobToOpfs(path: string, blob: Blob): Promise<void> {
  await opfsService.saveFile(path, await blob.arrayBuffer())
}

async function loadCachedBlob(pathSegments: string[], opfsPath: string): Promise<Blob | null> {
  const workspaceBlob = await readWorkspaceBlob(pathSegments)
  if (workspaceBlob) return workspaceBlob

  try {
    return await opfsService.getFileBlob(opfsPath)
  } catch {
    return null
  }
}

function getConformDimensions(
  item: VideoItem,
  quality: ReverseConformQuality,
): { width: number; height: number } {
  const sourceWidth = Math.max(2, item.sourceWidth ?? DEFAULT_PROJECT_WIDTH)
  const sourceHeight = Math.max(2, item.sourceHeight ?? DEFAULT_PROJECT_HEIGHT)
  if (quality === 'full') {
    return { width: sourceWidth, height: sourceHeight }
  }

  const maxWidth = 1280
  const maxHeight = 720
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(2, Math.round(sourceWidth * scale)),
    height: Math.max(2, Math.round(sourceHeight * scale)),
  }
}

function buildConformComposition(
  item: VideoItem,
  timelineFps: number,
  quality: ReverseConformQuality,
  sourceLevel: boolean,
): CompositionInputProps {
  const { width, height } = getConformDimensions(item, quality)
  const conformFps = sourceLevel ? resolveSourceFps(item, timelineFps) : timelineFps
  const sourceDuration = getSourceDuration(item, conformFps)
  const durationInFrames = sourceLevel
    ? Math.max(1, Math.round(sourceDuration ?? 0))
    : getConformDurationInFrames(item, timelineFps)
  const track: TimelineTrack = {
    id: 'reverse-conform-track',
    name: 'Reverse conform',
    order: 0,
    height: 80,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    items: [],
  }
  const conformItem: VideoItem = {
    ...item,
    id: `${item.id}:reverse-conform`,
    trackId: track.id,
    from: 0,
    durationInFrames,
    isReversed: true,
    reverseConformSrc: undefined,
    reverseConformPath: undefined,
    reverseConformPreviewSrc: undefined,
    reverseConformPreviewPath: undefined,
    reverseConformStatus: undefined,
    sourceStart: sourceLevel ? 0 : getSourceStart(item),
    sourceEnd: sourceLevel ? durationInFrames : getSourceEnd(item, timelineFps, durationInFrames),
    sourceDuration: sourceLevel ? durationInFrames : item.sourceDuration,
    sourceFps: sourceLevel ? conformFps : (item.sourceFps ?? timelineFps),
    speed: sourceLevel ? 1 : item.speed,
    transform: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
    },
    crop: undefined,
    effects: undefined,
    fadeIn: undefined,
    fadeOut: undefined,
  }
  track.items = [conformItem]

  return {
    fps: conformFps,
    width,
    height,
    durationInFrames,
    tracks: [track],
    transitions: [],
    backgroundColor: '#000000',
  }
}

function buildConformSettings(
  item: VideoItem,
  timelineFps: number,
  quality: ReverseConformQuality,
  fps: number = timelineFps,
): ClientExportSettings {
  const { width, height } = getConformDimensions(item, quality)
  return {
    mode: 'video',
    codec: 'avc',
    container: 'mp4',
    quality: quality === 'preview' ? 'medium' : 'high',
    resolution: { width, height },
    fps,
    videoBitrate:
      quality === 'preview'
        ? Math.max(2_500_000, width * height * fps * 0.08)
        : Math.max(12_000_000, width * height * fps * 0.16),
    audioBitrate: quality === 'preview' ? 128_000 : 192_000,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new DOMException('Reverse conform cancelled', 'AbortError')
}

function scaleRenderProgress(progress: RenderProgress): number {
  if (progress.phase === 'rendering') {
    return 0.15 + progress.progress * 0.008
  }
  if (progress.phase === 'finalizing') {
    return 0.95 + progress.progress * 0.0005
  }
  return progress.progress * 0.0015
}

export const reverseConformService = {
  async hydrateItem(item: TimelineItem): Promise<TimelineItem> {
    if (item.isReversed !== true || item.reverseConformStatus !== 'ready') {
      return item
    }

    const next = { ...item }

    if (item.type === 'video' && item.reverseConformPreviewPath) {
      const path = item.reverseConformPreviewPath
      const blob = await loadCachedBlob(path.split('/').filter(Boolean), path)
      next.reverseConformPreviewSrc = blob ? getSharedObjectUrl(path, blob) : undefined
    } else if (item.type === 'video' && item.reverseConformPreviewSrc?.startsWith('blob:')) {
      URL.revokeObjectURL(item.reverseConformPreviewSrc)
      next.reverseConformPreviewSrc = undefined
    }

    if (item.reverseConformPath) {
      const path = item.reverseConformPath
      const blob = await loadCachedBlob(path.split('/').filter(Boolean), path)
      next.reverseConformSrc = blob ? getSharedObjectUrl(path, blob) : undefined
    } else if (item.reverseConformSrc?.startsWith('blob:')) {
      URL.revokeObjectURL(item.reverseConformSrc)
      next.reverseConformSrc = undefined
    }

    if (!next.reverseConformPreviewSrc && !next.reverseConformSrc) {
      next.reverseConformStatus = undefined
    }

    return next
  },

  async hydrateItems(items: TimelineItem[]): Promise<TimelineItem[]> {
    return Promise.all(items.map((item) => reverseConformService.hydrateItem(item)))
  },

  async prepareVideo(
    item: VideoItem,
    timelineFps: number,
    options: ReverseConformPrepareOptions = {},
  ): Promise<ReverseConformResult> {
    const quality = options.quality ?? 'preview'
    const useProxy = quality === 'preview' && options.useProxy !== false
    const isSourceLevel = quality === 'preview'
    const sourceFps = resolveSourceFps(item, timelineFps)
    const sourceDuration = getSourceDuration(item, sourceFps)
    throwIfAborted(options.signal)
    const renderDuration = isSourceLevel
      ? sourceDuration
      : getConformDurationInFrames(item, timelineFps)
    if ((!item.src && !item.mediaId) || !renderDuration || renderDuration <= 0) {
      throw new Error('Cannot reverse an empty video clip')
    }
    const key = isSourceLevel
      ? getSourcePreviewKey(item, useProxy)
      : getSegmentReverseConformKey(item, timelineFps, quality, useProxy)
    const mediaId = item.mediaId ?? item.id
    const pathSegments = reverseConformFilePath(mediaId, key)
    const opfsPath = pathSegments.join('/')

    let sharedJob = inFlightByKey.get(key)
    if (sharedJob?.controller.signal.aborted) {
      // A fully-cancelled job is tearing down; wait for its finally() to
      // remove it from the map so we can start a fresh render below.
      await sharedJob.promise.catch(() => undefined)
      sharedJob = inFlightByKey.get(key)
    }
    if (!sharedJob) {
      const job: SharedReverseConformJob = {
        progressListeners: new Set<(progress: number) => void>(),
        lastProgress: 0,
        promise: undefined as unknown as Promise<{ blob: Blob; opfsPath: string }>,
        controller: new AbortController(),
        waiterCount: 0,
      }
      job.promise = (async () => {
        emitSharedProgress(job, 0)
        const cached = await loadCachedBlob(pathSegments, opfsPath)
        if (cached) {
          emitSharedProgress(job, 1)
          return { blob: cached, opfsPath }
        }
        const composition = buildConformComposition(item, timelineFps, quality, isSourceLevel)
        composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy })
        const resolvedItem = composition.tracks[0]?.items[0]
        if (!resolvedItem || resolvedItem.type !== 'video' || !resolvedItem.src) {
          throw new Error('Could not resolve the source media for reverse.')
        }
        const { renderComposition } = await importCanvasRenderOrchestrator()
        const result = await renderComposition({
          composition,
          settings: buildConformSettings(
            item,
            timelineFps,
            quality,
            isSourceLevel ? sourceFps : timelineFps,
          ),
          signal: job.controller.signal,
          onProgress: (progress: RenderProgress) => {
            emitSharedProgress(job, Math.max(0, Math.min(0.99, scaleRenderProgress(progress))))
          },
        })
        await saveBlobToOpfs(opfsPath, result.blob)
        await mirrorBlobToWorkspace(pathSegments, result.blob)
        emitSharedProgress(job, 1)
        return { blob: result.blob, opfsPath }
      })().finally(() => {
        inFlightByKey.delete(key)
      })
      inFlightByKey.set(key, job)
      sharedJob = job
    }

    const onProgress = options.onProgress
    if (onProgress) {
      sharedJob.progressListeners.add(onProgress)
      onProgress(sharedJob.lastProgress)
    }
    sharedJob.waiterCount += 1

    return new Promise<ReverseConformResult>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        sharedJob.waiterCount -= 1
        if (onProgress) {
          sharedJob.progressListeners.delete(onProgress)
        }
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort)
        }
      }
      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        // Last waiter gone — stop the shared render instead of letting it
        // run to completion as a ghost job nobody will consume.
        if (sharedJob.waiterCount <= 0) {
          sharedJob.controller.abort()
        }
        reject(new DOMException('Reverse conform cancelled', 'AbortError'))
      }
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort()
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      sharedJob.promise.then(
        ({ blob, opfsPath: path }) => {
          if (settled) return
          settled = true
          cleanup()
          resolve({
            itemId: item.id,
            src: getSharedObjectUrl(path, blob),
            path,
            key,
            quality,
            usesProxy: useProxy,
            isSourceLevel,
            sourceDuration: isSourceLevel ? sourceDuration : undefined,
            conformFps: isSourceLevel ? sourceFps : undefined,
          })
        },
        (error) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        },
      )
    })
  },
}
