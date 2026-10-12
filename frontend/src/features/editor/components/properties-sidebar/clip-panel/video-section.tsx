import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Crop, RotateCcw, Video } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import type { TimelineItem, VideoItem, AudioItem, CompositionItem } from '@/types/timeline'
import type { CropSettings } from '@/types/transform'
import type { ItemKeyframes } from '@/types/keyframe'
import {
  applyAutoKeyframeOperations,
  captureSnapshot,
  rateStretchItemWithoutHistory,
  resetSpeedWithRipple,
  updateItem,
  useItemsStore,
  useKeyframesStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview'
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '@/features/editor/deps/timeline-utils'
import {
  getAutoKeyframeOperation,
  getCropPropertyValue,
  type AutoKeyframeOperation,
  KeyframeToggle,
  resolveAnimatedCrop,
} from '@/features/editor/deps/keyframes'
import { PropertySection, PropertyRow, SliderInput } from '../components'
import { demixValue, getMixedValue } from '../utils'
import {
  cropPixelsToRatio,
  cropSignedPixelsToRatio,
  getCropSoftnessReferenceDimension,
  normalizeCropSettings,
} from '@/shared/utils/media-crop'

const MIN_SPEED = 0.1
const MAX_SPEED = 10.0
const CROP_STEP = 1
const CROP_TOLERANCE = 0.01

function snapCropPixels(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

interface VideoSectionProps {
  items: TimelineItem[]
}

type CropEdge = 'left' | 'right' | 'top' | 'bottom'
type CropProperty = 'cropLeft' | 'cropRight' | 'cropTop' | 'cropBottom' | 'cropSoftness'
type CropDimensions = { width: number; height: number }
type CropItem = VideoItem | CompositionItem
type ResolvedCropState = {
  crop: CropSettings | undefined
  dimensions: CropDimensions
}

const CROP_EDGE_PROPERTY: Record<CropEdge, Exclude<CropProperty, 'cropSoftness'>> = {
  left: 'cropLeft',
  right: 'cropRight',
  top: 'cropTop',
  bottom: 'cropBottom',
}

function getCropDimensions(item: CropItem): CropDimensions {
  if (item.type === 'composition') {
    return {
      width: Math.max(1, item.compositionWidth),
      height: Math.max(1, item.compositionHeight),
    }
  }

  return {
    width: Math.max(1, item.sourceWidth ?? item.transform?.width ?? DEFAULT_PROJECT_WIDTH),
    height: Math.max(1, item.sourceHeight ?? item.transform?.height ?? DEFAULT_PROJECT_HEIGHT),
  }
}

function getSharedCropDimension(items: CropItem[], dimension: keyof CropDimensions): number {
  if (items.length === 0) return 1
  return Math.min(...items.map((item) => getCropDimensions(item)[dimension]))
}

function buildCropUpdate(
  crop: CropSettings | undefined,
  edge: CropEdge,
  pixels: number,
  dimensions: CropDimensions,
): CropSettings | undefined {
  const dimension = edge === 'left' || edge === 'right' ? dimensions.width : dimensions.height
  return normalizeCropSettings({
    ...crop,
    [edge]: cropPixelsToRatio(snapCropPixels(pixels), dimension),
  })
}

function buildCropSoftnessUpdate(
  crop: CropSettings | undefined,
  pixels: number,
  dimensions: CropDimensions,
): CropSettings | undefined {
  return normalizeCropSettings({
    ...crop,
    softness: cropSignedPixelsToRatio(
      snapCropPixels(pixels),
      Math.max(1, getCropSoftnessReferenceDimension(dimensions.width, dimensions.height)),
    ),
  })
}

function getResolvedCropState(
  item: CropItem,
  currentFrame: number,
  itemKeyframes: ItemKeyframes | null | undefined,
): ResolvedCropState {
  const dimensions = getCropDimensions(item)
  return {
    dimensions,
    crop: resolveAnimatedCrop(
      item.crop,
      itemKeyframes ?? undefined,
      currentFrame - item.from,
      dimensions,
    ),
  }
}

function formatCropValue(value: number): string {
  return value.toFixed(0)
}

function getResolvedCropPropertyValue(
  state: ResolvedCropState | undefined,
  property: CropProperty,
): number | undefined {
  if (!state) return undefined
  return getCropPropertyValue(state.crop, property, state.dimensions)
}

function getCropPropertyValuesByItemId(
  items: CropItem[],
  statesByItem: ReadonlyMap<string, ResolvedCropState>,
  property: CropProperty,
): Record<string, number> {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      getResolvedCropPropertyValue(statesByItem.get(item.id), property) ?? 0,
    ]),
  )
}

