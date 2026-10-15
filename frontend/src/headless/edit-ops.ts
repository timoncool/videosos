/**
 * Headless edit op handlers.
 *
 * One handler per op kind, dispatched by name from applyOp below. Each body is
 * the previous applyOp switch case, unchanged: the handler validates its op
 * fields, resolves or creates the target through the real timeline stores, and
 * calls the real timeline action. The dispatch table is what keeps applyOp a
 * lookup instead of a 111-branch chain.
 */
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, VideoItem, AudioItem, ImageItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TransformProperties } from '@/types/transform'

import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import {
  addItem,
  addItems,
  updateItem,
  moveItem,
  moveItems,
  removeItems,
  splitItem,
  trimItemStart,
  trimItemEnd,
  addTransition,
  updateTransition,
  removeTransition,
  setTransformParent,
  addKeyframes,
  setTracks,
  addKeyframe,
  removeKeyframesForProperty,
  addEffect,
  removeEffect,
  updateItemTransform,
  addMarker,
  updateMarker,
  removeMarker,
  asOneStep,
} from '@/features/timeline/stores/timeline-actions'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { getLinkedAndAttachedItemIds } from '@/features/timeline/utils/linked-items'
import {
  canAddTransition,
  getMaxTransitionDurationForHandles,
} from '@/features/timeline/utils/transition-utils'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import {
  type EditOp,
  type EditOperationName,
  asNumber,
  asString,
  assertTransitionUpdateApplied,
  buildTextItem,
  buildShapeItem,
  getEditCanvas,
  freeTrackAt,
  getOrCreateTrack,
  newId,
  placementTrack,
  requireItem,
  requireTrack,
  requireTransition,
  sourceFieldsFor,
  tracks,
} from './edit-op-support'

function applyAddText(op: EditOp): unknown {
  const item = buildTextItem(op)
  addItem(item)
  return { id: item.id }
}

function applyAddItem(op: EditOp): unknown {
  const item = op.item as TimelineItem | undefined
  if (!item || typeof item !== 'object') throw new Error('addItem requires `item`')
  const withId: TimelineItem = { ...item, id: item.id || newId() }
  requireTrack(withId.trackId, 'item.trackId')
  addItem(withId)
  return { id: withId.id }
}

function applyUpdateItem(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('updateItem requires `id`')
  requireItem(id)
  const updates = (op.updates ?? {}) as Partial<TimelineItem>
  if (updates.trackId) requireTrack(updates.trackId, 'updates.trackId')
  updateItem(id, updates)
  return { id }
}

function applyMoveItem(op: EditOp): unknown {
  const id = asString(op.id)
  const from = asNumber(op.from)
  if (!id || from === undefined) throw new Error('moveItem requires `id` and `from`')
  const item = requireItem(id)
  const destination = asString(op.trackId)
  if (destination) requireTrack(destination)
  // a clip's linked sound and its captions go with it, as the timeline moves them, unless asked to move it alone
  const companions =
    op.alone === true
      ? []
      : getLinkedAndAttachedItemIds(useItemsStore.getState().items, id).filter(
          (each) => each !== id,
        )
  if (companions.length === 0) {
    moveItem(id, from, destination)
    return { id, from }
  }
  const shift = from - item.from
  const { itemById } = useItemsStore.getState()
  moveItems([
    { id, from, ...(destination && { trackId: destination }) },
    ...companions.map((each) => ({
      id: each,
      from: Math.max(0, itemById[each]!.from + shift),
    })),
  ])
  return { id, from, moved: [id, ...companions] }
}

function applyRemoveItems(op: EditOp): unknown {
  const ids = Array.isArray(op.ids) ? (op.ids.filter((x) => typeof x === 'string') as string[]) : []
  if (ids.length === 0) throw new Error('removeItems requires non-empty `ids`')
  for (const id of ids) requireItem(id, 'ids')
  removeItems(ids)
  return { removed: ids }
}

function applySplit(op: EditOp): unknown {
  const id = asString(op.id)
  const frame = asNumber(op.frame)
  if (!id || frame === undefined) throw new Error('split requires `id` and `frame`')
  requireItem(id)
  const result = splitItem(id, frame)
  if (!result) throw new Error(`split failed for item ${id} at frame ${frame}`)
  return { leftId: result.leftItem.id, rightId: result.rightItem.id }
}

