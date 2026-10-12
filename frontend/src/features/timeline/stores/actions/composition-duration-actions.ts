/**
 * Composition canvas duration — the authored length of a layer composition,
 * independent of how long its layers happen to be.
 */

import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { usePlaybackStore } from '@/shared/state/playback'
import { getActiveCompositionId } from '../composition-navigation-active'
import { useCompositionsStore } from '../compositions-store'
import { useItemsStore } from '../items-store'
import { trimSubtitleCuesAtStart } from '../items-store-normalize'
import { useKeyframesStore } from '../keyframes-store'
import { useMarkersStore } from '../markers-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { calculateTrimSourceUpdate } from '../../utils/trim-utils'
import { execute } from './shared'

/**
 * Set a composition's canvas duration in frames (undoable).
 *
 * The authored value wins outright — including shorter than the last layer, which
 * then simply hangs past the end of the comp and is not rendered. Clamping to the
 * content extent instead would make the field silently refuse most edits, since a
 * layer usually spans the whole comp.
 */
export function setCompositionDuration(compositionId: string, durationInFrames: number): void {
  execute(
    'SET_COMPOSITION_DURATION',
    () => {
      const composition = useCompositionsStore.getState().getComposition(compositionId)
      if (!composition || !Number.isFinite(durationInFrames)) return

      const next = Math.max(1, Math.round(durationInFrames))
      if (next === composition.durationInFrames) return

      useCompositionsStore.getState().updateComposition(compositionId, { durationInFrames: next })
      sanitizeCompositionRange(compositionId, next)
      clampPlayheadToComposition(compositionId, next)
      useTimelineSettingsStore.getState().markDirty()
    },
    { compositionId, durationInFrames },
  )
}

/**
 * Pull the in/out range back inside a composition after its canvas shrank.
 * Without this the active region — and so the export range — could still point
 * past the end of the comp at frames that no longer render.
 */
function sanitizeCompositionRange(compositionId: string, durationInFrames: number): void {
  const isActive = getActiveCompositionId() === compositionId

  if (isActive) {
    const { inPoint, outPoint, setInOutPoints } = useMarkersStore.getState()
    if (inPoint === null || outPoint === null) return
    if (inPoint <= durationInFrames && outPoint <= durationInFrames) return
    const nextIn = Math.min(inPoint, Math.max(0, durationInFrames - 1))
    setInOutPoints(nextIn, Math.min(outPoint, durationInFrames))
    return
  }

  const composition = useCompositionsStore.getState().getComposition(compositionId)
  const inPoint = composition?.inPoint ?? null
  const outPoint = composition?.outPoint ?? null
  if (inPoint === null || outPoint === null) return
  if (inPoint <= durationInFrames && outPoint <= durationInFrames) return
  useCompositionsStore.getState().updateComposition(compositionId, {
    inPoint: Math.min(inPoint, Math.max(0, durationInFrames - 1)),
    outPoint: Math.min(outPoint, durationInFrames),
  })
}

/**
 * Drop the animation of removed layers and re-anchor what a head trim moved.
 * Keyframes are stored relative to their item, so shifting an item's start by N
 * frames moves its keyframes N frames later in comp time unless they follow.
 * Keys that end up before the new start are dropped — their values are outside the
 * region being kept.
 */
function rebaseKeyframesOnTrimmedItems(
  keyframes: ItemKeyframes[],
  keptItemIds: ReadonlySet<string>,
  headTrimByItemId: ReadonlyMap<string, number>,
): ItemKeyframes[] {
  return keyframes.flatMap((entry) => {
    if (!keptItemIds.has(entry.itemId)) return []
    const trimAmount = headTrimByItemId.get(entry.itemId)
    if (trimAmount === undefined || trimAmount === 0) return [entry]

    const shift = <TKeyframe extends { frame: number }>(items: TKeyframe[]): TKeyframe[] =>
      items
        .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - trimAmount }))
        .filter((keyframe) => keyframe.frame >= 0)

    return [
      {
        ...entry,
        properties: entry.properties.map((property) => ({
          ...property,
          keyframes: shift(property.keyframes),
        })),
        // Separated vectors store their component lanes in `properties`
        // (position => x/y, scale => width/height, anchor => anchorX/anchorY).
        // Those keys were shifted above; retain the separation-mode metadata
        // explicitly so hydration does not recombine the rebased lanes.
        ...(entry.separatedVectorProperties
          ? { separatedVectorProperties: [...entry.separatedVectorProperties] }
          : {}),
        ...(entry.vectorProperties
          ? {
              vectorProperties: entry.vectorProperties.map((property) => ({
                ...property,
                keyframes: shift(property.keyframes),
              })),
            }
          : {}),
      },
    ]
  })
}

