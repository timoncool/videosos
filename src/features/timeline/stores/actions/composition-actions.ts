/**
 * Composition Actions — create, dissolve, and manage pre-compositions.
 */

import type { AudioItem, TimelineItem, TimelineTrack, CompositionItem } from '@/types/timeline'
import {
  createClassicTrack,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getTrackKind,
  type TrackKind,
} from '../../utils/classic-tracks'
import { mapSourceWindowOverlap, timelineToSourceFrames } from '../../utils/source-calculations'
import { getCompositionOwnedAudioSources } from '../../utils/composition-clip-summary'
import { expandSelectionWithLinkedItems } from '../../utils/linked-items'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useCompositionsStore, type SubComposition } from '../compositions-store'
import { useSequencesStore } from '../sequences-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_TRACK_HEIGHT } from '../../constants'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useCompositionNavigationStore, getActiveTabId } from '../composition-navigation-store'
import { useProjectStore } from '@/features/timeline/deps/projects'
import {
  getLinkedCompositionAudioCompanion,
  getLinkedCompositionVisualCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media'
import {
  getDirectReferencedCompositionIds,
  wouldCreateCompositionCycle,
} from '../../utils/composition-graph'
import {
  applyTransitionRepairs,
  computeCompositionDuration,
  execute,
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  getRootTimelineSnapshot,
  type TimelineSnapshotLike,
} from './shared'

function getTrackKindForSelectedItems(
  track: TimelineTrack | undefined,
  trackItems: TimelineItem[],
): TrackKind {
  return (
    getTrackKind(
      track ?? {
        id: '',
        name: '',
        height: DEFAULT_TRACK_HEIGHT,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ) ?? (trackItems.every((item) => item.type === 'audio') ? 'audio' : 'video')
  )
}

function hasCompositionVisualItems(items: TimelineItem[]): boolean {
  return items.some((item) => item.type !== 'audio')
}

function buildCompoundWrapperSourceFields(composition: SubComposition) {
  return {
    sourceStart: 0,
    sourceEnd: composition.durationInFrames,
    sourceDuration: composition.durationInFrames,
    sourceFps: composition.fps,
    speed: 1,
  }
}

function expandSelectionWithCompoundClipCompanions(
  items: TimelineItem[],
  selectedIds: readonly string[],
): string[] {
  const expandedIds = new Set(selectedIds)

  for (const item of items) {
    if (!expandedIds.has(item.id)) continue

    if (item.type === 'composition') {
      const companion = getLinkedCompositionAudioCompanion(items, item)
      if (companion) {
        expandedIds.add(companion.id)
      }
      continue
    }

    if (isCompositionAudioItem(item)) {
      const companion = getLinkedCompositionVisualCompanion(items, item)
      if (companion) {
        expandedIds.add(companion.id)
      }
    }
  }

  return Array.from(expandedIds)
}

export interface CompoundClipDeletionImpact {
  rootReferenceCount: number
  nestedReferenceCount: number
  totalReferenceCount: number
}

function renameCompositionReferences(
  items: TimelineItem[],
  compositionId: string,
  nextLabel: string,
): TimelineItem[] {
  const targetIds = new Set([compositionId])
  let changed = false
  const renamedItems = items.map((item) => {
    if (!isCompoundClipReference(item, targetIds)) {
      return item
    }
    if (item.label === nextLabel) {
      return item
    }
    changed = true
    return {
      ...item,
      label: nextLabel,
    }
  })

  return changed ? renamedItems : items
}

function isCompoundClipReference(item: TimelineItem, targetIds: ReadonlySet<string>): boolean {
  return (
    !!item.compositionId &&
    (item.type === 'composition' || isCompositionAudioItem(item)) &&
    targetIds.has(item.compositionId)
  )
}

function countCompoundClipReferences(
  items: TimelineItem[],
  targetIds: ReadonlySet<string>,
): number {
  return items.filter((item) => isCompoundClipReference(item, targetIds)).length
}

function sanitizeTimelineSnapshot<TSnapshot extends TimelineSnapshotLike>(
  snapshot: TSnapshot,
  targetIds: ReadonlySet<string>,
): TSnapshot & { removedItemIds: string[] } {
  const removedItemIds = snapshot.items
    .filter((item) => isCompoundClipReference(item, targetIds))
    .map((item) => item.id)

  if (removedItemIds.length === 0) {
    return {
      ...snapshot,
      removedItemIds,
    }
  }

  const removedIdSet = new Set(removedItemIds)
  return {
    ...snapshot,
    items: snapshot.items.filter((item) => !removedIdSet.has(item.id)),
    transitions: snapshot.transitions.filter(
      (transition) =>
        !removedIdSet.has(transition.leftClipId) && !removedIdSet.has(transition.rightClipId),
    ),
    keyframes: snapshot.keyframes.filter((keyframe) => !removedIdSet.has(keyframe.itemId)),
    removedItemIds,
  }
}

export function getCompoundClipDeletionImpact(
  compositionIds: string[],
): CompoundClipDeletionImpact {
  const targetIds = new Set(compositionIds.filter(Boolean))
  if (targetIds.size === 0) {
    return {
      rootReferenceCount: 0,
      nestedReferenceCount: 0,
      totalReferenceCount: 0,
    }
  }

  const currentSnapshot = getCurrentTimelineSnapshot()
  const rootReferenceCount = countCompoundClipReferences(
    getRootTimelineSnapshot(currentSnapshot).items,
    targetIds,
  )
  const nestedReferenceCount = getEffectiveCompositions(currentSnapshot)
    .filter((composition) => !targetIds.has(composition.id))
    .reduce(
      (count, composition) => count + countCompoundClipReferences(composition.items, targetIds),
      0,
    )

  return {
    rootReferenceCount,
    nestedReferenceCount,
    totalReferenceCount: rootReferenceCount + nestedReferenceCount,
  }
}

export function renameCompoundClip(compositionId: string, nextName: string): boolean {
  const trimmedName = nextName.trim()
  if (!compositionId || !trimmedName) return false

  return execute(
    'RENAME_COMPOUND_CLIP',
    () => {
      const composition = useCompositionsStore.getState().getComposition(compositionId)
      if (!composition || composition.name === trimmedName) {
        return false
      }

      useCompositionsStore.getState().updateComposition(compositionId, { name: trimmedName })

      const currentSnapshot = getCurrentTimelineSnapshot()
      const renamedCurrentItems = renameCompositionReferences(
        currentSnapshot.items,
        compositionId,
        trimmedName,
      )
      if (renamedCurrentItems !== currentSnapshot.items) {
        useItemsStore.getState().setItems(renamedCurrentItems)
      }

      const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
      const nextCompositions = useCompositionsStore.getState().compositions.map((entry) => {
        if (entry.id === compositionId) {
          return entry
        }

        const sourceItems = entry.id === activeCompositionId ? renamedCurrentItems : entry.items
        const renamedItems = renameCompositionReferences(sourceItems, compositionId, trimmedName)
        return renamedItems === sourceItems
          ? entry
          : {
              ...entry,
              items: renamedItems,
            }
      })
      useCompositionsStore.getState().setCompositions(nextCompositions)

      useCompositionNavigationStore.setState((state) => ({
        breadcrumbs: state.breadcrumbs.map((breadcrumb) =>
          breadcrumb.compositionId === compositionId
            ? { ...breadcrumb, label: trimmedName }
            : breadcrumb,
        ),
        stashStack: state.stashStack.map((stash) => ({
          ...stash,
          items: renameCompositionReferences(stash.items, compositionId, trimmedName),
        })),
        // Keep Main (held aside on a sequence tab) consistent with the rename.
        mainHolder: state.mainHolder
          ? {
              ...state.mainHolder,
              items: renameCompositionReferences(
                state.mainHolder.items,
                compositionId,
                trimmedName,
              ),
            }
          : null,
      }))

      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { compositionId, nextName: trimmedName },
  )
}

function mapRestoredTrackGroup(params: {
  subTracks: TimelineTrack[]
  subItems: TimelineItem[]
  anchorTrackId: string | null
  kind: TrackKind
  compFrom: number
  existingTracks: TimelineTrack[]
  currentItems: TimelineItem[]
  trackIdMapping: Map<string, string>
  newTracks: TimelineTrack[]
}): void {
  const {
    subTracks,
    subItems,
    anchorTrackId,
    kind,
    compFrom,
    existingTracks,
    currentItems,
    trackIdMapping,
    newTracks,
  } = params
  if (subTracks.length === 0 || !anchorTrackId) return

  const sortedSubTracks = [...subTracks].sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0),
  )
  const anchorTrack = [...existingTracks, ...newTracks].find((track) => track.id === anchorTrackId)
  if (!anchorTrack) return

  const usedTrackIds = new Set<string>(trackIdMapping.values())
  const lastIdx = sortedSubTracks.length - 1
  trackIdMapping.set(sortedSubTracks[lastIdx]!.id, anchorTrackId)
  usedTrackIds.add(anchorTrackId)

  const candidatesAbove = [...existingTracks, ...newTracks]
    .filter((track) => track.id !== anchorTrackId && getTrackKind(track) === kind)
    .filter((track) => (track.order ?? 0) < (anchorTrack.order ?? 0))
    .sort((left, right) => (right.order ?? 0) - (left.order ?? 0))

  for (let i = lastIdx - 1; i >= 0; i -= 1) {
    const subTrack = sortedSubTracks[i]!
    const restoredRanges = subItems
      .filter((item) => item.trackId === subTrack.id)
      .map((item) => ({
        from: item.from + compFrom,
        end: item.from + compFrom + item.durationInFrames,
      }))

    let foundTrackId: string | null = null
    for (const candidate of candidatesAbove) {
      if (usedTrackIds.has(candidate.id)) continue

      const existingOnTrack = currentItems.filter((item) => item.trackId === candidate.id)
      const overlaps = existingOnTrack.some((existing) => {
        const existingEnd = existing.from + existing.durationInFrames
        return restoredRanges.some((range) => range.from < existingEnd && existing.from < range.end)
      })

      if (!overlaps) {
        foundTrackId = candidate.id
        usedTrackIds.add(candidate.id)
        break
      }
    }

    if (foundTrackId) {
      trackIdMapping.set(subTrack.id, foundTrackId)
      continue
    }

    const distanceFromBottom = lastIdx - i
    const newTrackId = crypto.randomUUID()
    trackIdMapping.set(subTrack.id, newTrackId)
    usedTrackIds.add(newTrackId)
    newTracks.push({
      ...subTrack,
      id: newTrackId,
      kind,
      order: (anchorTrack.order ?? 0) - distanceFromBottom * 0.01,
    })
  }
}

function mapSubCompItemToWrapperWindow(params: {
  subItem: TimelineItem
  wrapper: CompositionItem | (AudioItem & { compositionId: string })
  timelineFps: number
  subCompFps: number
}): TimelineItem | null {
  const { subItem, wrapper, timelineFps, subCompFps } = params
  const wrapperSourceStart = wrapper.sourceStart ?? wrapper.trimStart ?? 0
  const mapping = mapSourceWindowOverlap({
    itemStart: subItem.from,
    itemDuration: subItem.durationInFrames,
    wrapperDuration: wrapper.durationInFrames,
    wrapperSpeed: wrapper.speed,
    wrapperSourceFps: wrapper.sourceFps,
    wrapperSourceStart,
    wrapperSourceEnd: wrapper.sourceEnd,
    timelineFps,
    fallbackSourceFps: subCompFps,
  })

  if (!mapping) return null

  const mappedFrom = wrapper.from + mapping.mappedFrom
  const mappedItem: TimelineItem = {
    ...subItem,
    from: mappedFrom,
    durationInFrames: mapping.mappedDuration,
    speed: (subItem.speed ?? 1) * mapping.wrapperSpeed,
  }

  if (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'composition') {
    const childSourceFps = subItem.sourceFps ?? subCompFps
    const childSpeed = subItem.speed ?? 1
    const nextSourceStart =
      (subItem.sourceStart ?? 0) +
      timelineToSourceFrames(mapping.clippedStartFrames, childSpeed, subCompFps, childSourceFps)

    mappedItem.sourceStart = nextSourceStart
    if (subItem.sourceEnd !== undefined) {
      mappedItem.sourceEnd = Math.max(
        nextSourceStart + 1,
        subItem.sourceEnd -
          timelineToSourceFrames(mapping.clippedEndFrames, childSpeed, subCompFps, childSourceFps),
      )
    }
  }

  return mappedItem
}

/**
 * Create a pre-composition from the currently selected items.
 *
 * 1. Calculates bounding box of selected items (earliest from, latest end).
 * 2. Creates a SubComposition with repositioned items (starting at frame 0).
 * 3. Creates tracks within the sub-composition.
 * 4. Removes original items from the main timeline.
 * 5. Inserts linked compound wrappers on the target video/audio lanes.
 *
 * Supports nested compound clips, but prevents circular composition references.
 */
interface CreatePreCompOptions {
  editorKind?: SubComposition['editorKind']
  openAfterCreate?: boolean
}

type CompositionLookup = ReturnType<typeof useCompositionsStore.getState>['compositionById']

interface CreatePreCompContext extends TimelineSnapshotLike {
  fps: number
  selectedIds: string[]
  selectedItems: TimelineItem[]
  activeCompositionId: string | null
  compositionById: CompositionLookup
}

interface BuiltPreComp {
  composition: SubComposition
  minFrom: number
  durationInFrames: number
  selectedItemIds: Set<string>
  sourceTrackIds: string[]
}

interface PreCompWrapperPlan {
  hasVisualWrapper: boolean
  hasOwnedAudio: boolean
  visualTargetTrackId: string | null
  audioTargetTrackId: string | null
  tracks: TimelineTrack[]
}

function getPreCompSelectedIds(
  items: TimelineItem[],
  requestedIds: string[],
  linkedSelectionEnabled: boolean,
): string[] {
  const baseIds = linkedSelectionEnabled
    ? expandSelectionWithLinkedItems(items, requestedIds)
    : Array.from(new Set(requestedIds))
  return expandSelectionWithCompoundClipCompanions(items, baseIds)
}

function wouldCreateSelectedCompositionCycle(
  selectedItems: TimelineItem[],
  activeCompositionId: string | null,
  compositionById: CompositionLookup,
): boolean {
  if (activeCompositionId === null) return false
  return getDirectReferencedCompositionIds(selectedItems).some((compositionId) =>
    wouldCreateCompositionCycle({
      parentCompositionId: activeCompositionId,
      insertedCompositionId: compositionId,
      compositionById,
    }),
  )
}

function getCreatePreCompContext(itemIds?: string[]): CreatePreCompContext | null {
  const { items, tracks } = useItemsStore.getState()
  const transitions = useTransitionsStore.getState().transitions
  const keyframes = useKeyframesStore.getState().keyframes
  const fps = useTimelineSettingsStore.getState().fps
  const requestedIds = itemIds ?? useSelectionStore.getState().selectedItemIds
  const selectedIds = getPreCompSelectedIds(
    items,
    requestedIds,
    useEditorStore.getState().linkedSelectionEnabled,
  )
  if (selectedIds.length === 0) return null
  const selectedIdSet = new Set(selectedIds)
  const selectedItems = items.filter((item) => selectedIdSet.has(item.id))
  if (selectedItems.length === 0) return null
  const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
  const compositionById = useCompositionsStore.getState().compositionById
  if (wouldCreateSelectedCompositionCycle(selectedItems, activeCompositionId, compositionById)) {
    return null
  }
  return {
    items,
    tracks,
    transitions,
    keyframes,
    fps,
    selectedIds,
    selectedItems,
    activeCompositionId,
    compositionById,
  }
}

function getPreCompBounds(selectedItems: TimelineItem[]) {
  const minFrom = Math.min(...selectedItems.map((item) => item.from))
  const maxEnd = Math.max(...selectedItems.map((item) => item.from + item.durationInFrames))
  return { minFrom, durationInFrames: maxEnd - minFrom }
}

function getPreCompCanvas() {
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
    backgroundColor: metadata?.backgroundColor,
  }
}