function applyTrimStart(op: EditOp): unknown {
  const id = asString(op.id)
  const amount = asNumber(op.amount)
  if (!id || amount === undefined) throw new Error('trimStart requires `id` and `amount`')
  requireItem(id)
  trimItemStart(id, amount)
  return { id }
}

function applyTrimEnd(op: EditOp): unknown {
  const id = asString(op.id)
  const amount = asNumber(op.amount)
  if (!id || amount === undefined) throw new Error('trimEnd requires `id` and `amount`')
  requireItem(id)
  trimItemEnd(id, amount)
  return { id }
}

/** Apply addTransition's optional `timing` / `properties` overrides to the new transition. */
function applyTransitionOverrides(transitionId: string, op: EditOp): void {
  if (op.timing === undefined && op.properties === undefined) return
  updateTransition(transitionId, {
    ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
    ...(op.properties !== undefined
      ? { properties: op.properties as Transition['properties'] }
      : {}),
  })
}

/** Why the timeline refuses a transition, with what makes it possible, as the person would be told. */
function transitionRefusal(
  left: string,
  right: string,
  duration: number | undefined,
  alignment: number,
): string {
  const { itemById } = useItemsStore.getState()
  const leftClip = itemById[left]!
  const rightClip = itemById[right]!
  const fps = useTimelineSettingsStore.getState().fps
  const length = duration ?? 15
  if (leftClip.trackId !== rightClip.trackId)
    return 'the clips are on different tracks; move them onto one track, end to start'
  if (leftClip.from + leftClip.durationInFrames !== rightClip.from) {
    return `the clips do not meet: the left ends at frame ${leftClip.from + leftClip.durationInFrames}, the right starts at ${rightClip.from}; moveItem the right clip to the left's end`
  }
  if (getMaxTransitionDurationForHandles(leftClip, rightClip, alignment, fps) < 1) {
    return `the clips have no spare frames beyond the cut (a generated clip is used whole); make them first: trimEnd the left clip by -${length} and trimStart the right clip by ${length} (frames), then moveItem the right clip to the left's new end, and add the transition of ${length} frames`
  }
  return (
    canAddTransition(leftClip, rightClip, length, alignment, fps).reason ??
    `the timeline did not take it for clips "${left}" and "${right}"`
  )
}

function applyAddTransition(op: EditOp): unknown {
  const left = asString(op.leftClipId)
  const right = asString(op.rightClipId)
  if (!left || !right) throw new Error('addTransition requires `leftClipId` and `rightClipId`')
  requireItem(left, 'leftClipId')
  requireItem(right, 'rightClipId')
  const added = addTransition(
    left,
    right,
    asString(op.type) as Parameters<typeof addTransition>[2],
    asNumber(op.durationInFrames),
    asString(op.presentation) as Parameters<typeof addTransition>[4],
    asString(op.direction) as Parameters<typeof addTransition>[5],
    asNumber(op.alignment) ?? 0.5,
  )
  if (!added)
    throw new Error(
      `addTransition: ${transitionRefusal(left, right, asNumber(op.durationInFrames), asNumber(op.alignment) ?? 0.5)}`,
    )
  const created = useTransitionsStore
    .getState()
    .transitions.filter((t) => t.leftClipId === left && t.rightClipId === right)
    .at(-1)
  if (created) applyTransitionOverrides(created.id, op)
  return { added, id: created?.id, presentation: created?.presentation }
}

function applyUpdateTransition(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('updateTransition requires `id`')
  requireTransition(id)
  const updates: Parameters<typeof updateTransition>[1] = {
    ...(op.durationInFrames !== undefined
      ? { durationInFrames: asNumber(op.durationInFrames) }
      : {}),
    ...(op.presentation !== undefined
      ? {
          presentation: asString(op.presentation) as Transition['presentation'],
        }
      : {}),
    ...(op.direction !== undefined
      ? { direction: asString(op.direction) as Transition['direction'] }
      : {}),
    ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
    ...(op.alignment !== undefined ? { alignment: asNumber(op.alignment) } : {}),
    ...(op.properties !== undefined
      ? { properties: op.properties as Transition['properties'] }
      : {}),
  }
  if (Object.keys(updates).length === 0)
    throw new Error('updateTransition requires at least one field to change')
  updateTransition(id, updates)
  // The store action validates handles for duration/alignment and, when the
  // requested value doesn't fit, logs a warning and leaves the transition
  // untouched — it returns void, so the rejection is invisible from here.
  // Verify against the resulting state so a rejected edit fails loudly
  // instead of reporting ok with the old value still in place.
  assertTransitionUpdateApplied(id, updates)
  return { id }
}