/**
 * Keep the playhead inside the comp when its canvas shrinks under it — After
 * Effects never leaves the time indicator outside the composition.
 */
function clampPlayheadToComposition(compositionId: string, durationInFrames: number): void {
  if (getActiveCompositionId() !== compositionId) return
  const lastFrame = Math.max(0, durationInFrames - 1)
  const playback = usePlaybackStore.getState()
  if (playback.currentFrame <= lastFrame) return
  playback.setCurrentFrame(lastFrame)
}

/**
 * AE's "Trim Comp to Work Area": the active (in/out) region becomes the whole
 * composition. Layers keep their timing relative to each other — everything
 * shifts back by the in point — and the canvas becomes the region's length.
 *
 * Layers wholly outside the region are dropped; a layer straddling the in point is
 * head-trimmed to it, source window and subtitle cues included. Its keyframes are
 * re-anchored to the new start (they are stored relative to the item) so the region
 * keeps the animation it had — a plain head trim leaves them alone, but the point
 * of trimming a comp is that what was inside the region still looks the same.
 *
 * Returns false (no history entry) when there is nothing to trim.
 */
export function trimCompositionToActiveRegion(): boolean {
  const compositionId = getActiveCompositionId()
  if (compositionId === null) return false

  const composition = useCompositionsStore.getState().getComposition(compositionId)
  if (!composition || composition.editorKind !== 'composite-2d') return false

  const { inPoint, outPoint } = useMarkersStore.getState()
  if (inPoint === null || outPoint === null || outPoint <= inPoint) return false
  if (inPoint === 0 && outPoint === composition.durationInFrames) return false

  return execute(
    'TRIM_COMPOSITION_TO_ACTIVE_REGION',
    () => {
      // Placement frames are in the comp's own FPS, which is also what the source
      // trim math needs as its timeline FPS.
      const fps = composition.fps
      const nextItems: TimelineItem[] = []
      const keptItemIds = new Set<string>()
      const headTrimByItemId = new Map<string, number>()

      for (const item of useItemsStore.getState().items) {
        const itemEnd = item.from + item.durationInFrames
        if (itemEnd <= inPoint || item.from >= outPoint) continue
        keptItemIds.add(item.id)

        if (item.from >= inPoint) {
          nextItems.push({ ...item, from: item.from - inPoint })
          continue
        }

        const trimAmount = inPoint - item.from
        const nextDuration = item.durationInFrames - trimAmount
        const sourceUpdate = calculateTrimSourceUpdate(item, 'start', trimAmount, nextDuration, fps)
        const cueUpdate =
          item.type === 'subtitle' ? trimSubtitleCuesAtStart(item, trimAmount, fps) : null

        headTrimByItemId.set(item.id, trimAmount)
        nextItems.push({
          ...item,
          from: 0,
          durationInFrames: nextDuration,
          ...sourceUpdate,
          ...(cueUpdate ?? {}),
        } as TimelineItem)
      }

      const nextDuration = outPoint - inPoint
      const markersState = useMarkersStore.getState()
      const nextMarkers = markersState.markers
        .map((marker) => ({ ...marker, frame: marker.frame - inPoint }))
        .filter((marker) => marker.frame >= 0 && marker.frame <= nextDuration)

      useItemsStore.getState().setItems(nextItems)
      useKeyframesStore
        .getState()
        .setKeyframes(
          rebaseKeyframesOnTrimmedItems(
            useKeyframesStore.getState().keyframes,
            keptItemIds,
            headTrimByItemId,
          ),
        )
      markersState.setMarkers(nextMarkers)
      const playback = usePlaybackStore.getState()
      playback.setCurrentFrame(
        Math.max(0, Math.min(nextDuration - 1, playback.currentFrame - inPoint)),
      )
      useCompositionsStore
        .getState()
        .updateComposition(compositionId, { durationInFrames: nextDuration })
      // The old absolute points would sit outside the rebased canvas. Publish
      // the new duration first, then keep the I/O affordance active and
      // constrained to that authored range.
      markersState.setInOutPoints(0, nextDuration)
      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { compositionId, inPoint, outPoint },
  )
}
