import { useEffect, useMemo, useRef } from 'react'
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager'
import { backgroundBatchPreseek } from '@/features/preview/utils/decoder-prewarm'
import type { TimelineItem } from '@/types/timeline'
import { resolveMediaUrl, resolveProxyUrl } from '../utils/media-resolver'
import { buildSubCompositionInput, useCompositionsStore } from '../deps/timeline-contract'
import { collectVisibleTrackVideoSourceTimesBySrc } from '../utils/render-pump-preseek'
import { collectEditOverlayDirectionalPrewarmTimes } from '../utils/edit-overlay-prewarm-plan'
import {
  getEditOverlayFrameCacheKey,
  hasCachedEditOverlayFrame,
} from '../utils/edit-overlay-frame-cache'
import { getCachedPredecodedBitmap } from '../utils/decoder-prewarm'

const CACHE_TIME_QUANTUM = 1 / 60
const EDIT_OVERLAY_PREWARM_MAX_TIMESTAMPS = 6
const MEDIA_SOURCE_KEY_PREFIX = 'media-id:'

interface PanelPrewarmTarget {
  item: TimelineItem | null
  sourceTime?: number
  sourceFrame?: number
}

interface PrewarmRequest {
  src: string
  targetTime: number
  panelKey: string
  fps: number
  duration: number
  exactOnly?: boolean
}

async function resolvePanelSource(sourceKey: string): Promise<string | null> {
  if (!sourceKey.startsWith(MEDIA_SOURCE_KEY_PREFIX)) return sourceKey
  const mediaId = sourceKey.slice(MEDIA_SOURCE_KEY_PREFIX.length)
  return resolveMediaSource(mediaId)
}

async function resolveMediaSource(mediaId: string): Promise<string | null> {
  const proxyUrl = resolveProxyUrl(mediaId)
  if (proxyUrl) return proxyUrl
  return resolveMediaUrl(mediaId).catch(() => null)
}

async function buildCompositionPrewarmRequests(
  panel: PanelPrewarmTarget,
  index: number,
  isCancelled: () => boolean,
): Promise<PrewarmRequest[]> {
  const item = panel.item
  if (item?.type !== 'composition' || panel.sourceFrame === undefined) return []

  const compositionById = useCompositionsStore.getState().compositionById
  const composition = compositionById[item.compositionId]
  if (!composition) return []

  const compositionInput = buildSubCompositionInput(composition)
  const sourceTimesByKey = collectVisibleTrackVideoSourceTimesBySrc(
    compositionInput.tracks,
    panel.sourceFrame,
    composition.fps,
    {
      requireExplicitSourceFps: false,
      resolveComposition: (compositionId) => {
        const nested = compositionById[compositionId]
        return nested ? { fps: nested.fps, items: nested.items } : null
      },
      resolveItemSrc: (candidate) =>
        candidate.mediaId
          ? `${MEDIA_SOURCE_KEY_PREFIX}${candidate.mediaId}`
          : (candidate.src ?? null),
    },
  )

  const requests: PrewarmRequest[] = []
  for (const [sourceKey, sourceTimes] of sourceTimesByKey) {
    const src = await resolvePanelSource(sourceKey)
    if (!src || isCancelled()) continue
    for (const targetTime of sourceTimes) {
      requests.push({
        src,
        targetTime,
        panelKey: `${index}:${item.id}:${item.compositionId}:${src}`,
        fps: composition.fps,
        duration: targetTime + 1,
        exactOnly: true,
      })
    }
  }
  return requests
}

async function buildVideoPrewarmRequests(
  panel: PanelPrewarmTarget,
  index: number,
): Promise<PrewarmRequest[]> {
  const item = panel.item
  if (item?.type !== 'video' || !item.mediaId) return []

  const targetTime = Math.max(0, panel.sourceTime ?? 0)
  const panelKey = `${index}:${item.id}:${item.mediaId}`
  const fps = Math.max(1, Math.round(item.sourceFps ?? 60))
  const duration =
    item.sourceDuration && Number.isFinite(item.sourceDuration)
      ? Math.max(targetTime + CACHE_TIME_QUANTUM, item.sourceDuration / fps)
      : targetTime + 1
  const src = await resolveMediaSource(item.mediaId)

  return src ? [{ src, targetTime, panelKey, fps, duration }] : []
}