function applyRemoveTransition(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('removeTransition requires `id`')
  requireTransition(id)
  removeTransition(id)
  return { id }
}

function applyAddShape(op: EditOp): unknown {
  const item = buildShapeItem(op)
  addItem(item)
  return { id: item.id }
}

/** A track's name and switches, as its header in the timeline changes them. */
function applyUpdateTrack(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('updateTrack: id is required')
  const all = tracks()
  const track = all.find((each) => each.id === id)
  if (!track) throw new Error(`updateTrack: no track "${id}"`)
  const changes: Partial<typeof track> = {}
  const name = asString(op.name)
  if (name !== undefined) changes.name = name
  for (const key of ['muted', 'solo', 'locked', 'visible'] as const) {
    if (op[key] === undefined) continue
    if (typeof op[key] !== 'boolean') throw new Error(`updateTrack: ${key} is true or false`)
    changes[key] = op[key]
  }
  const volume = asNumber(op.volume)
  if (volume !== undefined) {
    if (volume < -60 || volume > 12)
      throw new Error('updateTrack: volume is in decibels, from -60 to 12')
    changes.volume = volume
  }
  if (Object.keys(changes).length === 0)
    throw new Error('updateTrack: nothing to change (name, muted, solo, locked, visible, volume)')
  setTracks(all.map((each) => (each.id === id ? { ...each, ...changes } : each)))
  return { trackId: id, ...changes }
}

/** Removes an empty track; its clips are removed first with removeItems, so nothing goes unseen. */
function applyRemoveTrack(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('removeTrack: id is required')
  const all = tracks()
  if (!all.some((each) => each.id === id)) throw new Error(`removeTrack: no track "${id}"`)
  const left = useItemsStore.getState().items.filter((item) => item.trackId === id)
  if (left.length > 0)
    throw new Error(
      `removeTrack: the track still holds ${left.length} clip(s); remove them with removeItems first`,
    )
  setTracks(all.filter((each) => each.id !== id))
  return { removed: id }
}

function applyAddMarker(op: EditOp): unknown {
  const frame = asNumber(op.frame)
  if (frame === undefined || frame < 0) throw new Error('addMarker: frame is required, 0 or more')
  const before = new Set(useMarkersStore.getState().markers.map((marker) => marker.id))
  addMarker(Math.round(frame), asString(op.color), asString(op.label))
  const made = useMarkersStore.getState().markers.find((marker) => !before.has(marker.id))
  if (!made) throw new Error('addMarker: the marker was not made')
  return { id: made.id, frame: made.frame }
}

function applyUpdateMarker(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id || !useMarkersStore.getState().markers.some((marker) => marker.id === id))
    throw new Error(`updateMarker: no marker "${id ?? ''}"`)
  const frame = asNumber(op.frame)
  updateMarker(id, {
    ...(frame !== undefined && { frame: Math.max(0, Math.round(frame)) }),
    ...(asString(op.label) !== undefined && { label: asString(op.label) }),
    ...(asString(op.color) !== undefined && { color: asString(op.color) }),
  })
  return { id }
}

function applyRemoveMarker(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id || !useMarkersStore.getState().markers.some((marker) => marker.id === id))
    throw new Error(`removeMarker: no marker "${id ?? ''}"`)
  removeMarker(id)
  return { removed: id }
}

function applyAddTrack(op: EditOp): unknown {
  const kind = op.kind === 'audio' ? 'audio' : 'video'
  const all = tracks()
  const orders = all.map((t) => t.order)
  const order =
    asNumber(op.order) ??
    (kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1)
  const track = createClassicTrack({ tracks: all, kind, order })
  setTracks([...all, track])
  return { trackId: track.id, name: track.name }
}

/** One entry of addClip's `created` detail. */
type CreatedClip = { id: string; type: string; trackId: string }

/** Everything an addClip placement needs, resolved once by applyAddClip. */
interface ClipPlacement {
  mediaId: string
  media: MediaMetadata
  from: number
  projectFps: number
}

