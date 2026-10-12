import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import type { AnimatableProperty } from '@/types/keyframe'
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useClearKeyframesDialogStore } from '@/shared/state/clear-keyframes-dialog'
import { useTtsGenerateDialogStore } from '@/shared/state/tts-generate-dialog'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import {
  getMediaTranscriptionModelLabel,
  mediaTranscriptionService,
  runMediaTranscriptionJob,
} from '@/features/timeline/deps/media-transcription-service'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { joinItems, removeItems, rippleDeleteItems } from '../../stores/timeline-actions'
import { useItemsStore } from '../../stores/items-store'
import {
  insertFreezeFrame,
  linkItems,
  reverseItems,
  splitItemAtFrames,
  unlinkItems,
} from '../../stores/actions/item-actions'
import {
  createPreComp,
  dissolvePreComp,
  openComposition,
} from '../../stores/actions/composition-actions'
import {
  type TimelineItemOverlay,
  useTimelineItemOverlayStore,
} from '../../stores/timeline-item-overlay-store'
import { useSilenceRemovalDialogStore } from '../../stores/silence-removal-dialog-store'
import { useFillerRemovalDialogStore } from '../../stores/filler-removal-dialog-store'
import { canJoinMultipleItems } from '../../utils/clip-utils'
import { canLinkSelection, hasLinkedItems } from '../../utils/linked-items'
import {
  getSceneVerificationModelLabel,
  importSceneDetection,
  SCENE_DETECTOR_VERSION,
  type SceneDetectionMethod,
  type VerificationModel,
} from '../../deps/analysis'
import { resolveMediaUrl } from '../../deps/media-library-resolver'
import { useBentoLayoutDialogStore } from '../bento-layout-dialog-store'
import { createLogger } from '@/shared/logging/logger'
import { saveScenes } from '@/infrastructure/storage/workspace-fs/scenes'
import {
  analyzeFillerWordsForItems,
  applyFillerPreviewOverlays,
  DEFAULT_FILLER_REMOVAL_SETTINGS,
} from '../../utils/filler-word-removal-preview'
import { mapSceneCutTimesToTimelineFrames } from '../../utils/scene-cut-frames'

const logger = createLogger('UseTimelineItemActions')

const SCENE_DETECTION_OVERLAY_ID = 'scene-detection'

interface SelectionCapabilities {
  canJoin: boolean
  canLink: boolean
  canUnlink: boolean
}

let cachedSelectionIds: string[] | null = null
let cachedSelectionItems: TimelineItemType[] | null = null
let cachedSelectionCapabilities: SelectionCapabilities = {
  canJoin: false,
  canLink: false,
  canUnlink: false,
}

/**
 * Context-menu capabilities are selection-wide, but every mounted clip renders
 * its own menu trigger. Cache the shared calculation by the stable Zustand
 * array references so a multi-select drag does the work once instead of once
 * per selected clip on both drag start and drag end.
 */
function getSelectionCapabilities(): SelectionCapabilities {
  const selectedItemIds = useSelectionStore.getState().selectedItemIds
  const itemsState = useItemsStore.getState()
  const items = itemsState.items

  if (selectedItemIds === cachedSelectionIds && items === cachedSelectionItems) {
    return cachedSelectionCapabilities
  }

  const selectedItems = selectedItemIds
    .map((id) => itemsState.itemById[id])
    .filter((candidate): candidate is TimelineItemType => candidate !== undefined)

  cachedSelectionIds = selectedItemIds
  cachedSelectionItems = items
  cachedSelectionCapabilities = {
    canJoin: selectedItems.length >= 2 && canJoinMultipleItems(selectedItems),
    canLink: selectedItemIds.length >= 2 && canLinkSelection(items, selectedItemIds),
    canUnlink:
      selectedItemIds.length > 0 && selectedItemIds.some((id) => hasLinkedItems(items, id)),
  }

  return cachedSelectionCapabilities
}