function createSubCompTrack(
  trackId: string,
  index: number,
  sourceTrack: TimelineTrack | undefined,
  trackItems: TimelineItem[],
): TimelineTrack {
  const baseTrack: TimelineTrack = sourceTrack ?? {
    id: trackId,
    name: `Track ${index + 1}`,
    kind: getTrackKindForSelectedItems(undefined, trackItems),
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: index,
    items: [],
  }
  return {
    id: crypto.randomUUID(),
    name: baseTrack.name,
    kind: getTrackKindForSelectedItems(sourceTrack, trackItems),
    height: baseTrack.height,
    locked: false,
    visible: baseTrack.visible,
    muted: baseTrack.muted,
    solo: baseTrack.solo,
    volume: baseTrack.volume,
    color: baseTrack.color,
    order: index,
    items: [],
  }
}

function buildSubCompTracks(selectedItems: TimelineItem[], tracks: TimelineTrack[]) {
  const sourceTrackMap = new Map(tracks.map((track) => [track.id, track]))
  const sourceTrackIds = [...new Set(selectedItems.map((item) => item.trackId))].sort(
    (leftId, rightId) =>
      (sourceTrackMap.get(leftId)?.order ?? 0) - (sourceTrackMap.get(rightId)?.order ?? 0),
  )
  const subCompTracks = sourceTrackIds.map((trackId, index) =>
    createSubCompTrack(
      trackId,
      index,
      sourceTrackMap.get(trackId),
      selectedItems.filter((item) => item.trackId === trackId),
    ),
  )
  const trackIdMapping = new Map<string, string>()
  sourceTrackIds.forEach((trackId, index) => {
    trackIdMapping.set(trackId, subCompTracks[index]!.id)
  })
  return { sourceTrackIds, subCompTracks, trackIdMapping }
}