/** Place an `image/` clip: a still on a video track. */
function placeImageClip(op: EditOp, { mediaId, media, from }: ClipPlacement): CreatedClip[] {
  const durationInFrames = asNumber(op.durationInFrames, 150)!
  const item: ImageItem = {
    id: newId(),
    type: 'image',
    trackId: placementTrack(op, 'video', from, durationInFrames),
    from,
    durationInFrames,
    label: media.fileName ?? mediaId,
    mediaId,
    src: '',
    ...(media.width ? { sourceWidth: media.width } : {}),
    ...(media.height ? { sourceHeight: media.height } : {}),
  }
  addItem(item)
  return [{ id: item.id, type: 'image', trackId: item.trackId }]
}

/** Place an `audio/` clip on an audio track. */
function placeAudioClip(
  op: EditOp,
  { mediaId, media, from, projectFps }: ClipPlacement,
): CreatedClip[] {
  const sf = sourceFieldsFor(media, projectFps)
  const durationInFrames =
    asNumber(op.durationInFrames) ?? Math.max(1, Math.round((media.duration ?? 0) * projectFps))
  const item: AudioItem = {
    id: newId(),
    type: 'audio',
    trackId: placementTrack(op, 'audio', from, durationInFrames),
    from,
    durationInFrames,
    label: media.fileName ?? mediaId,
    mediaId,
    src: '',
    volume: 0,
    ...sf,
  }
  addItem(item)
  return [{ id: item.id, type: 'audio', trackId: item.trackId }]
}

/** Place a `video/` clip plus the linked audio companion the app creates on import. */
/**
 * The track of the sound of the clip just before `from` on a video track, when it is free for the new clip's
 * sound: a shot that goes on a sequence keeps its sound beside the sequence's.
 */
function soundTrackBefore(videoTrackId: string, from: number, durationInFrames: number) {
  const items = useItemsStore.getState().items
  const before = items
    .filter(
      (item) =>
        item.trackId === videoTrackId &&
        item.type === 'video' &&
        item.linkedGroupId &&
        item.from + item.durationInFrames <= from,
    )
    .sort((a, b) => b.from + b.durationInFrames - (a.from + a.durationInFrames))[0]
  const sound = before
    ? items.find((item) => item.type === 'audio' && item.linkedGroupId === before.linkedGroupId)
    : undefined
  if (!sound) return undefined
  const busy = items.some(
    (item) =>
      item.trackId === sound.trackId &&
      item.from < from + durationInFrames &&
      from < item.from + item.durationInFrames,
  )
  return busy ? undefined : sound.trackId
}

function placeVideoClip(
  op: EditOp,
  { mediaId, media, from, projectFps }: ClipPlacement,
): CreatedClip[] {
  const sf = sourceFieldsFor(media, projectFps)
  const durationInFrames =
    asNumber(op.durationInFrames) ?? Math.max(1, Math.round((media.duration ?? 0) * projectFps))
  const label = media.fileName ?? mediaId
  const linkedGroupId = crypto.randomUUID()
  const video: VideoItem = {
    id: newId(),
    type: 'video',
    trackId: placementTrack(op, 'video', from, durationInFrames),
    from,
    durationInFrames,
    label,
    mediaId,
    src: '',
    volume: 0,
    linkedGroupId,
    ...(media.width ? { sourceWidth: media.width } : {}),
    ...(media.height ? { sourceHeight: media.height } : {}),
    ...sf,
  }
  const created: CreatedClip[] = [{ id: video.id, type: 'video', trackId: video.trackId }]
  // Linked audio companion (as the app creates on import) so audio renders.
  if (!media.audioCodec) {
    addItem(video)
    return created
  }
  const audio: AudioItem = {
    id: newId(),
    type: 'audio',
    trackId:
      op.keepFrom === true
        ? (soundTrackBefore(video.trackId, from, durationInFrames) ??
          freeTrackAt('audio', from, durationInFrames))
        : getOrCreateTrack('audio'),
    from,
    durationInFrames,
    label: `${label} audio`,
    mediaId,
    src: '',
    volume: 0,
    linkedGroupId,
    ...sf,
  }
  addItems([video, audio])
  created.push({ id: audio.id, type: 'audio', trackId: audio.trackId })
  return created
}