/**
 * Playback section - playback rate, video fades, and edge crop.
 *
 * Speed changes affect clip duration (rate stretch behavior):
 * - Faster speed = shorter clip (same content plays faster)
 * - Slower speed = longer clip (same content plays slower)
 */
export function VideoSection({ items }: VideoSectionProps) {
  const { t } = useTranslation()
  const currentFrame = useThrottledFrame()

  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)

  const videoItems = useMemo(
    () => items.filter((item): item is VideoItem => item.type === 'video'),
    [items],
  )

  const cropItems = useMemo(
    () =>
      items.filter(
        (item): item is CropItem => item.type === 'video' || item.type === 'composition',
      ),
    [items],
  )
  const videoItemIds = useMemo(() => videoItems.map((item) => item.id), [videoItems])
  const cropItemIds = useMemo(() => cropItems.map((item) => item.id), [cropItems])

  const rateStretchableIds = useMemo(
    () =>
      items
        .filter(
          (item): item is VideoItem | AudioItem => item.type === 'video' || item.type === 'audio',
        )
        .map((item) => item.id),
    [items],
  )

  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback(
        (s) => cropItemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null),
        [cropItemIds],
      ),
    ),
  )
  const keyframesByItemId = useMemo(() => {
    const map = new Map<string, (typeof itemKeyframes)[number]>()
    for (const [index, itemId] of cropItemIds.entries()) {
      map.set(itemId, itemKeyframes[index] ?? null)
    }
    return map
  }, [cropItemIds, itemKeyframes])

  const resolvedCropStatesByItem = useMemo(() => {
    const map = new Map<string, ResolvedCropState>()
    for (const item of cropItems) {
      map.set(item.id, getResolvedCropState(item, currentFrame, keyframesByItemId.get(item.id)))
    }
    return map
  }, [cropItems, currentFrame, keyframesByItemId])

  const speed = getMixedValue(videoItems, (item) => item.speed, 1)
  const fadeIn = getMixedValue(videoItems, (item) => item.fadeIn, 0)
  const fadeOut = getMixedValue(videoItems, (item) => item.fadeOut, 0)
  const cropLeft = getMixedValue(
    cropItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropLeft'),
    0,
  )
  const cropRight = getMixedValue(
    cropItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropRight'),
    0,
  )
  const cropTop = getMixedValue(
    cropItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropTop'),
    0,
  )
  const cropBottom = getMixedValue(
    cropItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropBottom'),
    0,
  )
  const cropSoftness = getMixedValue(
    cropItems,
    (item) => getResolvedCropPropertyValue(resolvedCropStatesByItem.get(item.id), 'cropSoftness'),
    0,
  )
  const cropValuesByProperty = useMemo(
    () => ({
      cropLeft: getCropPropertyValuesByItemId(cropItems, resolvedCropStatesByItem, 'cropLeft'),
      cropRight: getCropPropertyValuesByItemId(cropItems, resolvedCropStatesByItem, 'cropRight'),
      cropTop: getCropPropertyValuesByItemId(cropItems, resolvedCropStatesByItem, 'cropTop'),
      cropBottom: getCropPropertyValuesByItemId(cropItems, resolvedCropStatesByItem, 'cropBottom'),
      cropSoftness: getCropPropertyValuesByItemId(
        cropItems,
        resolvedCropStatesByItem,
        'cropSoftness',
      ),
    }),
    [cropItems, resolvedCropStatesByItem],
  )

  const sharedSourceWidth = useMemo(() => getSharedCropDimension(cropItems, 'width'), [cropItems])
  const sharedSourceHeight = useMemo(() => getSharedCropDimension(cropItems, 'height'), [cropItems])
  const maxCropSoftness = useMemo(
    () =>
      Math.max(
        1,
        ...cropItems.map((item) => {
          const dimensions = getCropDimensions(item)
          return Math.max(1, getCropSoftnessReferenceDimension(dimensions.width, dimensions.height))
        }),
      ),
    [cropItems],
  )
  const speedDragSnapshotRef = useRef<ReturnType<typeof captureSnapshot> | null>(null)

  const applySpeedChangeWithoutHistory = useCallback(
    (newSpeed: number) => {
      const roundedSpeed = Math.round(newSpeed * 100) / 100
      const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, roundedSpeed))

      const { items: currentItems } = useItemsStore.getState()
      const { fps } = useTimelineSettingsStore.getState()
      currentItems
        .filter(
          (item: TimelineItem): item is VideoItem | AudioItem =>
            (item.type === 'video' || item.type === 'audio') &&
            rateStretchableIds.includes(item.id),
        )
        .forEach((item: VideoItem | AudioItem) => {
          const currentSpeed = item.speed || 1
          const sourceFps = item.sourceFps ?? fps
          const effectiveSourceFrames =
            item.sourceEnd !== undefined && item.sourceStart !== undefined
              ? item.sourceEnd - item.sourceStart
              : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps)
          const newDuration = Math.max(
            1,
            sourceToTimelineFrames(effectiveSourceFrames, clampedSpeed, sourceFps, fps),
          )
          rateStretchItemWithoutHistory(item.id, item.from, newDuration, clampedSpeed)
        })

      return clampedSpeed
    },
    [rateStretchableIds],
  )

  const commitSpeedChange = useCallback(
    (newSpeed: number) => {
      const beforeSnapshot = speedDragSnapshotRef.current ?? captureSnapshot()
      const clampedSpeed = applySpeedChangeWithoutHistory(newSpeed)
      useTimelineCommandStore.getState().addUndoEntry(
        {
          type: 'RATE_STRETCH_ITEM',
          payload: { ids: rateStretchableIds, newSpeed: clampedSpeed },
        },
        beforeSnapshot,
      )
      speedDragSnapshotRef.current = null
    },
    [applySpeedChangeWithoutHistory, rateStretchableIds],
  )

  const handleSpeedLiveChange = useCallback(
    (newSpeed: number) => {
      if (!speedDragSnapshotRef.current) {
        speedDragSnapshotRef.current = captureSnapshot()
      }
      applySpeedChangeWithoutHistory(newSpeed)
    },
    [applySpeedChangeWithoutHistory],
  )

  const commitPreviewClear = useCallback(() => {
    queueMicrotask(() => clearPreview())
  }, [clearPreview])

  const handleFadeInLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeIn: number }> = {}
      videoItemIds.forEach((id) => {
        previews[id] = { fadeIn: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [setPropertiesPreviewNew, videoItemIds],
  )

  const handleFadeInChange = useCallback(
    (value: number) => {
      videoItemIds.forEach((id) => updateItem(id, { fadeIn: value }))
      commitPreviewClear()
    },
    [videoItemIds, commitPreviewClear],
  )

  const handleFadeOutLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fadeOut: number }> = {}
      videoItemIds.forEach((id) => {
        previews[id] = { fadeOut: value }
      })
      setPropertiesPreviewNew(previews)
    },
    [setPropertiesPreviewNew, videoItemIds],
  )

  const handleFadeOutChange = useCallback(
    (value: number) => {
      videoItemIds.forEach((id) => updateItem(id, { fadeOut: value }))
      commitPreviewClear()
    },
    [videoItemIds, commitPreviewClear],
  )

  const previewCropEdge = useCallback(
    (edge: CropEdge, pixels: number) => {
      const previews: Record<string, { crop: CropItem['crop'] }> = {}
      cropItems.forEach((item) => {
        const cropState = resolvedCropStatesByItem.get(item.id)
        if (!cropState) return
        previews[item.id] = {
          crop: buildCropUpdate(cropState.crop, edge, pixels, cropState.dimensions),
        }
      })
      setPropertiesPreviewNew(previews)
    },
    [cropItems, resolvedCropStatesByItem, setPropertiesPreviewNew],
  )

  const commitCropEdge = useCallback(
    (edge: CropEdge, pixels: number) => {
      const property = CROP_EDGE_PROPERTY[edge]
      const snappedPixels = snapCropPixels(pixels)
      const autoOps: AutoKeyframeOperation[] = []

      cropItems.forEach((item) => {
        const operation = getAutoKeyframeOperation(
          item,
          keyframesByItemId.get(item.id) ?? undefined,
          property,
          snappedPixels,
          currentFrame,
        )
        if (operation) {
          autoOps.push(operation)
          return
        }

        updateItem(item.id, {
          crop: buildCropUpdate(item.crop, edge, snappedPixels, getCropDimensions(item)),
        })
      })

      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps)
      }

      commitPreviewClear()
    },
    [
      commitPreviewClear,
      currentFrame,
      keyframesByItemId,
      cropItems,
    ],
  )

  const previewCropSoftness = useCallback(
    (pixels: number) => {
      const previews: Record<string, { crop: CropItem['crop'] }> = {}
      cropItems.forEach((item) => {
        const cropState = resolvedCropStatesByItem.get(item.id)
        if (!cropState) return
        previews[item.id] = {
          crop: buildCropSoftnessUpdate(cropState.crop, pixels, cropState.dimensions),
        }
      })
      setPropertiesPreviewNew(previews)
    },
    [cropItems, resolvedCropStatesByItem, setPropertiesPreviewNew],
  )

  const commitCropSoftness = useCallback(
    (pixels: number) => {
      const snappedPixels = snapCropPixels(pixels)
      const autoOps: AutoKeyframeOperation[] = []

      cropItems.forEach((item) => {
        const operation = getAutoKeyframeOperation(
          item,
          keyframesByItemId.get(item.id) ?? undefined,
          'cropSoftness',
          snappedPixels,
          currentFrame,
        )
        if (operation) {
          autoOps.push(operation)
          return
        }

        updateItem(item.id, {
          crop: buildCropSoftnessUpdate(item.crop, snappedPixels, getCropDimensions(item)),
        })
      })

      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps)
      }

      commitPreviewClear()
    },
    [
      commitPreviewClear,
      currentFrame,
      keyframesByItemId,
      cropItems,
    ],
  )

  const resetCropEdge = useCallback(
    (edge: CropEdge) => {
      const property = CROP_EDGE_PROPERTY[edge]
      const needsUpdate = cropItems.some((item) => {
        const cropState = resolvedCropStatesByItem.get(item.id)
        return Math.abs(getResolvedCropPropertyValue(cropState, property) ?? 0) > CROP_TOLERANCE
      })
      if (!needsUpdate) return
      commitCropEdge(edge, 0)
    },
    [commitCropEdge, cropItems, resolvedCropStatesByItem],
  )

  const resetCropSoftness = useCallback(() => {
    const needsUpdate = cropItems.some((item) => {
      const cropState = resolvedCropStatesByItem.get(item.id)
      return Math.abs(getResolvedCropPropertyValue(cropState, 'cropSoftness') ?? 0) > CROP_TOLERANCE
    })
    if (!needsUpdate) return
    commitCropSoftness(0)
  }, [commitCropSoftness, cropItems, resolvedCropStatesByItem])

  const handleResetSpeed = useCallback(() => {
    resetSpeedWithRipple(rateStretchableIds)
  }, [rateStretchableIds])

  const handleResetFadeIn = useCallback(() => {
    const tolerance = 0.01
    const currentItems = useItemsStore.getState().items
    const needsUpdate = currentItems.some(
      (item: TimelineItem) =>
        videoItemIds.includes(item.id) && ((item as VideoItem).fadeIn ?? 0) > tolerance,
    )
    if (needsUpdate) {
      videoItemIds.forEach((id) => updateItem(id, { fadeIn: 0 }))
    }
  }, [videoItemIds])

  const handleResetFadeOut = useCallback(() => {
    const tolerance = 0.01
    const currentItems = useItemsStore.getState().items
    const needsUpdate = currentItems.some(
      (item: TimelineItem) =>
        videoItemIds.includes(item.id) && ((item as VideoItem).fadeOut ?? 0) > tolerance,
    )
    if (needsUpdate) {
      videoItemIds.forEach((id) => updateItem(id, { fadeOut: 0 }))
    }
  }, [videoItemIds])

  if (cropItems.length === 0) return null

  return (
    <>
      {videoItems.length > 0 && (
        <PropertySection title={t('editor.videoSection.playback')} icon={Video} defaultOpen={true}>
          <PropertyRow label={t('editor.videoSection.speed')}>
            <div className="flex items-center gap-1 w-full">
              <SliderInput
                value={speed}
                onChange={commitSpeedChange}
                onLiveChange={handleSpeedLiveChange}
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={0.01}
                unit="x"
                className="flex-1 min-w-0"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={handleResetSpeed}
                title={t('editor.videoSection.resetSpeed')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.videoSection.fadeIn')}>
            <div className="flex items-center gap-1 w-full">
              <SliderInput
                value={fadeIn}
                onChange={handleFadeInChange}
                onLiveChange={handleFadeInLiveChange}
                min={0}
                max={5}
                step={0.1}
                unit="s"
                className="flex-1 min-w-0"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={handleResetFadeIn}
                title={t('editor.videoSection.resetToZero')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </PropertyRow>

          <PropertyRow label={t('editor.videoSection.fadeOut')}>
            <div className="flex items-center gap-1 w-full">
              <SliderInput
                value={fadeOut}
                onChange={handleFadeOutChange}
                onLiveChange={handleFadeOutLiveChange}
                min={0}
                max={5}
                step={0.1}
                unit="s"
                className="flex-1 min-w-0"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={handleResetFadeOut}
                title={t('editor.videoSection.resetToZero')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </PropertyRow>
        </PropertySection>
      )}

      <PropertySection title={t('editor.videoSection.cropping')} icon={Crop} defaultOpen={true}>
        <PropertyRow label={t('editor.videoSection.cropLeft')}>
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropLeft}
              onChange={(value) => commitCropEdge('left', value)}
              onLiveChange={(value) => previewCropEdge('left', value)}
              min={0}
              max={sharedSourceWidth}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={cropItemIds}
              property="cropLeft"
              currentValue={demixValue(cropLeft, 0)}
              currentValuesByItemId={cropValuesByProperty.cropLeft}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('left')}
              title={t('editor.videoSection.resetCropLeft')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label={t('editor.videoSection.cropRight')}>
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropRight}
              onChange={(value) => commitCropEdge('right', value)}
              onLiveChange={(value) => previewCropEdge('right', value)}
              min={0}
              max={sharedSourceWidth}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={cropItemIds}
              property="cropRight"
              currentValue={demixValue(cropRight, 0)}
              currentValuesByItemId={cropValuesByProperty.cropRight}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('right')}
              title={t('editor.videoSection.resetCropRight')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label={t('editor.videoSection.cropTop')}>
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropTop}
              onChange={(value) => commitCropEdge('top', value)}
              onLiveChange={(value) => previewCropEdge('top', value)}
              min={0}
              max={sharedSourceHeight}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={cropItemIds}
              property="cropTop"
              currentValue={demixValue(cropTop, 0)}
              currentValuesByItemId={cropValuesByProperty.cropTop}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('top')}
              title={t('editor.videoSection.resetCropTop')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label={t('editor.videoSection.cropBottom')}>
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropBottom}
              onChange={(value) => commitCropEdge('bottom', value)}
              onLiveChange={(value) => previewCropEdge('bottom', value)}
              min={0}
              max={sharedSourceHeight}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={cropItemIds}
              property="cropBottom"
              currentValue={demixValue(cropBottom, 0)}
              currentValuesByItemId={cropValuesByProperty.cropBottom}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => resetCropEdge('bottom')}
              title={t('editor.videoSection.resetCropBottom')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>

        <PropertyRow label={t('editor.videoSection.softness')}>
          <div className="flex items-center gap-1 w-full">
            <SliderInput
              value={cropSoftness}
              onChange={commitCropSoftness}
              onLiveChange={previewCropSoftness}
              min={-maxCropSoftness}
              max={maxCropSoftness}
              step={CROP_STEP}
              unit="px"
              formatValue={formatCropValue}
              formatInputValue={formatCropValue}
              className="flex-1 min-w-0"
            />
            <KeyframeToggle
              itemIds={cropItemIds}
              property="cropSoftness"
              currentValue={demixValue(cropSoftness, 0)}
              currentValuesByItemId={cropValuesByProperty.cropSoftness}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={resetCropSoftness}
              title={t('editor.videoSection.resetSoftness')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </PropertyRow>
      </PropertySection>
    </>
  )
}