function buildSubCompItems(
  selectedItems: TimelineItem[],
  minFrom: number,
  trackIdMapping: Map<string, string>,
  fallbackTrackId: string,
) {
  const items = selectedItems.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    from: item.from - minFrom,
    trackId: trackIdMapping.get(item.trackId) ?? fallbackTrackId,
  }))
  const itemIdMapping = new Map<string, string>()
  selectedItems.forEach((item, index) => itemIdMapping.set(item.id, items[index]!.id))
  return { items, itemIdMapping }
}

function buildSubCompTransitions(
  transitions: TimelineSnapshotLike['transitions'],
  selectedItemIds: Set<string>,
  itemIdMapping: Map<string, string>,
  trackIdMapping: Map<string, string>,
) {
  return transitions
    .filter(
      (transition) =>
        selectedItemIds.has(transition.leftClipId) && selectedItemIds.has(transition.rightClipId),
    )
    .map((transition) => ({
      ...transition,
      id: crypto.randomUUID(),
      leftClipId: itemIdMapping.get(transition.leftClipId) ?? transition.leftClipId,
      rightClipId: itemIdMapping.get(transition.rightClipId) ?? transition.rightClipId,
      trackId: trackIdMapping.get(transition.trackId) ?? transition.trackId,
    }))
}