function applyAddClip(op: EditOp): unknown {
  const mediaId = asString(op.mediaId)
  if (!mediaId) throw new Error('addClip requires `mediaId`')
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) {
    throw new Error(`addClip: no metadata for media ${mediaId} (pass it via the CLI's media list)`)
  }
  const placement: ClipPlacement = {
    mediaId,
    media,
    from: asNumber(op.from, 0)!,
    projectFps: useTimelineSettingsStore.getState().fps || 30,
  }
  if (media.mimeType.startsWith('image/')) return { created: placeImageClip(op, placement) }
  if (media.mimeType.startsWith('audio/')) return { created: placeAudioClip(op, placement) }
  if (media.mimeType.startsWith('video/')) return { created: placeVideoClip(op, placement) }
  throw new Error(`addClip: unsupported media mimeType ${media.mimeType}`)
}

/**
 * Another media item of the library in a clip's place, as a take of the same request: the clip keeps its start, its
 * in-point and its length as far as the new media reaches, and the clips linked to it on the same media (a video's
 * sound) change with it.
 */
function applyReplaceMedia(op: EditOp): unknown {
  const id = asString(op.id)
  const mediaId = asString(op.mediaId)
  if (!id || !mediaId) throw new Error('replaceMedia requires `id` and `mediaId`')
  const clip = requireItem(id)
  if (!clip.mediaId) throw new Error(`replaceMedia: ${id} is not a clip of a media item`)
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) throw new Error(`replaceMedia: no media ${mediaId} in the library`)
  const projectFps = useTimelineSettingsStore.getState().fps || 30
  const { items } = useItemsStore.getState()
  const group = clip.linkedGroupId
    ? items.filter(
        (item) => item.linkedGroupId === clip.linkedGroupId && item.mediaId === clip.mediaId,
      )
    : [clip]
  const sf = sourceFieldsFor(media, projectFps)
  asOneStep('REPLACE_MEDIA', () => {
    for (const item of group) {
      if (item.type === 'image') {
        updateItem(item.id, {
          mediaId,
          label: media.fileName ?? mediaId,
          src: '',
          thumbnailUrl: undefined,
        } as Partial<TimelineItem>)
        continue
      }
      const speed =
        'speed' in item && typeof item.speed === 'number' && item.speed > 0 ? item.speed : 1
      const inPoint = Math.min(item.sourceStart ?? 0, Math.max(0, sf.sourceDuration - 1))
      const reach = Math.floor(((sf.sourceDuration - inPoint) / sf.sourceFps / speed) * projectFps)
      const durationInFrames = Math.max(1, Math.min(item.durationInFrames, reach))
      updateItem(item.id, {
        mediaId,
        label:
          item.type === 'audio' && clip.type === 'video'
            ? `${media.fileName ?? mediaId} audio`
            : (media.fileName ?? mediaId),
        src: '',
        sourceFps: sf.sourceFps,
        sourceStart: inPoint,
        sourceEnd: inPoint + Math.round((durationInFrames / projectFps) * sf.sourceFps * speed),
        sourceDuration: sf.sourceDuration,
        durationInFrames,
        ...(item.type === 'audio' ? { waveformData: undefined } : { thumbnailUrl: undefined }),
      } as Partial<TimelineItem>)
    }
  })
  return { id, replaced: group.map((item) => item.id) }
}

function applyAddKeyframe(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  const property = asString(op.property)
  const frame = asNumber(op.frame)
  const value = asNumber(op.value)
  if (!itemId || !property || frame === undefined || value === undefined) {
    throw new Error('addKeyframe requires `itemId`, `property`, `frame`, `value`')
  }
  requireItem(itemId, 'itemId')
  const easing = asString(op.easing) as EasingType | undefined
  // easingConfig (e.g. custom spring tension/friction/mass) goes through the
  // batch action — the scalar addKeyframe action does not accept it.
  const keyframeId = op.easingConfig
    ? (addKeyframes([
        {
          itemId,
          property: property as AnimatableProperty,
          frame,
          value,
          easing,
          easingConfig: op.easingConfig as Parameters<
            typeof addKeyframes
          >[0][number]['easingConfig'],
        },
      ])[0] ?? '')
    : addKeyframe(itemId, property as AnimatableProperty, frame, value, easing)
  if (!keyframeId) throw new Error(`addKeyframe failed (item ${itemId} @ frame ${frame})`)
  return { keyframeId }
}