interface UseTimelineItemActionsParams {
  item: TimelineItemType
  isBroken: boolean
  leftNeighbor: TimelineItemType | null
  rightNeighbor: TimelineItemType | null
  segmentOverlays: readonly TimelineItemOverlay[]
}

export function useTimelineItemActions({
  item,
  isBroken,
  leftNeighbor,
  rightNeighbor,
  segmentOverlays,
}: UseTimelineItemActionsParams) {
  const getCanJoinSelected = useCallback(() => getSelectionCapabilities().canJoin, [])

  const getCanLinkSelected = useCallback(() => getSelectionCapabilities().canLink, [])

  const getCanUnlinkSelected = useCallback(() => getSelectionCapabilities().canUnlink, [])

  const handleJoinSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    if (selectedItemIds.length >= 2) {
      const itemById = useItemsStore.getState().itemById
      const selectedItems = selectedItemIds
        .map((id) => itemById[id])
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
      if (canJoinMultipleItems(selectedItems)) {
        joinItems(selectedItemIds)
      }
    }
  }, [])

  const handleJoinLeft = useCallback(() => {
    if (leftNeighbor) {
      joinItems([leftNeighbor.id, item.id])
    }
  }, [leftNeighbor, item.id])

  const handleJoinRight = useCallback(() => {
    if (rightNeighbor) {
      joinItems([item.id, rightNeighbor.id])
    }
  }, [rightNeighbor, item.id])

  const handleDelete = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    if (selectedItemIds.length > 0) {
      removeItems(selectedItemIds)
    }
  }, [])

  const handleRippleDelete = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    if (selectedItemIds.length > 0) {
      rippleDeleteItems(selectedItemIds)
    }
  }, [])

  const handleLinkSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    void linkItems(selectedItemIds)
  }, [])

  const handleUnlinkSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    unlinkItems(selectedItemIds)
  }, [])

  const handleReverseSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    reverseItems(selectedItemIds.length > 0 ? selectedItemIds : [item.id])
  }, [item.id])

  const handleClearAllKeyframes = useCallback(() => {
    useClearKeyframesDialogStore.getState().openClearAll([item.id])
  }, [item.id])

  const handleClearPropertyKeyframes = useCallback(
    (property: AnimatableProperty) => {
      useClearKeyframesDialogStore.getState().openClearProperty([item.id], property)
    },
    [item.id],
  )

  const handleBentoLayout = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    if (selectedItemIds.length < 2) {
      return
    }
    useBentoLayoutDialogStore.getState().open(selectedItemIds)
  }, [])

  const handleFreezeFrame = useCallback(() => {
    if (item.type !== 'video') {
      return
    }
    const { currentFrame } = usePlaybackStore.getState()
    void insertFreezeFrame(item.id, currentFrame)
  }, [item.id, item.type])

  const textContent = item.type === 'text' ? getTextItemPlainText(item) : ''
  const hasSpeakableText = textContent.trim().length > 0

  const handleGenerateAudioFromText = useCallback(() => {
    if (!hasSpeakableText) {
      return
    }
    useTtsGenerateDialogStore.getState().open(textContent, item.id)
  }, [hasSpeakableText, item.id, textContent])

  const handleCaptionGeneration = useCallback(
    (
      model: MediaTranscriptModel,
      options?: {
        forceTranscription?: boolean
        replaceExisting?: boolean
        quantization?: MediaTranscriptQuantization
        language?: string
        onError?: (error: unknown) => void
      },
    ) => {
      if ((item.type !== 'video' && item.type !== 'audio') || !item.mediaId || isBroken) {
        return
      }

      const mediaId = item.mediaId
      const clipId = item.id
      const store = useMediaLibraryStore.getState()
      const forceTranscription = options?.forceTranscription ?? false
      const replaceExisting = options?.replaceExisting ?? false

      const run = async () => {
        try {
          const existingTranscript = await mediaTranscriptionService.getTranscript(mediaId)
          const needsTranscription =
            forceTranscription || !existingTranscript || existingTranscript.model !== model

          if (needsTranscription) {
            const result = await runMediaTranscriptionJob(mediaId, {
              model,
              quantization: options?.quantization,
              language: options?.language || undefined,
            })
            if (result.status === 'cancelled') {
              return
            }
          } else {
            store.setTranscriptStatus(mediaId, 'ready')
            store.clearTranscriptProgress(mediaId)
          }
          const result = await mediaTranscriptionService.enableTranscriptCaptions(mediaId, {
            clipIds: [clipId],
            replaceExisting,
          })

          const modelLabel = getMediaTranscriptionModelLabel(model)
          const successMessage = replaceExisting
            ? result.updatedClipCount > 0
              ? result.removedItemCount > 0
                ? i18n.t('timeline.captions.updatedWithModel', { model: modelLabel })
                : i18n.t('timeline.captions.refreshedWithModel', { model: modelLabel })
              : i18n.t('timeline.captions.removedFromSegment')
            : i18n.t('timeline.captions.addedWithModel', { model: modelLabel })

          store.showNotification({
            type: 'success',
            message: successMessage,
          })
        } catch (error) {
          const fallbackMessage =
            error instanceof Error
              ? error.message
              : i18n.t('timeline.captions.failedGenerateSegment')
          const friendlyMessage = isTranscriptionOutOfMemoryError(error)
            ? TRANSCRIPTION_OOM_HINT
            : fallbackMessage
          options?.onError?.(error)
          store.showNotification({
            type: 'error',
            message: friendlyMessage,
          })
        }
      }

      // Start directly rather than via requestAnimationFrame: rAF is suspended while the
      // tab is hidden/occluded, which would leave caption generation hung until the tab
      // regained focus. Transcription runs in workers, so there's no paint to wait for.
      void run()
    },
    [item.id, item.mediaId, item.type, isBroken],
  )

  const handleCaptionsFromDialog = useCallback(
    (
      values: {
        model: MediaTranscriptModel
        quantization: MediaTranscriptQuantization
        language: string
      },
      hasExistingCaptions: boolean,
      onError?: (error: unknown) => void,
    ) => {
      handleCaptionGeneration(values.model, {
        // The dialog path is always "generate fresh captions". Existing
        // transcripts are auto-enabled as virtual captions when clips load.
        forceTranscription: true,
        replaceExisting: hasExistingCaptions,
        quantization: values.quantization,
        language: values.language,
        onError,
      })
    },
    [handleCaptionGeneration],
  )

  const isSceneDetectionActive = segmentOverlays.some(
    (overlay) => overlay.id === SCENE_DETECTION_OVERLAY_ID,
  )

  const isCompositionItem =
    item.type === 'composition' || (item.type === 'audio' && !!item.compositionId)
  const sourceStart = 'sourceStart' in item ? item.sourceStart : undefined
  const clipFrom = item.from

  const handleCreatePreComp = useCallback(() => {
    // Capture selection synchronously - context menu close may clear it before the dynamic import resolves.
    const ids = useSelectionStore.getState().selectedItemIds
    createPreComp(undefined, ids)
  }, [])

  const compositionId = item.compositionId
  const itemLabel = item.label
  const handleEnterComposition = useCallback(() => {
    if (!isCompositionItem || !compositionId) {
      return
    }

    openComposition(compositionId, itemLabel, item.id)
  }, [isCompositionItem, compositionId, itemLabel, item.id])

  const handleDissolveComposition = useCallback(() => {
    if (!isCompositionItem) {
      return
    }

    dissolvePreComp(item.id)
  }, [isCompositionItem, item.id])

  const sceneDetectionAbortRef = useRef<AbortController | null>(null)
  const [isRemovingFillers, setIsRemovingFillers] = useState(false)

  useEffect(() => {
    return () => {
      sceneDetectionAbortRef.current?.abort()
    }
  }, [])

  const handleDetectScenes = useCallback(
    (method: SceneDetectionMethod, verificationModel?: VerificationModel) => {
      if (item.type !== 'video' || !item.mediaId || isBroken) {
        return
      }

      const mediaId = item.mediaId
      const clipId = item.id
      const overlayStore = useTimelineItemOverlayStore.getState()

      const run = async () => {
        sceneDetectionAbortRef.current?.abort()
        const abortController = new AbortController()
        sceneDetectionAbortRef.current = abortController
        let video: HTMLVideoElement | null = null

        try {
          overlayStore.upsertOverlay(clipId, {
            id: SCENE_DETECTION_OVERLAY_ID,
            label: i18n.t('timeline.sceneDetection.detectingScenes'),
            progress: 0,
            tone: 'info',
          })

          const url = await resolveMediaUrl(mediaId)
          video = document.createElement('video')
          video.src = url
          video.muted = true
          video.preload = 'auto'

          await new Promise<void>((resolve, reject) => {
            if (abortController.signal.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            const onAbort = () => {
              reject(new DOMException('Aborted', 'AbortError'))
            }
            abortController.signal.addEventListener('abort', onAbort, { once: true })
            video!.onloadedmetadata = () => {
              abortController.signal.removeEventListener('abort', onAbort)
              resolve()
            }
            video!.onerror = () => {
              abortController.signal.removeEventListener('abort', onAbort)
              reject(new Error('Failed to load video for scene detection'))
            }
          })

          const currentFps = useTimelineSettingsStore.getState().fps
          const media = useMediaLibraryStore.getState().mediaById[mediaId]
          const mediaFps = media?.fps ?? currentFps
          const { detectScenes } = await importSceneDetection()
          const cuts = await detectScenes(video, {
            method,
            verificationModel,
            mediaId,
            sourceFps: mediaFps,
            signal: abortController.signal,
            onProgress: (progress) => {
              const modelLabel = progress.verificationModel
                ? getSceneVerificationModelLabel(progress.verificationModel)
                : 'AI'
              const stageLabels = {
                analyzing: `Analyzing frames (${progress.sceneCuts} candidates)`,
                classifying: `Classifying cuts (${progress.sceneCuts} candidates)`,
                'loading-model': `Loading ${modelLabel} model (${progress.percent.toFixed(0)}%)`,
                verifying: `Verifying cuts (${progress.sceneCuts}/${progress.total} confirmed)`,
              }
              const label = stageLabels[progress.stage]
              useTimelineItemOverlayStore.getState().upsertOverlay(clipId, {
                id: SCENE_DETECTION_OVERLAY_ID,
                label,
                progress: progress.percent,
                tone: 'info',
              })
            },
          })

          // Persist scene cuts to the workspace so the next session/window
          // doesn't need to recompute. Fire-and-forget — UX proceeds regardless.
          if (cuts.length > 0) {
            void saveScenes({
              mediaId,
              service: method === 'histogram' ? 'scene-detect-histogram' : 'scene-detect-adaptive',
              model: verificationModel ?? method,
              method,
              detectorVersion: SCENE_DETECTOR_VERSION,
              sampleIntervalMs: method === 'histogram' ? 250 : undefined,
              verificationModel,
              cuts,
            }).catch((error) => logger.warn('Failed to persist scene cuts', error))
          }

          if (cuts.length === 0) {
            toast.info(i18n.t('timeline.sceneDetection.noScenesDetected'))
            return
          }

          const clipDuration = item.durationInFrames
          // Source trims use native FPS; scene boundaries are persisted as source time.
          const sourceStartSeconds = (sourceStart ?? 0) / mediaFps
          const splitFrames = mapSceneCutTimesToTimelineFrames({
            cuts,
            sourceStartSeconds,
            projectFps: currentFps,
            clipFrom,
            clipDurationInFrames: clipDuration,
          })

          if (splitFrames.length === 0) {
            toast.info(i18n.t('timeline.sceneDetection.noScenesWithinBounds'))
            return
          }

          const splitCount = splitItemAtFrames(clipId, splitFrames)

          if (splitCount > 0) {
            toast.success(i18n.t('timeline.sceneDetection.splitAtScenes', { count: splitCount }))
          } else {
            toast.info(i18n.t('timeline.sceneDetection.noValidSplitPoints'))
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }
          toast.error(i18n.t('timeline.sceneDetection.failed'))
        } finally {
          if (video) {
            video.onloadedmetadata = null
            video.onerror = null
            video.src = ''
          }
          // Only remove overlay if this run still owns the controller
          if (sceneDetectionAbortRef.current === abortController) {
            useTimelineItemOverlayStore.getState().removeOverlay(clipId, SCENE_DETECTION_OVERLAY_ID)
          }
        }
      }

      void run()
    },
    [clipFrom, isBroken, item.durationInFrames, item.id, item.mediaId, item.type, sourceStart],
  )

  const handleRemoveSilence = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    const targetIds = selectedItemIds.length > 0 ? selectedItemIds : [item.id]
    const targetItems = targetIds
      .map((id) => useItemsStore.getState().itemById[id])
      .filter(
        (candidate): candidate is TimelineItemType =>
          candidate !== undefined &&
          (candidate.type === 'video' || candidate.type === 'audio') &&
          !!candidate.mediaId,
      )

    if (targetItems.length === 0) {
      toast.info(i18n.t('timeline.itemActions.selectAvClipFirst'))
      return
    }

    useSilenceRemovalDialogStore.getState().open({
      itemIds: targetItems.map((target) => target.id),
    })
  }, [item.id])

  const handleRemoveFillers = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds
    const targetIds = selectedItemIds.length > 0 ? selectedItemIds : [item.id]
    const targetItems = targetIds
      .map((id) => useItemsStore.getState().itemById[id])
      .filter(
        (candidate): candidate is TimelineItemType =>
          candidate !== undefined &&
          (candidate.type === 'video' || candidate.type === 'audio') &&
          !!candidate.mediaId,
      )

    if (targetItems.length === 0) {
      toast.info('Select an audio or video clip first')
      return
    }

    const run = async () => {
      setIsRemovingFillers(true)
      try {
        const targetItemIds = targetItems.map((target) => target.id)
        const rangesByMediaId = await analyzeFillerWordsForItems(
          targetItemIds,
          DEFAULT_FILLER_REMOVAL_SETTINGS,
        )
        const summary = applyFillerPreviewOverlays(targetItemIds, rangesByMediaId)

        if (summary.rangeCount === 0) {
          toast.info(i18n.t('timeline.fillerRemoval.noRemovableDetectedShort'))
          return
        }

        useFillerRemovalDialogStore.getState().open({
          itemIds: targetItemIds,
          settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
          rangesByMediaId,
          summary,
        })
      } catch (error) {
        logger.warn('Remove filler words failed', error)
        toast.error(
          error instanceof Error
            ? error.message
            : i18n.t('timeline.fillerRemoval.toastPreviewFailed'),
        )
      } finally {
        setIsRemovingFillers(false)
      }
    }

    void run()
  }, [item.id])

  return {
    getCanJoinSelected,
    getCanLinkSelected,
    getCanUnlinkSelected,
    hasSpeakableText,
    isSceneDetectionActive,
    isRemovingFillers,
    isCompositionItem,
    handleJoinSelected,
    handleJoinLeft,
    handleJoinRight,
    handleDelete,
    handleRippleDelete,
    handleLinkSelected,
    handleUnlinkSelected,
    handleReverseSelected,
    handleClearAllKeyframes,
    handleClearPropertyKeyframes,
    handleBentoLayout,
    handleFreezeFrame,
    handleGenerateAudioFromText,
    handleCaptionsFromDialog,
    handleCreatePreComp,
    handleEnterComposition,
    handleDissolveComposition,
    handleDetectScenes,
    handleRemoveSilence,
    handleRemoveFillers,
  }
}