function buildSubCompKeyframes(
  keyframes: TimelineSnapshotLike['keyframes'],
  selectedItemIds: Set<string>,
  itemIdMapping: Map<string, string>,
) {
  return keyframes
    .filter((itemKeyframes) => selectedItemIds.has(itemKeyframes.itemId))
    .map((itemKeyframes) => ({
      ...itemKeyframes,
      itemId: itemIdMapping.get(itemKeyframes.itemId) ?? itemKeyframes.itemId,
    }))
}

function getPreCompEditorKind(
  options: CreatePreCompOptions,
  activeCompositionId: string | null,
): SubComposition['editorKind'] {
  if (options.editorKind) return options.editorKind
  if (activeCompositionId === null) return 'sequence'
  const activeComposition = useCompositionsStore.getState().getComposition(activeCompositionId)
  return activeComposition?.editorKind === 'composite-2d' ? 'composite-2d' : 'sequence'
}

function buildPreComp(
  context: CreatePreCompContext,
  name: string | undefined,
  options: CreatePreCompOptions,
): BuiltPreComp {
  const { minFrom, durationInFrames } = getPreCompBounds(context.selectedItems)
  const canvas = getPreCompCanvas()
  const { sourceTrackIds, subCompTracks, trackIdMapping } = buildSubCompTracks(
    context.selectedItems,
    context.tracks,
  )
  const { items: subCompItems, itemIdMapping } = buildSubCompItems(
    context.selectedItems,
    minFrom,
    trackIdMapping,
    subCompTracks[0]!.id,
  )
  const selectedItemIds = new Set(context.selectedIds)
  const composition: SubComposition = {
    id: crypto.randomUUID(),
    name: name ?? `Compound Clip ${useCompositionsStore.getState().compositions.length + 1}`,
    editorKind: getPreCompEditorKind(options, context.activeCompositionId),
    items: subCompItems,
    tracks: subCompTracks,
    transitions: buildSubCompTransitions(
      context.transitions,
      selectedItemIds,
      itemIdMapping,
      trackIdMapping,
    ),
    keyframes: buildSubCompKeyframes(context.keyframes, selectedItemIds, itemIdMapping),
    fps: context.fps,
    width: canvas.width,
    height: canvas.height,
    durationInFrames,
    backgroundColor: canvas.backgroundColor,
  }
  return { composition, minFrom, durationInFrames, selectedItemIds, sourceTrackIds }
}

function getSourceTrackIdsForMediaType(
  sourceTrackIds: string[],
  selectedItems: TimelineItem[],
  type: 'visual' | 'audio',
): string[] {
  return sourceTrackIds.filter((trackId) =>
    selectedItems.some((item) =>
      type === 'audio'
        ? item.trackId === trackId && item.type === 'audio'
        : item.trackId === trackId && item.type !== 'audio',
    ),
  )
}

function findVisualTargetTrack(
  tracks: TimelineTrack[],
  visualTargetTrackId: string | null,
): TimelineTrack | null {
  if (!visualTargetTrackId) return null
  return tracks.find((track) => track.id === visualTargetTrackId) ?? null
}

function findAvailableAudioTrack(
  tracks: TimelineTrack[],
  visualTargetTrack: TimelineTrack | null,
): TimelineTrack | null {
  if (visualTargetTrack) {
    return findNearestTrackByKind({
      tracks,
      targetTrack: visualTargetTrack,
      kind: 'audio',
      direction: 'below',
    })
  }
  return (
    tracks
      .filter((track) => !track.isGroup)
      .filter((track) => getTrackKind(track) === 'audio')
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .at(-1) ?? null
  )
}

function createAudioWrapperTrack(tracks: TimelineTrack[], visualTargetTrack: TimelineTrack | null) {
  const fallbackTrack = visualTargetTrack ?? tracks.at(-1) ?? null
  const order = fallbackTrack ? getAdjacentTrackOrder(tracks, fallbackTrack, 'below') : 0
  return createClassicTrack({
    tracks,
    kind: 'audio',
    order,
    height: fallbackTrack?.height ?? DEFAULT_TRACK_HEIGHT,
  })
}

function resolveAudioWrapperTrack(params: {
  tracks: TimelineTrack[]
  hasOwnedAudio: boolean
  audioSourceTrackIds: string[]
  visualTargetTrackId: string | null
}): { tracks: TimelineTrack[]; audioTargetTrackId: string | null } {
  if (!params.hasOwnedAudio) return { tracks: params.tracks, audioTargetTrackId: null }
  const sourceTrackId = params.audioSourceTrackIds.at(-1) ?? null
  if (sourceTrackId) return { tracks: params.tracks, audioTargetTrackId: sourceTrackId }
  const visualTargetTrack = findVisualTargetTrack(params.tracks, params.visualTargetTrackId)
  const availableTrack = findAvailableAudioTrack(params.tracks, visualTargetTrack)
  if (availableTrack) return { tracks: params.tracks, audioTargetTrackId: availableTrack.id }
  const createdTrack = createAudioWrapperTrack(params.tracks, visualTargetTrack)
  return {
    tracks: [...params.tracks, createdTrack],
    audioTargetTrackId: createdTrack.id,
  }
}

function buildPreCompWrapperPlan(
  context: CreatePreCompContext,
  built: BuiltPreComp,
): PreCompWrapperPlan {
  const hasVisualWrapper = hasCompositionVisualItems(built.composition.items)
  const hasOwnedAudio =
    getCompositionOwnedAudioSources({
      items: built.composition.items,
      tracks: built.composition.tracks,
      fps: context.fps,
      compositionById: context.compositionById,
    }).length > 0
  const visualSourceTrackIds = getSourceTrackIdsForMediaType(
    built.sourceTrackIds,
    context.selectedItems,
    'visual',
  )
  const audioSourceTrackIds = getSourceTrackIdsForMediaType(
    built.sourceTrackIds,
    context.selectedItems,
    'audio',
  )
  const visualTargetTrackId = hasVisualWrapper ? (visualSourceTrackIds.at(-1) ?? null) : null
  const audio = resolveAudioWrapperTrack({
    tracks: context.tracks,
    hasOwnedAudio,
    audioSourceTrackIds,
    visualTargetTrackId,
  })
  return {
    hasVisualWrapper,
    hasOwnedAudio,
    visualTargetTrackId,
    audioTargetTrackId: audio.audioTargetTrackId,
    tracks: audio.tracks,
  }
}