/** Resolve setTransformParent's target: `undefined` detaches, a string attaches to that item. */
function resolveTransformParent(op: EditOp): string | undefined {
  if (op.parentItemId === null) return undefined
  const parentItemId = asString(op.parentItemId)
  if (!parentItemId) {
    throw new Error(
      'setTransformParent requires `parentItemId` (item id to attach, null to detach)',
    )
  }
  requireItem(parentItemId, 'parentItemId')
  return parentItemId
}

function applySetTransformParent(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('setTransformParent requires `id`')
  const child = requireItem(id)
  const parentItemId = resolveTransformParent(op)
  const ok = setTransformParent({
    childItemId: id,
    ...(parentItemId ? { parentItemId } : {}),
    behavior: asString(op.behavior) as Parameters<typeof setTransformParent>[0]['behavior'],
    frame: asNumber(op.frame) ?? child.from,
    canvas: getEditCanvas(),
  })
  if (!ok) {
    throw new Error(
      `setTransformParent failed for "${id}"${parentItemId ? ` -> "${parentItemId}"` : ' (detach)'}`,
    )
  }
  return { id, parentItemId: parentItemId ?? null }
}

function applyRemoveKeyframes(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  const property = asString(op.property)
  if (!itemId || !property) throw new Error('removeKeyframes requires `itemId` and `property`')
  requireItem(itemId, 'itemId')
  removeKeyframesForProperty(itemId, property as AnimatableProperty)
  return { itemId, property }
}

function applyAddEffect(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  if (!itemId) throw new Error('addEffect requires `itemId`')
  requireItem(itemId, 'itemId')
  const effect =
    op.effect && typeof op.effect === 'object'
      ? op.effect
      : op.gpuEffectType
        ? {
            type: 'gpu-effect',
            gpuEffectType: op.gpuEffectType,
            params: op.params ?? {},
          }
        : null
  if (!effect) throw new Error('addEffect requires `effect` or `gpuEffectType`')
  const gpuEffectType = (effect as { gpuEffectType?: unknown }).gpuEffectType
  if (typeof gpuEffectType !== 'string' || !getGpuEffect(gpuEffectType)) {
    throw new Error(`gpuEffectType: unknown GPU effect "${String(gpuEffectType)}"`)
  }
  addEffect(itemId, effect as VisualEffect)
  return { itemId }
}

function applyRemoveEffect(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  const effectId = asString(op.effectId)
  if (!itemId || !effectId) throw new Error('removeEffect requires `itemId` and `effectId`')
  const item = requireItem(itemId, 'itemId')
  if (!item.effects?.some((candidate) => candidate.id === effectId)) {
    throw new Error(`effectId: effect "${effectId}" does not exist on item "${itemId}"`)
  }
  removeEffect(itemId, effectId)
  return { itemId, effectId }
}

function applySetTransform(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id || !op.transform || typeof op.transform !== 'object') {
    throw new Error('setTransform requires `id` and `transform`')
  }
  requireItem(id)
  updateItemTransform(id, op.transform as Partial<TransformProperties>)
  return { id }
}

const OP_HANDLERS: Record<EditOperationName, (op: EditOp) => unknown> = {
  addText: applyAddText,
  addItem: applyAddItem,
  updateItem: applyUpdateItem,
  moveItem: applyMoveItem,
  removeItems: applyRemoveItems,
  split: applySplit,
  trimStart: applyTrimStart,
  trimEnd: applyTrimEnd,
  addTransition: applyAddTransition,
  updateTransition: applyUpdateTransition,
  removeTransition: applyRemoveTransition,
  addTrack: applyAddTrack,
  addClip: applyAddClip,
  replaceMedia: applyReplaceMedia,
  addKeyframe: applyAddKeyframe,
  setTransformParent: applySetTransformParent,
  removeKeyframes: applyRemoveKeyframes,
  addEffect: applyAddEffect,
  removeEffect: applyRemoveEffect,
  setTransform: applySetTransform,
  addShape: applyAddShape,
  updateTrack: applyUpdateTrack,
  removeTrack: applyRemoveTrack,
  addMarker: applyAddMarker,
  updateMarker: applyUpdateMarker,
  removeMarker: applyRemoveMarker,
}

/** Apply a single op by driving the real timeline action modules. Throws on bad input. */
export function applyOp(op: EditOp): unknown {
  const handler = OP_HANDLERS[op.op]
  if (!Object.hasOwn(OP_HANDLERS, op.op) || !handler) {
    throw new Error(`Unknown edit op: ${String(op.op)}`)
  }
  return handler(op)
}