async function buildPanelPrewarmRequests(
  panel: PanelPrewarmTarget,
  index: number,
  isCancelled: () => boolean,
): Promise<PrewarmRequest[]> {
  if (panel.item?.type === 'composition') {
    return buildCompositionPrewarmRequests(panel, index, isCancelled)
  }
  return buildVideoPrewarmRequests(panel, index)
}

export function useEditOverlayPanelPrewarm(
  panels: ReadonlyArray<{
    item: TimelineItem | null
    sourceTime?: number
    sourceFrame?: number
  }>,
): void {
  const blobUrlVersion = useBlobUrlVersion()
  const previousAnchorFrameByPanelRef = useRef(new Map<string, number | null>())
  const prewarmTargets = useMemo(
    () =>
      panels.map((panel) => ({
        item: panel.item,
        sourceTime: panel.sourceTime,
        sourceFrame: panel.sourceFrame,
      })),
    [panels],
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const run = async () => {
      const requestGroups = await Promise.all(
        prewarmTargets.map((panel, index) =>
          buildPanelPrewarmRequests(panel, index, () => cancelled),
        ),
      )
      const requests = requestGroups.flat()

      if (cancelled) return

      const groupedBySrc = new Map<string, number[]>()
      const activePanelKeys = new Set<string>()
      for (const request of requests) {
        activePanelKeys.add(request.panelKey)

        const quantizedTime =
          Math.round(request.targetTime / CACHE_TIME_QUANTUM) * CACHE_TIME_QUANTUM
        const existing = groupedBySrc.get(request.src)
        if (existing) {
          if (!existing.includes(quantizedTime)) {
            existing.push(quantizedTime)
          }
        } else {
          groupedBySrc.set(request.src, [quantizedTime])
        }

        if (request.exactOnly) continue

        const previousAnchorFrame =
          previousAnchorFrameByPanelRef.current.get(request.panelKey) ?? null
        const directionalPlan = collectEditOverlayDirectionalPrewarmTimes({
          targetTime: request.targetTime,
          duration: request.duration,
          fps: request.fps,
          previousAnchorFrame,
          quantumSeconds: CACHE_TIME_QUANTUM,
          maxTimestamps: EDIT_OVERLAY_PREWARM_MAX_TIMESTAMPS,
          isCached: (time) => {
            const overlayCacheKey = getEditOverlayFrameCacheKey(
              request.src,
              time,
              CACHE_TIME_QUANTUM,
            )
            return (
              hasCachedEditOverlayFrame(overlayCacheKey) ||
              getCachedPredecodedBitmap(request.src, time, CACHE_TIME_QUANTUM) !== null
            )
          },
        })
        previousAnchorFrameByPanelRef.current.set(request.panelKey, directionalPlan.targetFrame)

        for (const time of directionalPlan.times) {
          const bySrc = groupedBySrc.get(request.src)
          if (!bySrc) {
            groupedBySrc.set(request.src, [time])
            continue
          }
          if (!bySrc.includes(time)) {
            bySrc.push(time)
          }
        }
      }

      for (const panelKey of [...previousAnchorFrameByPanelRef.current.keys()]) {
        if (!activePanelKeys.has(panelKey)) {
          previousAnchorFrameByPanelRef.current.delete(panelKey)
        }
      }

      for (const [src, timestamps] of groupedBySrc) {
        void backgroundBatchPreseek(src, timestamps, { signal: controller.signal }).catch(
          () => null,
        )
      }
    }

    void run()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [blobUrlVersion, prewarmTargets])
}