function removePreCompSourceItems(context: CreatePreCompContext, built: BuiltPreComp): void {
  useItemsStore.getState()._removeItems(context.selectedIds)
  useTransitionsStore
    .getState()
    .setTransitions(
      context.transitions.filter(
        (transition) =>
          !built.selectedItemIds.has(transition.leftClipId) &&
          !built.selectedItemIds.has(transition.rightClipId),
      ),
    )
  useKeyframesStore.getState()._removeKeyframesForItems(context.selectedIds)
}

function createVisualPreCompWrapper(
  built: BuiltPreComp,
  enabled: boolean,
  trackId: string | null,
  linkedGroupId: string | undefined,
): CompositionItem | null {
  if (!enabled || !trackId) return null
  return {
    id: crypto.randomUUID(),
    type: 'composition',
    trackId,
    from: built.minFrom,
    durationInFrames: built.durationInFrames,
    label: built.composition.name,
    compositionId: built.composition.id,
    linkedGroupId,
    compositionWidth: built.composition.width,
    compositionHeight: built.composition.height,
    transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    ...buildCompoundWrapperSourceFields(built.composition),
  }
}

function createAudioPreCompWrapper(
  built: BuiltPreComp,
  enabled: boolean,
  trackId: string | null,
  linkedGroupId: string | undefined,
): AudioItem | null {
  if (!enabled || !trackId) return null
  return {
    id: crypto.randomUUID(),
    type: 'audio',
    trackId,
    from: built.minFrom,
    durationInFrames: built.durationInFrames,
    label: built.composition.name,
    compositionId: built.composition.id,
    linkedGroupId,
    src: '',
    ...buildCompoundWrapperSourceFields(built.composition),
  }
}

function getPreCompLinkedGroupId(plan: PreCompWrapperPlan): string | undefined {
  return plan.hasVisualWrapper && plan.hasOwnedAudio ? crypto.randomUUID() : undefined
}

function addAndSelectPreCompWrappers(
  visualWrapper: CompositionItem | null,
  audioWrapper: AudioItem | null,
): TimelineItem | null {
  const wrappers = [visualWrapper, audioWrapper].filter(
    (wrapper): wrapper is CompositionItem | AudioItem => wrapper !== null,
  )
  for (const wrapper of wrappers) useItemsStore.getState()._addItem(wrapper)
  if (wrappers.length > 0) {
    useSelectionStore.getState().selectItems(wrappers.map((wrapper) => wrapper.id))
  }
  return wrappers[0] ?? null
}

function insertPreCompWrappers(built: BuiltPreComp, plan: PreCompWrapperPlan): TimelineItem | null {
  const linkedGroupId = getPreCompLinkedGroupId(plan)
  const visualWrapper = createVisualPreCompWrapper(
    built,
    plan.hasVisualWrapper,
    plan.visualTargetTrackId,
    linkedGroupId,
  )
  const audioWrapper = createAudioPreCompWrapper(
    built,
    plan.hasOwnedAudio,
    plan.audioTargetTrackId,
    linkedGroupId,
  )
  return addAndSelectPreCompWrappers(visualWrapper, audioWrapper)
}

function performCreatePreComp(
  name: string | undefined,
  itemIds: string[] | undefined,
  options: CreatePreCompOptions,
): TimelineItem | null {
  const context = getCreatePreCompContext(itemIds)
  if (!context) return null
  const built = buildPreComp(context, name, options)
  useCompositionsStore.getState().addComposition(built.composition)
  const wrapperPlan = buildPreCompWrapperPlan(context, built)
  removePreCompSourceItems(context, built)
  if (wrapperPlan.tracks !== context.tracks) {
    useItemsStore.getState().setTracks(wrapperPlan.tracks)
  }
  const wrapper = insertPreCompWrappers(built, wrapperPlan)
  useTimelineSettingsStore.getState().markDirty()
  return wrapper
}

export function createPreComp(
  name?: string,
  itemIds?: string[],
  options: CreatePreCompOptions = {},
): TimelineItem | null {
  const created = execute('CREATE_PRE_COMP', () => performCreatePreComp(name, itemIds, options), {
    name,
    editorKind: options.editorKind,
  })

  if (options.openAfterCreate && created?.compositionId) {
    openComposition(created.compositionId, created.label, created.id)
  }

  return created
}

/**
 * Promote editorial clips into a layer-based Motion composition.
 *
 * The selected clips keep their existing animation inside the new composition;
 * the returned wrapper is the simple clip-level animation surface in Edit.
 */
export function createMotionClip(name?: string, itemIds?: string[]): TimelineItem | null {
  return createPreComp(name, itemIds, {
    editorKind: 'composite-2d',
    openAfterCreate: true,
  })
}

/**
 * Dissolve a CompositionItem back into individual items on the main timeline.
 * This is the inverse of createPreComp.
 */
export function dissolvePreComp(compositionItemId: string): boolean {
  return execute(
    'DISSOLVE_PRE_COMP',
    () => {
      const { items } = useItemsStore.getState()
      const wrapperItem = items.find(
        (item) =>
          item.id === compositionItemId &&
          (item.type === 'composition' || isCompositionAudioItem(item)),
      )
      if (!wrapperItem) return false

      const compositionId = wrapperItem.compositionId
      if (!compositionId) return false
      const isAudioWrapper = isCompositionAudioItem(wrapperItem)

      const visualWrapper =
        wrapperItem.type === 'composition'
          ? wrapperItem
          : isAudioWrapper
            ? getLinkedCompositionVisualCompanion(items, wrapperItem)
            : null
      const audioWrapper =
        wrapperItem.type === 'composition'
          ? getLinkedCompositionAudioCompanion(items, wrapperItem)
          : isAudioWrapper
            ? wrapperItem
            : null

      const subComp = useCompositionsStore.getState().getComposition(compositionId)
      if (!subComp) return false

      const { tracks } = useItemsStore.getState()
      const wrapperIds = [visualWrapper?.id, audioWrapper?.id].filter((id): id is string => !!id)
      const wrapperWindowAnchor = visualWrapper ?? audioWrapper
      if (!wrapperWindowAnchor) return false
      const compFrom = wrapperWindowAnchor.from
      const timelineFps = useTimelineSettingsStore.getState().fps

      let nextTracks = tracks

      const resolveAnchorTrackId = (
        wrapperTrackId: string | null,
        fallbackTrackId: string | null,
        kind: TrackKind,
        direction: 'above' | 'below',
      ): string | null => {
        if (wrapperTrackId) return wrapperTrackId
        if (!fallbackTrackId) return null

        const fallbackTrack = nextTracks.find((track) => track.id === fallbackTrackId) ?? null
        if (!fallbackTrack) return null

        const nearestTrack = findNearestTrackByKind({
          tracks: nextTracks,
          targetTrack: fallbackTrack,
          kind,
          direction,
        })
        if (nearestTrack) return nearestTrack.id

        const createdTrack = createClassicTrack({
          tracks: nextTracks,
          kind,
          order: getAdjacentTrackOrder(nextTracks, fallbackTrack, direction),
          height: fallbackTrack.height ?? DEFAULT_TRACK_HEIGHT,
        })
        nextTracks = [...nextTracks, createdTrack]
        return createdTrack.id
      }

      const sortedSubTracks = [...subComp.tracks].sort(
        (left, right) => (left.order ?? 0) - (right.order ?? 0),
      )
      const visualSubTracks = sortedSubTracks.filter((track) => {
        const trackItems = subComp.items.filter((item) => item.trackId === track.id)
        return getTrackKindForSelectedItems(track, trackItems) === 'video'
      })
      const audioSubTracks = sortedSubTracks.filter((track) => {
        const trackItems = subComp.items.filter((item) => item.trackId === track.id)
        return getTrackKindForSelectedItems(track, trackItems) === 'audio'
      })

      const visualAnchorTrackId = resolveAnchorTrackId(
        visualWrapper?.trackId ?? null,
        audioWrapper?.trackId ?? null,
        'video',
        'above',
      )
      const audioAnchorTrackId = resolveAnchorTrackId(
        audioWrapper?.trackId ?? null,
        visualWrapper?.trackId ?? null,
        'audio',
        'below',
      )

      const trackIdMapping = new Map<string, string>()
      const newTracks: TimelineTrack[] = []
      const currentItems = items.filter((item) => !wrapperIds.includes(item.id))

      mapRestoredTrackGroup({
        subTracks: visualSubTracks,
        subItems: subComp.items,
        anchorTrackId: visualAnchorTrackId,
        kind: 'video',
        compFrom,
        existingTracks: nextTracks,
        currentItems,
        trackIdMapping,
        newTracks,
      })
      mapRestoredTrackGroup({
        subTracks: audioSubTracks,
        subItems: subComp.items,
        anchorTrackId: audioAnchorTrackId,
        kind: 'audio',
        compFrom,
        existingTracks: nextTracks,
        currentItems,
        trackIdMapping,
        newTracks,
      })

      // Add new tracks to the store (only if we couldn't reuse existing ones)
      if (newTracks.length > 0) {
        nextTracks = [...nextTracks, ...newTracks]
        useItemsStore.getState().setTracks(nextTracks)
      }

      // Reposition items back to absolute timeline positions with correct track mapping
      const itemIdMapping = new Map<string, string>()
      const restoredItems: TimelineItem[] = subComp.items.flatMap((item) => {
        const mappedItem = mapSubCompItemToWrapperWindow({
          subItem: item,
          wrapper: wrapperWindowAnchor,
          timelineFps,
          subCompFps: subComp.fps,
        })
        if (!mappedItem) return []

        const newId = crypto.randomUUID()
        itemIdMapping.set(item.id, newId)
        return [
          {
            ...mappedItem,
            id: newId,
            trackId:
              trackIdMapping.get(item.trackId) ??
              visualAnchorTrackId ??
              audioAnchorTrackId ??
              item.trackId,
          },
        ]
      })

      // Remove the compound wrappers
      if (wrapperIds.length > 0) {
        useItemsStore.getState()._removeItems(wrapperIds)
      }

      // Add restored items
      if (restoredItems.length > 0) {
        useItemsStore.getState()._addItems(restoredItems)
      }

      // Repair any external transitions that referenced the removed wrapper clips.
      applyTransitionRepairs(wrapperIds, new Set(wrapperIds))

      // Restore transitions with remapped IDs after the restored clips exist.
      const subTransitions = subComp.transitions ?? []
      if (subTransitions.length > 0) {
        const currentTransitions = useTransitionsStore.getState().transitions
        const restoredTransitions = subTransitions.flatMap((t) => {
          const leftClipId = itemIdMapping.get(t.leftClipId)
          const rightClipId = itemIdMapping.get(t.rightClipId)
          if (!leftClipId || !rightClipId) return []

          return [
            {
              ...t,
              id: crypto.randomUUID(),
              leftClipId,
              rightClipId,
              trackId: trackIdMapping.get(t.trackId) ?? t.trackId,
            },
          ]
        })
        useTransitionsStore
          .getState()
          .setTransitions([...currentTransitions, ...restoredTransitions])
        if (restoredTransitions.length > 0) {
          applyTransitionRepairs(restoredItems.map((item) => item.id))
        }
      }

      // Restore keyframes with remapped item IDs
      const subKeyframes = subComp.keyframes ?? []
      if (subKeyframes.length > 0) {
        const currentKeyframes = useKeyframesStore.getState().keyframes
        const restoredKeyframes = subKeyframes.map((kf) => ({
          ...kf,
          itemId: itemIdMapping.get(kf.itemId) ?? kf.itemId,
        }))
        useKeyframesStore.getState().setKeyframes([...currentKeyframes, ...restoredKeyframes])
      }

      // Only remove the compound definition when nothing else in the project references it.
      if (getCompoundClipDeletionImpact([compositionId]).totalReferenceCount === 0) {
        useCompositionsStore.getState().removeComposition(compositionId)
      }

      // Select the restored items
      useSelectionStore.getState().selectItems(restoredItems.map((i) => i.id))

      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { compositionItemId },
  )
}

export function deleteCompoundClips(compositionIds: string[]): boolean {
  const targetIds = Array.from(new Set(compositionIds.filter(Boolean)))
  if (targetIds.length === 0) return false

  return execute(
    'DELETE_COMPOUND_CLIPS',
    () => {
      const targetIdSet = new Set(targetIds)
      const navState = useCompositionNavigationStore.getState()
      const deletesOpenComposition = navState.breadcrumbs.some(
        (breadcrumb) =>
          breadcrumb.compositionId !== null && targetIdSet.has(breadcrumb.compositionId),
      )

      if (deletesOpenComposition) {
        useCompositionNavigationStore.getState().resetToRoot()
      }

      const currentSnapshot = getCurrentTimelineSnapshot()
      const sanitizedCurrent = sanitizeTimelineSnapshot(currentSnapshot, targetIdSet)
      if (sanitizedCurrent.removedItemIds.length > 0) {
        useItemsStore.getState().setItems(sanitizedCurrent.items)
        useTransitionsStore.getState().setTransitions(sanitizedCurrent.transitions)
        useKeyframesStore.getState().setKeyframes(sanitizedCurrent.keyframes)
      }

      const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
      const nextCompositions = useCompositionsStore
        .getState()
        .compositions.flatMap((composition) => {
          if (targetIdSet.has(composition.id)) {
            return []
          }

          const baseSnapshot: TimelineSnapshotLike =
            composition.id === activeCompositionId
              ? {
                  items: sanitizedCurrent.items,
                  tracks: sanitizedCurrent.tracks,
                  transitions: sanitizedCurrent.transitions,
                  keyframes: sanitizedCurrent.keyframes,
                }
              : {
                  items: composition.items,
                  tracks: composition.tracks,
                  transitions: composition.transitions,
                  keyframes: composition.keyframes,
                }

          const sanitizedComposition = sanitizeTimelineSnapshot(baseSnapshot, targetIdSet)
          return [
            {
              ...composition,
              items: sanitizedComposition.items,
              tracks: sanitizedComposition.tracks,
              transitions: sanitizedComposition.transitions,
              keyframes: sanitizedComposition.keyframes,
              durationInFrames: computeCompositionDuration(
                sanitizedComposition.items,
                composition.durationInFrames,
              ),
            },
          ]
        })
      useCompositionsStore.getState().setCompositions(nextCompositions)
      // Drop any deleted sequences from the standalone-timeline tab set.
      useSequencesStore.getState().pruneToValidSequenceIds(nextCompositions.map((c) => c.id))
      // Drop each deleted composition's parked undo history so it can't linger.
      for (const deletedId of targetIds) {
        useTimelineCommandStore.getState().removeContext(deletedId)
      }

      const latestNavState = useCompositionNavigationStore.getState()
      if (latestNavState.stashStack.length > 0 || latestNavState.mainHolder) {
        useCompositionNavigationStore.setState((state) => ({
          stashStack: state.stashStack.map((stash) => {
            const sanitized = sanitizeTimelineSnapshot(stash, targetIdSet)
            return {
              ...stash,
              items: sanitized.items,
              transitions: sanitized.transitions,
              keyframes: sanitized.keyframes,
            }
          }),
          // Main (held aside on a sequence tab) must also drop deleted references.
          mainHolder: state.mainHolder
            ? (() => {
                const sanitized = sanitizeTimelineSnapshot(state.mainHolder, targetIdSet)
                return {
                  ...state.mainHolder,
                  items: sanitized.items,
                  transitions: sanitized.transitions,
                  keyframes: sanitized.keyframes,
                }
              })()
            : null,
        }))
      }

      useSelectionStore.getState().clearSelection()
      useTimelineSettingsStore.getState().markDirty()
      return true
    },
    { compositionIds: targetIds },
  )
}

/** Generate a default, non-colliding name for a new standalone sequence. */
function nextSequenceName(): string {
  const existing = new Set(useCompositionsStore.getState().compositions.map((c) => c.name))
  let n = useSequencesStore.getState().topLevelSequenceIds.length + 1
  let candidate = `Sequence ${n}`
  while (existing.has(candidate)) {
    n += 1
    candidate = `Sequence ${n}`
  }
  return candidate
}

/**
 * Create a new empty standalone sequence (a top-level timeline tab) and switch
 * to it. The sequence is a {@link SubComposition} with its own tracks that
 * inherits the project canvas + fps. Registry creation is undoable; tab
 * membership is derived state (the tab bar intersects with existing
 * compositions), so it is added outside the command wrapper.
 */
export function createSequence(name?: string): string {
  const id = crypto.randomUUID()
  const projectMetadata = useProjectStore.getState().currentProject?.metadata
  const width = projectMetadata?.width ?? DEFAULT_PROJECT_WIDTH
  const height = projectMetadata?.height ?? DEFAULT_PROJECT_HEIGHT
  const backgroundColor = projectMetadata?.backgroundColor
  const fps = useTimelineSettingsStore.getState().fps
  const sequenceName = name?.trim() || nextSequenceName()

  const makeTrack = (label: string, kind: TrackKind, order: number): TimelineTrack => ({
    id: crypto.randomUUID(),
    name: label,
    kind,
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order,
    items: [],
  })

  const sequence: SubComposition = {
    id,
    name: sequenceName,
    editorKind: 'sequence',
    items: [],
    tracks: [makeTrack('V1', 'video', 0), makeTrack('A1', 'audio', 1)],
    transitions: [],
    keyframes: [],
    fps,
    width,
    height,
    durationInFrames: 0,
    ...(backgroundColor && { backgroundColor }),
  }

  execute(
    'CREATE_SEQUENCE',
    () => {
      useCompositionsStore.getState().addComposition(sequence)
      // Tab membership is captured by the undo snapshot, so add it inside the
      // command — undo/redo then roll it back with the composition.
      useSequencesStore.getState().addTopLevelSequence(id)
    },
    { sequenceId: id },
  )
  useTimelineSettingsStore.getState().markDirty()
  useCompositionNavigationStore.getState().switchToSequence(id)
  return id
}

export interface CreateCompositeCompositionOptions {
  name?: string
  width?: number
  height?: number
  fps?: number
  durationInFrames?: number
  backgroundColor?: string
}

function finiteClampedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, Math.round(candidate)))
}

/** Generate a default, non-colliding name for a new 2D composition. */
function nextCompositeCompositionName(): string {
  const existing = new Set(useCompositionsStore.getState().compositions.map((c) => c.name))
  let n =
    useCompositionsStore
      .getState()
      .compositions.filter((composition) => composition.editorKind === 'composite-2d').length + 1
  let candidate = `Composition ${n}`
  while (existing.has(candidate)) {
    n += 1
    candidate = `Composition ${n}`
  }
  return candidate
}

function openCompositeCompositionInMotionWorkspace(compositionId: string): void {
  const switchComposition = () => {
    const composition = useCompositionsStore.getState().getComposition(compositionId)
    if (
      composition?.editorKind !== 'composite-2d' ||
      useEditorStore.getState().workspace !== 'motion'
    ) {
      return
    }
    useCompositionNavigationStore.getState().switchToSequence(compositionId)
  }

  const editor = useEditorStore.getState()
  if (editor.workspace === 'motion') {
    switchComposition()
    return
  }

  editor.setWorkspace('motion')
  // Let the Motion shell mount and capture the outgoing editorial timeline
  // before the live timeline stores are swapped to the Motion composition.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(switchComposition)
  } else {
    switchComposition()
  }
}

/**
 * Create an empty layer-based 2D composition and open it as the active root.
 *
 * It deliberately does not join `topLevelSequenceIds`: those ids drive the
 * classic editorial tab strip. Compose owns its own browser/navigation UI.
 * The shared composition registry still makes the result reusable and
 * nestable everywhere a CompositionItem is accepted.
 */
export function createCompositeComposition(
  options: CreateCompositeCompositionOptions = {},
): string {
  const id = crypto.randomUUID()
  const projectMetadata = useProjectStore.getState().currentProject?.metadata
  const projectFps = useTimelineSettingsStore.getState().fps
  const fps = finiteClampedInteger(options.fps, projectFps, 1, 120)
  const width = finiteClampedInteger(
    options.width,
    projectMetadata?.width ?? DEFAULT_PROJECT_WIDTH,
    1,
    7680,
  )
  const height = finiteClampedInteger(
    options.height,
    projectMetadata?.height ?? DEFAULT_PROJECT_HEIGHT,
    1,
    4320,
  )
  const durationInFrames = finiteClampedInteger(
    options.durationInFrames,
    fps * 10,
    1,
    fps * 60 * 60,
  )
  const name = options.name?.trim() || nextCompositeCompositionName()
  const backgroundColor = options.backgroundColor ?? projectMetadata?.backgroundColor

  const composition: SubComposition = {
    id,
    name,
    editorKind: 'composite-2d',
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    fps,
    width,
    height,
    durationInFrames,
    ...(backgroundColor && { backgroundColor }),
  }

  execute(
    'CREATE_COMPOSITE_COMPOSITION',
    () => {
      useCompositionsStore.getState().addComposition(composition)
    },
    { compositionId: id, editorKind: composition.editorKind },
  )
  useTimelineSettingsStore.getState().markDirty()
  openCompositeCompositionInMotionWorkspace(id)
  return id
}

/**
 * Open a composition for editing. If it's a top-level sequence tab, switch to
 * that tab (its own root — no Main above it); otherwise drill into it as a
 * compound clip from the current context.
 */
export function openComposition(compositionId: string, label?: string, entryItemId?: string): void {
  const composition = useCompositionsStore.getState().getComposition(compositionId)
  if (composition?.editorKind === 'composite-2d') {
    openCompositeCompositionInMotionWorkspace(compositionId)
    return
  }
  if (useSequencesStore.getState().isTopLevelSequence(compositionId)) {
    useCompositionNavigationStore.getState().switchToSequence(compositionId)
    return
  }
  const name =
    label ?? useCompositionsStore.getState().getComposition(compositionId)?.name ?? 'Composition'
  useCompositionNavigationStore.getState().enterComposition(compositionId, name, entryItemId)
}

export function repairCompositeCompositionEditorialLeak(params: {
  compositionId: string
  editorialItemIds: readonly string[]
  suggestedDurationInFrames?: number
}): number {
  const composition = useCompositionsStore.getState().getComposition(params.compositionId)
  if (composition?.editorKind !== 'composite-2d') return 0

  const editorialItemIdSet = new Set(params.editorialItemIds)
  const leakedItemIds = new Set(
    composition.items.filter((item) => editorialItemIdSet.has(item.id)).map((item) => item.id),
  )
  if (leakedItemIds.size === 0) return 0

  const items = composition.items.filter((item) => !leakedItemIds.has(item.id))
  const trackById = new Map(composition.tracks.map((track) => [track.id, track]))
  const retainedTrackIds = new Set(items.map((item) => item.trackId))
  for (const trackId of [...retainedTrackIds]) {
    let parentTrackId = trackById.get(trackId)?.parentTrackId
    while (parentTrackId && !retainedTrackIds.has(parentTrackId)) {
      retainedTrackIds.add(parentTrackId)
      parentTrackId = trackById.get(parentTrackId)?.parentTrackId
    }
  }
  const tracks = composition.tracks.filter((track) => retainedTrackIds.has(track.id))
  const transitions = composition.transitions.filter(
    (transition) =>
      !leakedItemIds.has(transition.leftClipId) && !leakedItemIds.has(transition.rightClipId),
  )
  const keyframes = composition.keyframes.filter((entry) => !leakedItemIds.has(entry.itemId))
  const contentEnd = items.reduce(
    (maximum, item) => Math.max(maximum, item.from + item.durationInFrames),
    1,
  )
  const suggestedDuration = params.suggestedDurationInFrames
  const durationInFrames =
    typeof suggestedDuration === 'number' && Number.isFinite(suggestedDuration)
      ? Math.max(contentEnd, Math.round(suggestedDuration), 1)
      : composition.durationInFrames

  useCompositionsStore.getState().updateComposition(params.compositionId, {
    items,
    tracks,
    transitions,
    keyframes,
    durationInFrames,
  })

  if (useCompositionNavigationStore.getState().activeCompositionId === params.compositionId) {
    useItemsStore.getState().setItems(items)
    useItemsStore.getState().setTracks(tracks)
    useTransitionsStore.getState().setTransitions(transitions)
    useKeyframesStore.getState().setKeyframes(keyframes)
  }
  useTimelineSettingsStore.getState().markDirty()
  return leakedItemIds.size
}

/** Promote an existing composition (compound clip) to a standalone tab and open it. */
export function openCompositionAsTab(compositionId: string): void {
  const composition = useCompositionsStore.getState().getComposition(compositionId)
  if (!composition || composition.editorKind !== 'sequence') return
  useSequencesStore.getState().addTopLevelSequence(compositionId)
  useTimelineSettingsStore.getState().markDirty()
  useCompositionNavigationStore.getState().switchToSequence(compositionId)
}

/**
 * Close a standalone-sequence tab. The underlying composition stays in the
 * registry (still reachable from the media library and any wrapper clips that
 * reference it); only the tab membership is removed. Switches to Main first if
 * the closed tab is currently active.
 */
export function closeSequenceTab(compositionId: string): void {
  const nav = useCompositionNavigationStore.getState()
  if (getActiveTabId(nav.breadcrumbs) === compositionId) {
    nav.switchToSequence(null)
  }
  useSequencesStore.getState().removeTopLevelSequence(compositionId)
  useTimelineSettingsStore.getState().markDirty()
}
