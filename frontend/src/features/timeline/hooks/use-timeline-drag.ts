import type React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { DragState, UseTimelineDragReturn, SnapTarget } from '../types/drag'
import { useItemsStore } from '../stores/items-store'
import {
  duplicateItems,
  duplicateItemsWithTrackChanges,
  moveItem,
  moveItems,
  moveItemsWithTrackChanges,
} from '../stores/timeline-actions'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import {
  pixelsToFramePreciseNow,
  frameToPixelsNow,
} from '@/features/timeline/utils/zoom-conversions'
import { useSnapCalculator } from './use-snap-calculator'
import { findNearestAvailableSpace } from '../utils/collision-utils'
import { findNearestSnapTarget } from '../utils/timeline-snap-utils'
import { getTrackKind } from '../utils/classic-tracks'
import {
  expandItemIdsWithAttachedCaptions,
  buildLinkedMovePreviewUpdates,
  expandSelectionWithLinkedItems,
  filterUnlockedItemIds,
  getLinkedItemIds,
} from '../utils/linked-items'
import { findCompatibleTrackForItemType } from '../utils/track-item-compatibility'
import {
  resolveCreateNewDragTrackTargets,
  resolveLinkedDragTrackTargets,
  type LinkedDragDropZone,
} from '../utils/linked-drag-targeting'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { DRAG_THRESHOLD_PIXELS } from '../constants'
import { createLogger } from '@/shared/logging/logger'
import { createRafCoalescedCallback } from '../utils/raf-coalesced-callback'

const logger = createLogger('TimelineDrag')

// Shared ref for drag offset (avoids re-renders from store updates)
export const dragOffsetRef = { current: { x: 0, y: 0 } }
export const dragPreviewOffsetByItemRef = {
  current: {} as Record<string, { x: number; y: number }>,
}

const LARGE_ALT_DRAG_CANVAS_THRESHOLD = 24

interface LargeAltDragCanvasEntry {
  id: string
  left: number
  top: number
  width: number
  height: number
}

interface LargeAltDragCanvasState {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  entries: LargeAltDragCanvasEntry[]
  itemIds: Set<string>
  dpr: number
}

let largeAltDragCanvasState: LargeAltDragCanvasState | null = null

export function isLargeAltDragCanvasItem(itemId: string): boolean {
  return largeAltDragCanvasState?.itemIds.has(itemId) ?? false
}

function clearLargeAltDragCanvas() {
  largeAltDragCanvasState?.canvas.remove()
  largeAltDragCanvasState = null
}

function startLargeAltDragCanvas(itemIds: string[]) {
  clearLargeAltDragCanvas()
  if (itemIds.length < LARGE_ALT_DRAG_CANVAS_THRESHOLD) return

  const timeline = document.querySelector('.timeline-container')
  if (!timeline) return

  const entries = itemIds
    .map((id): LargeAltDragCanvasEntry | null => {
      const element = timeline.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
    })
    .filter((entry): entry is LargeAltDragCanvasEntry => entry !== null)
  if (entries.length < LARGE_ALT_DRAG_CANVAS_THRESHOLD) return

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(window.innerWidth * dpr)
  canvas.height = Math.ceil(window.innerHeight * dpr)
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '10000'
  canvas.style.contain = 'strict'
  canvas.setAttribute('data-large-alt-drag-canvas', 'true')

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  document.body.appendChild(canvas)

  largeAltDragCanvasState = {
    canvas,
    context,
    entries,
    itemIds: new Set(entries.map((entry) => entry.id)),
    dpr,
  }
  updateLargeAltDragCanvas({}, { x: 0, y: 0 })
}

function updateLargeAltDragCanvas(
  offsets: Record<string, { x: number; y: number }>,
  fallbackOffset: { x: number; y: number },
) {
  const state = largeAltDragCanvasState
  if (!state) return

  const { canvas, context, entries, dpr } = state
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
  context.fillStyle = 'rgba(59, 130, 246, 0.2)'
  context.strokeStyle = 'rgba(96, 165, 250, 0.95)'
  context.lineWidth = 2
  context.setLineDash([6, 4])

  for (const entry of entries) {
    const offset = offsets[entry.id] ?? fallbackOffset
    const left = entry.left + offset.x
    const top = entry.top + offset.y
    context.fillRect(left, top, entry.width, entry.height)
    context.strokeRect(
      left + 1,
      top + 1,
      Math.max(0, entry.width - 2),
      Math.max(0, entry.height - 2),
    )
  }
}

/**
 * Clamp a proposed frame so the item doesn't visually overlap other items
 * on the target track during drag preview. Returns the clamped frame.
 * Excludes items in `excludeIds` (the dragged items themselves).
 */
function clampToTrackWalls(
  proposedFrom: number,
  durationInFrames: number,
  trackId: string,
  excludeIds: ReadonlySet<string>,
  allItems: ReadonlyArray<TimelineItem>,
  itemsByTrackId?: ReadonlyMap<string, ReadonlyArray<TimelineItem>>,
): number {
  const proposedEnd = proposedFrom + durationInFrames
  let leftWall = 0 // rightmost end of items to the left
  let rightWall = Infinity // leftmost start of items to the right

  const trackItems = itemsByTrackId?.get(trackId) ?? allItems
  for (const other of trackItems) {
    if (excludeIds.has(other.id) || other.trackId !== trackId) continue
    const otherEnd = other.from + other.durationInFrames

    if (otherEnd <= proposedFrom) {
      // Item fully to the left — track its right edge as potential wall
      if (otherEnd > leftWall) leftWall = otherEnd
    } else if (other.from >= proposedEnd) {
      // Item fully to the right — track its left edge as potential wall
      if (other.from < rightWall) rightWall = other.from
    } else {
      // Item overlaps the proposed position — find which side is closer
      // and use the tighter wall
      const distToLeft = proposedFrom - other.from
      const distToRight = otherEnd - proposedFrom
      if (distToLeft >= 0 && distToLeft <= distToRight) {
        // We're overlapping from the right side of other
        if (otherEnd > leftWall) leftWall = otherEnd
      } else {
        // We're overlapping from the left side of other
        if (other.from < rightWall) rightWall = other.from
      }
    }
  }

  const maxFrom = rightWall - durationInFrames
  return Math.max(leftWall, Math.min(maxFrom, proposedFrom))
}

const DRAG_CURSOR_CLASS_BY_MODE = {
  grabbing: 'timeline-item-drag-cursor-grabbing',
  copy: 'timeline-item-drag-cursor-copy',
  'not-allowed': 'timeline-item-drag-cursor-not-allowed',
} as const

type DragCursorMode = keyof typeof DRAG_CURSOR_CLASS_BY_MODE

const DRAG_CURSOR_CLASSES = Object.values(DRAG_CURSOR_CLASS_BY_MODE)
const TRACK_SECTION_DIVIDER_GAP = 0
const CROSS_TRACK_SNAP_THRESHOLD_PX = 18

function getDraggedLinkedPair(
  items: TimelineItem[],
  draggedItemIds: string[],
): { visualItemId: string; audioItemId: string } | null {
  if (draggedItemIds.length !== 2) {
    return null
  }

  const draggedItems = draggedItemIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is TimelineItem => item !== undefined)
  if (draggedItems.length !== 2) {
    return null
  }

  // Any visual item (non-audio) paired with an audio item counts as a linked pair
  const visualItem = draggedItems.find((draggedItem) => draggedItem.type !== 'audio')
  const audioItem = draggedItems.find((draggedItem) => draggedItem.type === 'audio')
  if (!visualItem || !audioItem) {
    return null
  }

  const linkedIds = new Set(getLinkedItemIds(items, visualItem.id))
  if (!linkedIds.has(audioItem.id)) {
    return null
  }

  return {
    visualItemId: visualItem.id,
    audioItemId: audioItem.id,
  }
}

function resolveDraggedTrackTargets(params: {
  items: TimelineItem[]
  draggedItems: Array<{ id: string; initialTrackId: string }>
  tracks: TimelineTrack[]
  dropTarget: { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean }
  preferredTrackHeight: number
}): { tracks: TimelineTrack[]; trackAssignments: Map<string, string> } | null {
  const { items, draggedItems, tracks, dropTarget, preferredTrackHeight } = params
  if (!dropTarget.zone) {
    return null
  }

  const draggedItemIds = draggedItems.map((draggedItem) => draggedItem.id)
  const linkedPair = getDraggedLinkedPair(items, draggedItemIds)
  if (linkedPair) {
    const linkedTrackTargets = resolveLinkedDragTrackTargets({
      tracks,
      hoveredTrackId: dropTarget.trackId,
      zone: dropTarget.zone,
      createNew: dropTarget.createNew,
      preferredTrackHeight,
    })
    if (!linkedTrackTargets) {
      return null
    }

    return {
      tracks: linkedTrackTargets.tracks,
      trackAssignments: new Map<string, string>([
        [linkedPair.visualItemId, linkedTrackTargets.videoTrackId],
        [linkedPair.audioItemId, linkedTrackTargets.audioTrackId],
      ]),
    }
  }

  if (!dropTarget.createNew) {
    return null
  }

  const createNewTrackTargets = resolveCreateNewDragTrackTargets({
    tracks,
    draggedItems: draggedItems
      .map((draggedItem) => {
        const sourceItem = items.find((item) => item.id === draggedItem.id)
        return sourceItem
          ? {
              id: sourceItem.id,
              initialTrackId: draggedItem.initialTrackId,
              type: sourceItem.type,
            }
          : null
      })
      .filter(
        (
          draggedItem,
        ): draggedItem is { id: string; initialTrackId: string; type: TimelineItem['type'] } =>
          draggedItem !== null,
      ),
    zone: dropTarget.zone,
    preferredTrackHeight,
  })

  if (!createNewTrackTargets) {
    return null
  }

  return {
    tracks: createNewTrackTargets.tracks,
    trackAssignments: createNewTrackTargets.trackAssignments,
  }
}

function captureTrackVisualTops(): Map<string, number> {
  const laneRows = Array.from(document.querySelectorAll('.timeline-tracks [data-track-id]')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  )
  const domTopByTrackId = new Map<string, number>()

  for (const row of laneRows) {
    const trackId = row.getAttribute('data-track-id')
    if (!trackId) continue
    domTopByTrackId.set(trackId, row.getBoundingClientRect().top)
  }

  return domTopByTrackId
}

function buildTrackVisualTopMap(
  tracks: Array<{
    id: string
    order: number
    height: number
    kind: 'video' | 'audio' | null
  }>,
  domTopByTrackId: ReadonlyMap<string, number>,
): Map<string, number> {
  const orderedTracks = [...tracks].sort((left, right) => left.order - right.order)
  const firstExistingIndex = orderedTracks.findIndex((track) => domTopByTrackId.has(track.id))
  if (firstExistingIndex === -1) {
    return new Map()
  }

  const topByTrackId = new Map<string, number>()
  const firstExistingTrack = orderedTracks[firstExistingIndex]!
  topByTrackId.set(firstExistingTrack.id, domTopByTrackId.get(firstExistingTrack.id)!)

  for (let index = firstExistingIndex - 1; index >= 0; index -= 1) {
    const currentTrack = orderedTracks[index]!
    const nextTrack = orderedTracks[index + 1]!
    const nextTop = topByTrackId.get(nextTrack.id)
    if (nextTop === undefined) continue
    const gap =
      currentTrack.kind === 'video' && nextTrack.kind === 'audio' ? TRACK_SECTION_DIVIDER_GAP : 0
    topByTrackId.set(currentTrack.id, nextTop - currentTrack.height - gap)
  }

  for (let index = firstExistingIndex + 1; index < orderedTracks.length; index += 1) {
    const previousTrack = orderedTracks[index - 1]!
    const currentTrack = orderedTracks[index]!
    const previousTop = topByTrackId.get(previousTrack.id)
    if (previousTop === undefined) continue
    const gap =
      previousTrack.kind === 'video' && currentTrack.kind === 'audio'
        ? TRACK_SECTION_DIVIDER_GAP
        : 0
    topByTrackId.set(currentTrack.id, previousTop + previousTrack.height + gap)
  }

  return topByTrackId
}

interface DragDropRowGeometry {
  trackId: string
  /** Row top relative to its scroll pane's content box (stable while the pane scrolls). */
  top: number
  bottom: number
  pane: HTMLElement | null
}

interface DragDropGeometry {
  tracks: TimelineTrack[]
  trackContainer: HTMLElement | null
  rows: DragDropRowGeometry[]
}

/**
 * Snapshot row geometry once per tracks-array identity. Pane scroll offsets are
 * re-applied on every read (see resolveDragDropRowBounds), so drag pointer
 * handling no longer runs querySelectorAll + getBoundingClientRect over every
 * track row each frame — those reads forced a synchronous layout after the
 * previous frame's transform write.
 */
function captureDragDropGeometry(tracks: TimelineTrack[]): DragDropGeometry {
  const trackContainerEl = document.querySelector('.timeline-tracks')
  const containerEl = document.querySelector('.timeline-container')
  const trackContainer =
    trackContainerEl instanceof HTMLElement
      ? trackContainerEl
      : containerEl instanceof HTMLElement
        ? containerEl
        : null
  const scope: ParentNode = trackContainer ?? document
  const rows: DragDropRowGeometry[] = []

  for (const element of scope.querySelectorAll('[data-track-id]')) {
    if (!(element instanceof HTMLElement)) continue
    const trackId = element.getAttribute('data-track-id')
    if (!trackId) continue
    const pane = element.closest<HTMLElement>('[data-track-section-scroll]')
    const rect = element.getBoundingClientRect()
    const paneBase = pane ? pane.getBoundingClientRect().top - pane.scrollTop : 0
    rows.push({ trackId, top: rect.top - paneBase, bottom: rect.bottom - paneBase, pane })
  }

  return { tracks, trackContainer, rows }
}

function resolveDragDropRowBounds(
  geometry: DragDropGeometry,
): Array<{ trackId: string; top: number; bottom: number }> {
  const paneBaseByPane = new Map<HTMLElement | null, number>()
  const bounds = geometry.rows.map((row) => {
    let paneBase = paneBaseByPane.get(row.pane)
    if (paneBase === undefined) {
      paneBase = row.pane ? row.pane.getBoundingClientRect().top - row.pane.scrollTop : 0
      paneBaseByPane.set(row.pane, paneBase)
    }
    return { trackId: row.trackId, top: row.top + paneBase, bottom: row.bottom + paneBase }
  })
  bounds.sort((left, right) => left.top - right.top)
  return bounds
}

function setGlobalDragCursor(mode: DragCursorMode): void {
  const nextClass = DRAG_CURSOR_CLASS_BY_MODE[mode]
  if (document.body.classList.contains(nextClass)) {
    return
  }
  document.body.classList.remove(...DRAG_CURSOR_CLASSES)
  document.body.classList.add(nextClass)
}

function clearGlobalDragCursor(): void {
  document.body.classList.remove(...DRAG_CURSOR_CLASSES)
}

interface DraggedItemState {
  id: string
  initialFrame: number
  initialTrackId: string
}

/**
 * Resolve the full set of items a drag should move and their initial positions:
 * expand the base selection (linked items when enabled, else the raw selection
 * or the just-clicked clip), attach captions, drop locked items, and snapshot
 * each survivor's starting frame + track.
 */
function resolveDraggedItemStates(
  allItems: TimelineItem[],
  currentTracks: TimelineTrack[],
  currentSelectedIds: string[],
  isInSelection: boolean,
  linkedIds: string[],
  linkedSelectionEnabled: boolean,
): { baseItemsToDrag: string[]; draggableItemIds: string[]; draggedItems: DraggedItemState[] } {
  const baseItemsToDrag = isInSelection
    ? linkedSelectionEnabled
      ? expandSelectionWithLinkedItems(allItems, currentSelectedIds)
      : currentSelectedIds
    : linkedIds
  const itemsToDrag = expandItemIdsWithAttachedCaptions(allItems, baseItemsToDrag)
  const draggableItemIds = filterUnlockedItemIds(allItems, currentTracks, itemsToDrag)
  const draggedItems = draggableItemIds
    .map((id) => {
      const dragItem = allItems.find((i) => i.id === id)
      if (!dragItem) return null
      return {
        id: dragItem.id,
        initialFrame: dragItem.from,
        initialTrackId: dragItem.trackId,
      }
    })
    .filter((i): i is DraggedItemState => i !== null)
  return { baseItemsToDrag, draggableItemIds, draggedItems }
}

/**
 * Timeline drag-and-drop hook - Phase 2 Enhanced
 *
 * Features:
 * - Single and multi-select drag
 * - Horizontal (time) and vertical (track) movement
 * - Grid + magnetic snapping (adaptive threshold)
 * - Collision detection with push-forward
 * - Undo/redo support (automatic via Zundo)
 *
 * @param item - The timeline item to make draggable
 * @param timelineDuration - Total timeline duration in seconds
 * @param trackLocked - Whether the track is locked (prevents dragging)
 */

interface PreviewMovedItem {
  id: string
  initialFrame: number
  initialTrackId: string
  newFrom: number
  newTrackId: string
  durationInFrames: number
}

interface DragPreviewOffsets {
  previewOffsets: Record<string, { x: number; y: number }> | null
  anchorPreviewOffset: { x: number; y: number }
  linkedPreviewMovedItems: Array<{ id: string; from: number }>
}

function syncAltDragToggle(
  e: MouseEvent,
  isAltDragRef: { current: boolean },
  dragState: DragState,
  getMagneticSnapTargets: (excludeIds: string[] | null) => SnapTarget[],
  magneticSnapTargetsRef: { current: SnapTarget[] },
): boolean {
  // Dynamic Alt key toggle - update state and cursor
  const altKeyChanged = isAltDragRef.current !== e.altKey
  isAltDragRef.current = e.altKey
  if (!altKeyChanged) return false
  const draggedIds = dragState.draggedItems.map((dragged) => dragged.id)
  magneticSnapTargetsRef.current = getMagneticSnapTargets(e.altKey ? null : draggedIds)
  if (e.altKey) {
    startLargeAltDragCanvas(draggedIds)
  } else {
    clearLargeAltDragCanvas()
  }
  return true
}

function clampDragDeltaToZero(
  draggedItems: DragState['draggedItems'],
  deltaFrames: number,
  deltaX: number,
): { clampedDeltaFrames: number; clampedDeltaX: number } {
  // Find the minimum starting frame among all dragged items
  let minInitialFrame = Infinity
  for (const draggedItem of draggedItems) {
    if (draggedItem.initialFrame < minInitialFrame) {
      minInitialFrame = draggedItem.initialFrame
    }
  }

  // Calculate the maximum allowed negative delta (in frames)
  // to prevent the earliest item from going below frame 0
  const maxNegativeDeltaFrames = -minInitialFrame
  const clampedDeltaFrames = Math.max(maxNegativeDeltaFrames, deltaFrames)

  // Convert back to pixels for the clamped X offset
  // Use the ratio of clamped to original to maintain precision
  const clampedDeltaX = deltaFrames !== 0 ? deltaX * (clampedDeltaFrames / deltaFrames) : deltaX
  return { clampedDeltaFrames, clampedDeltaX }
}

function snapshotDragItemIndexes(
  currentItems: TimelineItem[],
  tracks: TimelineTrack[],
): {
  currentItemById: Map<string, TimelineItem>
  currentItemsByTrackId: Map<string, TimelineItem[]>
  trackIndexById: Map<string, number>
} {
  const currentItemById = new Map(currentItems.map((currentItem) => [currentItem.id, currentItem]))
  const currentItemsByTrackId = new Map<string, TimelineItem[]>()
  for (const currentItem of currentItems) {
    const trackItems = currentItemsByTrackId.get(currentItem.trackId)
    if (trackItems) {
      trackItems.push(currentItem)
    } else {
      currentItemsByTrackId.set(currentItem.trackId, [currentItem])
    }
  }
  const trackIndexById = new Map(tracks.map((currentTrack, index) => [currentTrack.id, index]))
  return { currentItemById, currentItemsByTrackId, trackIndexById }
}

function buildGroupSnapWindow(options: {
  draggedItems: DragState['draggedItems']
  currentItemById: Map<string, TimelineItem>
  deltaFrames: number
  startFrame: number
  itemId: string
}): { snapStartFrame: number; snapDuration: number; rawGroupStartFrame: number } {
  const { draggedItems, currentItemById, deltaFrames, startFrame, itemId } = options
  if (draggedItems.length <= 1) {
    // Single item drag - use anchor item
    const draggedItem = currentItemById.get(itemId)
    return {
      snapStartFrame: Math.max(0, startFrame + deltaFrames),
      snapDuration: draggedItem?.durationInFrames || 0,
      rawGroupStartFrame: 0,
    }
  }
  // Calculate group bounds
  let groupStartFrame = Infinity
  let groupEndFrame = -Infinity

  for (const draggedItem of draggedItems) {
    const sourceItem = currentItemById.get(draggedItem.id)
    if (!sourceItem) continue

    const proposedStart = draggedItem.initialFrame + deltaFrames
    const proposedEnd = proposedStart + sourceItem.durationInFrames

    if (proposedStart < groupStartFrame) groupStartFrame = proposedStart
    if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd
  }

  return {
    snapStartFrame: Math.max(0, groupStartFrame),
    snapDuration: groupEndFrame - groupStartFrame,
    rawGroupStartFrame: groupStartFrame,
  }
}

function resolvePreviewItemTrackId(options: {
  previewTrackTargets: { trackAssignments: Map<string, string> } | null
  draggedItemId: string
  draggedItemInitialTrackId: string
  startTrackId: string
  previewAnchorTrackId: string
  trackIndexById: Map<string, number>
  tracks: TimelineTrack[]
}): string {
  const {
    previewTrackTargets,
    draggedItemId,
    draggedItemInitialTrackId,
    startTrackId,
    previewAnchorTrackId,
    trackIndexById,
    tracks,
  } = options
  const assigned = previewTrackTargets?.trackAssignments.get(draggedItemId)
  if (assigned) return assigned
  const anchorTrackIndex = trackIndexById.get(startTrackId) ?? -1
  const itemTrackIndex = trackIndexById.get(draggedItemInitialTrackId) ?? -1
  const newAnchorTrackIndex = trackIndexById.get(previewAnchorTrackId) ?? -1
  const trackOffset = itemTrackIndex - anchorTrackIndex
  const newItemTrackIndex = Math.max(
    0,
    Math.min(tracks.length - 1, newAnchorTrackIndex + trackOffset),
  )
  return tracks[newItemTrackIndex]?.id || draggedItemInitialTrackId
}

function buildPreviewMovedItems(options: {
  draggedItems: DragState['draggedItems']
  currentItemById: Map<string, TimelineItem>
  deltaFrames: number
  previewSnapDelta: number
  groupClampOffset: number
  previewTrackTargets: { trackAssignments: Map<string, string> } | null
  startTrackId: string
  previewAnchorTrackId: string
  trackIndexById: Map<string, number>
  tracks: TimelineTrack[]
}): PreviewMovedItem[] {
  const {
    draggedItems,
    currentItemById,
    deltaFrames,
    previewSnapDelta,
    groupClampOffset,
    previewTrackTargets,
    startTrackId,
    previewAnchorTrackId,
    trackIndexById,
    tracks,
  } = options
  return draggedItems
    .map((draggedItem) => {
      const sourceItem = currentItemById.get(draggedItem.id)
      if (!sourceItem) return null

      const itemNewTrackId = resolvePreviewItemTrackId({
        previewTrackTargets,
        draggedItemId: draggedItem.id,
        draggedItemInitialTrackId: draggedItem.initialTrackId,
        startTrackId,
        previewAnchorTrackId,
        trackIndexById,
        tracks,
      })

      return {
        id: draggedItem.id,
        initialFrame: draggedItem.initialFrame,
        initialTrackId: draggedItem.initialTrackId,
        newFrom: draggedItem.initialFrame + deltaFrames + previewSnapDelta + groupClampOffset,
        newTrackId: itemNewTrackId,
        durationInFrames: sourceItem.durationInFrames,
      }
    })
    .filter((previewItem) => previewItem !== null) as PreviewMovedItem[]
}

function clampPreviewGroupToWalls(options: {
  previewMovedItems: PreviewMovedItem[]
  currentItems: TimelineItem[]
  currentItemsByTrackId: Map<string, TimelineItem[]>
  isAltDrag: boolean
}): void {
  const { previewMovedItems, currentItems, currentItemsByTrackId, isAltDrag } = options
  if (isAltDrag) return
  // Wall-clamp the group: find tightest constraint across all items,
  // then shift the entire group by the same delta so they stay together.
  const groupExcludeIds = new Set(previewMovedItems.map((m) => m.id))
  let wallClampDelta = 0
  for (const previewItem of previewMovedItems) {
    const clamped = clampToTrackWalls(
      previewItem.newFrom,
      previewItem.durationInFrames,
      previewItem.newTrackId,
      groupExcludeIds,
      currentItems,
      currentItemsByTrackId,
    )
    const itemDelta = clamped - previewItem.newFrom
    // Pick the tightest (smallest magnitude) clamp in each direction
    if (itemDelta < 0 && (wallClampDelta >= 0 || itemDelta > wallClampDelta)) {
      wallClampDelta = itemDelta
    } else if (itemDelta > 0 && (wallClampDelta <= 0 || itemDelta < wallClampDelta)) {
      wallClampDelta = itemDelta
    }
  }
  if (wallClampDelta !== 0) {
    for (const previewItem of previewMovedItems) {
      previewItem.newFrom += wallClampDelta
    }
  }
}

function buildPreviewOffsets(
  previewMovedItems: PreviewMovedItem[],
  previewVisualTopByTrackId: Map<string, number>,
  frameToPixels: (frames: number) => number,
  deltaY: number,
): Record<string, { x: number; y: number }> {
  const previewOffsets: Record<string, { x: number; y: number }> = {}
  for (const previewItem of previewMovedItems) {
    const currentTop = previewVisualTopByTrackId.get(previewItem.initialTrackId)
    const targetTop = previewVisualTopByTrackId.get(previewItem.newTrackId)
    previewOffsets[previewItem.id] = {
      x: frameToPixels(previewItem.newFrom - previewItem.initialFrame),
      y: currentTop !== undefined && targetTop !== undefined ? targetTop - currentTop : deltaY,
    }
  }
  return previewOffsets
}

function buildMultiItemDragPreview(options: {
  draggedItems: DragState['draggedItems']
  currentItemById: Map<string, TimelineItem>
  currentItems: TimelineItem[]
  currentItemsByTrackId: Map<string, TimelineItem[]>
  deltaFrames: number
  deltaY: number
  snapDuration: number
  snapStartFrame: number
  rawGroupStartFrame: number
  snapResult: { snappedFrame: number }
  previewTrackTargets: { trackAssignments: Map<string, string> } | null
  startTrackId: string
  previewAnchorTrackId: string
  trackIndexById: Map<string, number>
  tracks: TimelineTrack[]
  previewVisualTopByTrackId: Map<string, number>
  frameToPixels: (frames: number) => number
  isAltDrag: boolean
  anchorItemId: string
}): DragPreviewOffsets {
  const {
    draggedItems,
    currentItemById,
    currentItems,
    currentItemsByTrackId,
    deltaFrames,
    deltaY,
    snapDuration,
    snapStartFrame,
    rawGroupStartFrame,
    snapResult,
    previewTrackTargets,
    startTrackId,
    previewAnchorTrackId,
    trackIndexById,
    tracks,
    previewVisualTopByTrackId,
    frameToPixels,
    isAltDrag,
    anchorItemId,
  } = options
  const previewSnapDelta = snapDuration > 0 ? snapResult.snappedFrame - snapStartFrame : 0
  let minProposedFrame = Infinity

  for (const draggedItem of draggedItems) {
    const proposedStart = draggedItem.initialFrame + deltaFrames + previewSnapDelta
    if (proposedStart < minProposedFrame) {
      minProposedFrame = proposedStart
    }
  }

  const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0
  const previewMovedItems = buildPreviewMovedItems({
    draggedItems,
    currentItemById,
    deltaFrames,
    previewSnapDelta,
    groupClampOffset,
    previewTrackTargets,
    startTrackId,
    previewAnchorTrackId,
    trackIndexById,
    tracks,
  })
  clampPreviewGroupToWalls({ previewMovedItems, currentItems, currentItemsByTrackId, isAltDrag })

  const previewOffsets = buildPreviewOffsets(
    previewMovedItems,
    previewVisualTopByTrackId,
    frameToPixels,
    deltaY,
  )
  return {
    previewOffsets,
    anchorPreviewOffset: previewOffsets[anchorItemId] ?? {
      x: frameToPixels(
        Math.max(0, rawGroupStartFrame + previewSnapDelta) - rawGroupStartFrame + deltaFrames,
      ),
      y: deltaY,
    },
    linkedPreviewMovedItems: previewMovedItems.map((previewItem) => ({
      id: previewItem.id,
      from: previewItem.newFrom,
    })),
  }
}

function buildSingleItemDragPreview(options: {
  snapResult: { snappedFrame: number }
  previewTrackTargets: { trackAssignments: Map<string, string> } | null
  previewAnchorTrackId: string
  draggedItems: DragState['draggedItems']
  itemDurationInFrames: number
  currentItems: TimelineItem[]
  currentItemsByTrackId: Map<string, TimelineItem[]>
  isAltDrag: boolean
  startTrackId: string
  startFrame: number
  itemId: string
  previewVisualTopByTrackId: Map<string, number>
  frameToPixels: (frames: number) => number
  deltaY: number
}): DragPreviewOffsets {
  const {
    snapResult,
    previewTrackTargets,
    previewAnchorTrackId,
    draggedItems,
    itemDurationInFrames,
    currentItems,
    currentItemsByTrackId,
    isAltDrag,
    startTrackId,
    startFrame,
    itemId,
    previewVisualTopByTrackId,
    frameToPixels,
    deltaY,
  } = options
  const previewProposedFrame = Math.max(0, snapResult.snappedFrame)
  const previewTargetTrackId =
    previewTrackTargets?.trackAssignments.get(itemId) ?? previewAnchorTrackId
  // Clamp to track walls so the preview can't visually overlap other clips
  const dragExcludeIds = new Set(draggedItems.map((d) => d.id))
  const previewFinalFrame = isAltDrag
    ? previewProposedFrame
    : clampToTrackWalls(
        previewProposedFrame,
        itemDurationInFrames,
        previewTargetTrackId,
        dragExcludeIds,
        currentItems,
        currentItemsByTrackId,
      )
  const currentTop = previewVisualTopByTrackId.get(startTrackId)
  const targetTop = previewVisualTopByTrackId.get(previewTargetTrackId)
  return {
    previewOffsets: null,
    anchorPreviewOffset: {
      x: frameToPixels((previewFinalFrame ?? startFrame) - startFrame),
      y: currentTop !== undefined && targetTop !== undefined ? targetTop - currentTop : deltaY,
    },
    linkedPreviewMovedItems:
      previewFinalFrame !== null ? [{ id: itemId, from: previewFinalFrame }] : [],
  }
}

type DragDropTarget = {
  trackId: string
  zone: LinkedDragDropZone | null
  createNew?: boolean
}

interface ResolvedDragDropTargets {
  dropTarget: DragDropTarget
  previewTrackTargets: {
    tracks: TimelineTrack[]
    trackAssignments: Map<string, string>
  } | null
  hoveredCompatibleTrackId: string | null
  hasInvalidExplicitDropTarget: boolean
  linkedDropTarget: {
    trackId: string
    zone: LinkedDragDropZone
    createNew?: boolean
  } | null
  previewAnchorTrackId: string
}

function resolveDragDropTargets(options: {
  clientY: number
  startTrackId: string
  itemType: TimelineItem['type']
  itemId: string
  draggedItems: DragState['draggedItems']
  tracks: TimelineTrack[]
  currentItems: TimelineItem[]
  getTrackDropTarget: (mouseY: number, startTrackId: string) => DragDropTarget
  getCompatibleTrackIdFromMouseY: (
    mouseY: number,
    startTrackId: string,
    itemType: TimelineItem['type'],
  ) => string | null
}): ResolvedDragDropTargets {
  const {
    clientY,
    startTrackId,
    itemType,
    itemId,
    draggedItems,
    tracks,
    currentItems,
    getTrackDropTarget,
    getCompatibleTrackIdFromMouseY,
  } = options
  const dropTarget = getTrackDropTarget(clientY, startTrackId)
  const previewTrackTargets = resolveDraggedTrackTargets({
    items: currentItems,
    draggedItems,
    tracks,
    dropTarget,
    preferredTrackHeight:
      tracks.find((track) => track.id === dropTarget.trackId)?.height ??
      tracks.find((track) => track.id === startTrackId)?.height ??
      64,
  })
  const hoveredCompatibleTrackId = getCompatibleTrackIdFromMouseY(clientY, startTrackId, itemType)
  const hasInvalidExplicitDropTarget =
    dropTarget.zone !== null && !previewTrackTargets && hoveredCompatibleTrackId === null
  const linkedDropTarget =
    dropTarget.zone && !hasInvalidExplicitDropTarget
      ? { trackId: dropTarget.trackId, zone: dropTarget.zone, createNew: dropTarget.createNew }
      : null
  const previewAnchorTrackId =
    previewTrackTargets?.trackAssignments.get(itemId) ?? hoveredCompatibleTrackId ?? startTrackId
  return {
    dropTarget,
    previewTrackTargets,
    hoveredCompatibleTrackId,
    hasInvalidExplicitDropTarget,
    linkedDropTarget,
    previewAnchorTrackId,
  }
}

function resolveDragCursor(hasInvalidExplicitDropTarget: boolean, altKey: boolean): DragCursorMode {
  if (hasInvalidExplicitDropTarget) return 'not-allowed'
  return altKey ? 'copy' : 'grabbing'
}

function syncDragPreviewStores(options: {
  prevSnapTargetRef: { current: { frame: number; type: string } | null }
  snapTarget: SnapTarget | null
  prevLinkedDropTarget: ReturnType<typeof useSelectionStore.getState>['activeLinkedDropTarget']
  linkedDropTarget: ResolvedDragDropTargets['linkedDropTarget']
  setActiveSnapTarget: ReturnType<typeof useSelectionStore.getState>['setActiveSnapTarget']
  setActiveLinkedDropTarget: ReturnType<
    typeof useSelectionStore.getState
  >['setActiveLinkedDropTarget']
  setDragState: ReturnType<typeof useSelectionStore.getState>['setDragState']
  altKeyChanged: boolean
  dragStateRef: { current: DragState | null }
  clampedDeltaX: number
  deltaY: number
  altKey: boolean
}): void {
  const {
    prevSnapTargetRef,
    snapTarget,
    prevLinkedDropTarget,
    linkedDropTarget,
    setActiveSnapTarget,
    setActiveLinkedDropTarget,
    setDragState,
    altKeyChanged,
    dragStateRef,
    clampedDeltaX,
    deltaY,
    altKey,
  } = options
  const linkedDropChanged = haveLinkedDropTargetsChanged(prevLinkedDropTarget, linkedDropTarget)
  const snapChanged = haveSnapTargetsChanged(prevSnapTargetRef.current, snapTarget)
  if (!snapChanged && !altKeyChanged && !linkedDropChanged) return
  prevSnapTargetRef.current = snapTarget ? { frame: snapTarget.frame, type: snapTarget.type } : null
  setActiveSnapTarget(snapTarget)
  setActiveLinkedDropTarget(linkedDropTarget)
  if (!altKeyChanged) return
  const draggedIds = dragStateRef.current?.draggedItems.map((dragged) => dragged.id) || []
  setDragState({
    isDragging: true,
    draggedItemIds: draggedIds,
    offset: { x: clampedDeltaX, y: deltaY },
    isAltDrag: altKey,
  })
}

function haveSnapTargetsChanged(
  prevSnap: { frame: number; type: string } | null,
  newSnap: { frame: number; type: string } | null,
): boolean {
  return (
    (prevSnap === null && newSnap !== null) ||
    (prevSnap !== null && newSnap === null) ||
    (prevSnap !== null &&
      newSnap !== null &&
      (prevSnap.frame !== newSnap.frame || prevSnap.type !== newSnap.type))
  )
}

function haveLinkedDropTargetsChanged(
  prev: ReturnType<typeof useSelectionStore.getState>['activeLinkedDropTarget'],
  next: { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean } | null,
): boolean {
  return (
    (prev === null && next !== null) ||
    (prev !== null && next === null) ||
    (prev !== null &&
      next !== null &&
      (prev.trackId !== next.trackId ||
        prev.zone !== next.zone ||
        !!prev.createNew !== !!next.createNew))
  )
}

export function useTimelineDrag(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
  elementRef?: React.RefObject<HTMLDivElement | null>,
): UseTimelineDragReturn {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<DragState | null>(null)
  const dragVisualTopByTrackIdRef = useRef<Map<string, number>>(new Map())
  const dragDropGeometryRef = useRef<DragDropGeometry | null>(null)
  const dragItemIndexCacheRef = useRef<{
    items: TimelineItem[]
    tracks: TimelineTrack[]
    value: ReturnType<typeof snapshotDragItemIndexes>
  } | null>(null)
  const linkedMovePreviewSignatureRef = useRef('')

  // Track Alt key state for duplication mode (dynamic toggle during drag)
  const isAltDragRef = useRef(false)

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null)

  // Get store state with granular selectors
  const tracks = useItemsStore((s) => s.tracks)
  // NOTE: Don't subscribe to items here! Every TimelineItem has this hook,
  // subscribing to items would cause ALL items to re-render when ANY item changes.
  // Instead, read items on-demand in callbacks using getState().

  // Selection store - use granular selectors to prevent re-renders
  // NOTE: dragState subscription removed - activeSnapTarget is read directly in timeline-content.tsx
  const selectItems = useSelectionStore((s) => s.selectItems)
  const setDragState = useSelectionStore((s) => s.setDragState)
  const setActiveSnapTarget = useSelectionStore((s) => s.setActiveSnapTarget)
  const setActiveLinkedDropTarget = useSelectionStore((s) => s.setActiveLinkedDropTarget)

  const clearLinkedMovePreview = useCallback(() => {
    if (linkedMovePreviewSignatureRef.current === '') {
      return
    }

    linkedMovePreviewSignatureRef.current = ''
    useLinkedEditPreviewStore.getState().clear()
  }, [])

  const setLinkedMovePreview = useCallback(
    (currentItems: TimelineItem[], movedItems: Array<{ id: string; from: number }>) => {
      const previewUpdates = buildLinkedMovePreviewUpdates(currentItems, movedItems)
      const signature = previewUpdates
        .map((update) => `${update.id}:${update.from ?? ''}`)
        .join('|')

      if (signature === linkedMovePreviewSignatureRef.current) {
        return
      }

      linkedMovePreviewSignatureRef.current = signature

      if (previewUpdates.length === 0) {
        useLinkedEditPreviewStore.getState().clear()
        return
      }

      useLinkedEditPreviewStore.getState().setUpdates(previewUpdates)
    },
    [],
  )

  // Get zoom utilities
  // Zoom conversions are read imperatively (via store.getState()) at call-time
  // to avoid subscribing every TimelineItem to the live zoom store.
  const pixelsToFramePrecise = pixelsToFramePreciseNow
  const frameToPixels = frameToPixelsNow

  // Build magnetic targets only after the drag threshold is crossed. The
  // gesture's actual cohort is excluded for moves; Alt-drag keeps originals.
  const { getMagneticSnapTargets, getSnapThresholdFrames, isSnapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id,
    { includeTransitionMidpoints: false },
  )

  // Create stable refs to avoid stale closures in event listeners
  const frameToPixelsRef = useRef(frameToPixels)
  const pixelsToFramePreciseRef = useRef(pixelsToFramePrecise)
  const moveItemRef = useRef(moveItem)
  const moveItemsRef = useRef(moveItems)
  const moveItemsWithTrackChangesRef = useRef(moveItemsWithTrackChanges)
  const duplicateItemsRef = useRef(duplicateItems)
  const duplicateItemsWithTrackChangesRef = useRef(duplicateItemsWithTrackChanges)
  const tracksRef = useRef(tracks)

  // Helper to get items on-demand (avoids subscription that would cause all items to re-render)
  const getItems = useCallback(() => useItemsStore.getState().items, [])
  // Item/track lookup maps are stable for a given items-array + tracks-array
  // pair, so pointer moves can reuse them instead of rebuilding Maps per frame.
  const getDragItemIndexes = useCallback((items: TimelineItem[], tracks: TimelineTrack[]) => {
    const cached = dragItemIndexCacheRef.current
    if (cached && cached.items === items && cached.tracks === tracks) {
      return cached.value
    }
    const value = snapshotDragItemIndexes(items, tracks)
    dragItemIndexCacheRef.current = { items, tracks, value }
    return value
  }, [])
  // Update refs synchronously (not in useEffect) so they're always current
  const magneticSnapTargetsRef = useRef<SnapTarget[]>([])
  const getSnapThresholdFramesRef = useRef(getSnapThresholdFrames)
  getSnapThresholdFramesRef.current = getSnapThresholdFrames

  // Update refs when dependencies change
  useEffect(() => {
    frameToPixelsRef.current = frameToPixels
    pixelsToFramePreciseRef.current = pixelsToFramePrecise
    moveItemRef.current = moveItem
    moveItemsRef.current = moveItems
    moveItemsWithTrackChangesRef.current = moveItemsWithTrackChanges
    duplicateItemsRef.current = duplicateItems
    duplicateItemsWithTrackChangesRef.current = duplicateItemsWithTrackChanges
    tracksRef.current = tracks
  }, [frameToPixels, pixelsToFramePrecise, tracks])

  /**
   * Cached row geometry for the current tracks array, with live pane scroll
   * offsets applied. Reading DOM rects for every row on every pointer move
   * forced a layout each frame; this keeps reads to one rect per pane.
   */
  const getDragDropGeometry = useCallback((tracks: TimelineTrack[]) => {
    const cached = dragDropGeometryRef.current
    const geometry = cached && cached.tracks === tracks ? cached : captureDragDropGeometry(tracks)
    dragDropGeometryRef.current = geometry
    return { trackContainer: geometry.trackContainer, rows: resolveDragDropRowBounds(geometry) }
  }, [])

  /**
   * Calculate which track the mouse is over based on Y position
   */
  const getTrackIdFromMouseY = useCallback(
    (mouseY: number, startTrackId: string): string => {
      const tracks = tracksRef.current
      const { rows } = getDragDropGeometry(tracks)

      // Find track row under cursor
      for (const row of rows) {
        if (mouseY >= row.top && mouseY <= row.bottom) {
          return row.trackId
        }
      }

      // Fallback to calculating by track height
      const startTrack = tracks.find((t) => t.id === startTrackId)
      if (!startTrack) return startTrackId

      const startTrackIndex = tracks.findIndex((t) => t.id === startTrackId)
      const trackHeight = startTrack.height || 64
      const deltaY = mouseY - (dragStateRef.current?.startMouseY || 0)
      const trackOffset = Math.round(deltaY / trackHeight)
      const newTrackIndex = Math.max(0, Math.min(tracks.length - 1, startTrackIndex + trackOffset))

      return tracks[newTrackIndex]?.id || startTrackId
    },
    [getDragDropGeometry],
  )

  const getTrackDropTarget = useCallback(
    (
      mouseY: number,
      startTrackId: string,
    ): { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean } => {
      const { trackContainer, rows: trackRows } = getDragDropGeometry(tracksRef.current)

      const dragState = dragStateRef.current
      const startTrack = tracksRef.current.find((track) => track.id === startTrackId)
      const crossTrackThreshold = startTrack
        ? Math.max(CROSS_TRACK_SNAP_THRESHOLD_PX, Math.round(startTrack.height * 0.25))
        : CROSS_TRACK_SNAP_THRESHOLD_PX
      if (dragState && Math.abs(mouseY - dragState.startMouseY) < crossTrackThreshold) {
        return { trackId: startTrackId, zone: null }
      }

      const firstVideoTrack = tracksRef.current.find((track) => getTrackKind(track) === 'video')
      const lastAudioTrack = [...tracksRef.current]
        .reverse()
        .find((track) => getTrackKind(track) === 'audio')

      if (trackContainer && trackRows.length > 0) {
        const trackContainerRect = trackContainer.getBoundingClientRect()
        const firstRow = trackRows[0]!
        const lastRow = trackRows[trackRows.length - 1]!

        if (firstVideoTrack && mouseY >= trackContainerRect.top && mouseY < firstRow.top) {
          return { trackId: firstVideoTrack.id, zone: 'video', createNew: true }
        }
        if (lastAudioTrack && mouseY > lastRow.bottom && mouseY <= trackContainerRect.bottom) {
          return { trackId: lastAudioTrack.id, zone: 'audio', createNew: true }
        }
      }

      for (const row of trackRows) {
        const { trackId } = row
        if (mouseY < row.top || mouseY > row.bottom) continue

        const hoveredTrack = tracksRef.current.find((track) => track.id === trackId)
        const hoveredKind = hoveredTrack ? getTrackKind(hoveredTrack) : null
        if (hoveredKind === 'video' || hoveredKind === 'audio') {
          return {
            trackId,
            createNew: false,
            zone: hoveredKind,
          }
        }

        return {
          trackId,
          zone: null,
        }
      }

      return {
        trackId: getTrackIdFromMouseY(mouseY, startTrackId),
        zone: null,
      }
    },
    [getTrackIdFromMouseY, getDragDropGeometry],
  )

  const getCompatibleTrackIdFromMouseY = useCallback(
    (mouseY: number, startTrackId: string, itemType: TimelineItem['type']): string | null => {
      const hoveredTrackId = getTrackIdFromMouseY(mouseY, startTrackId)
      const compatibleTrack = findCompatibleTrackForItemType({
        tracks: tracksRef.current,
        items: getItems(),
        itemType,
        preferredTrackId: hoveredTrackId,
        allowPreferredTrackFallback: false,
      })

      return compatibleTrack?.id ?? null
    },
    [getItems, getTrackIdFromMouseY],
  )

  /**
   * Calculate magnetic snap for item position (start and end edges)
   * Only snaps to other item edges, not grid lines
   */
  const calculateMagneticSnap = useCallback(
    (
      targetStartFrame: number,
      itemDurationInFrames: number,
    ): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      const targets = magneticSnapTargetsRef.current
      const threshold = getSnapThresholdFramesRef.current()
      const enabled = isSnapEnabled()

      if (!enabled || targets.length === 0) {
        return { snappedFrame: targetStartFrame, snapTarget: null }
      }

      const targetEndFrame = targetStartFrame + itemDurationInFrames

      // Find nearest snap for start position
      const nearestStartTarget = findNearestSnapTarget(
        targetStartFrame,
        targets,
        threshold,
      )
      // Find nearest snap for end position
      const nearestEndTarget = findNearestSnapTarget(targetEndFrame, targets, threshold)

      const startDistance = nearestStartTarget
        ? Math.abs(targetStartFrame - nearestStartTarget.frame)
        : Infinity
      const endDistance = nearestEndTarget
        ? Math.abs(targetEndFrame - nearestEndTarget.frame)
        : Infinity

      // Use the closer snap
      if (startDistance < endDistance && nearestStartTarget) {
        return { snappedFrame: nearestStartTarget.frame, snapTarget: nearestStartTarget }
      } else if (nearestEndTarget) {
        // Snap end, adjust start position
        return {
          snappedFrame: nearestEndTarget.frame - itemDurationInFrames,
          snapTarget: nearestEndTarget,
        }
      }

      return { snappedFrame: targetStartFrame, snapTarget: null }
    },
    [isSnapEnabled],
  )

  /**
   * Handle mouse down - start dragging
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Don't allow dragging on locked tracks
      if (trackLocked) {
        return
      }

      // Prevent if clicking on resize handles
      const target = e.target as HTMLElement
      if (target.classList.contains('cursor-ew-resize')) {
        return
      }

      e.stopPropagation()

      // Check if this item is in current selection
      const currentSelectedIds = useSelectionStore.getState().selectedItemIds
      const isInSelection = currentSelectedIds.includes(item.id)

      const allItems = getItems()
      const currentTracks = tracksRef.current
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled

      // If not in selection, select it (multi-select handled by TimelineItem's onClick).
      // Skip when a multi-select modifier is held: replacing the selection here
      // would wipe the existing multi-selection, and the click handler's additive
      // toggle would then read this clip as "already selected" and remove it again.
      const isMultiSelectClick = e.ctrlKey || e.metaKey
      const linkedIds = linkedSelectionEnabled ? getLinkedItemIds(allItems, item.id) : [item.id]
      if (!isInSelection && !isMultiSelectClick) {
        selectItems(linkedIds)
      }

      // Determine which items to drag and snapshot their initial positions
      const { baseItemsToDrag, draggedItems } = resolveDraggedItemStates(
        allItems,
        currentTracks,
        currentSelectedIds,
        isInSelection,
        linkedIds,
        linkedSelectionEnabled,
      )
      // Compare cohort *contents*, not just lengths: a same-size but
      // differently-composed drag cohort (e.g. linked items swapped in) must
      // still re-sync the selection.
      const selectedIdSet = new Set(currentSelectedIds)
      const cohortMatchesSelection =
        baseItemsToDrag.length === selectedIdSet.size &&
        baseItemsToDrag.every((id) => selectedIdSet.has(id))
      if (isInSelection && !cohortMatchesSelection) {
        selectItems(baseItemsToDrag)
      }

      // Initialize drag state
      dragStateRef.current = {
        itemId: item.id, // Anchor item
        startFrame: item.from,
        startTrackId: item.trackId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        currentMouseX: e.clientX,
        currentMouseY: e.clientY,
        draggedItems,
      }
      // Capture geometry before any selected clip receives a preview transform.
      // Relative track deltas stay stable during vertical scrolling, so pointer
      // moves can derive every preview offset without forcing layout again.
      dragVisualTopByTrackIdRef.current = captureTrackVisualTops()
      dragDropGeometryRef.current = null

      // Don't set cursor immediately - wait for drag threshold

      // Attach a temporary mousemove listener to detect drag threshold
      const checkDragThreshold = (e: MouseEvent) => {
        if (!dragStateRef.current) return

        const deltaX = e.clientX - dragStateRef.current.startMouseX
        const deltaY = e.clientY - dragStateRef.current.startMouseY

        // Check if we've moved enough to start dragging
        if (Math.abs(deltaX) > DRAG_THRESHOLD_PIXELS || Math.abs(deltaY) > DRAG_THRESHOLD_PIXELS) {
          // Start the drag - track Alt key state
          isAltDragRef.current = e.altKey
          setIsDragging(true)
          setGlobalDragCursor(e.altKey ? 'copy' : 'grabbing')
          document.body.style.userSelect = 'none'

          // Broadcast drag state to all selected items
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || []
          magneticSnapTargetsRef.current = getMagneticSnapTargets(e.altKey ? null : draggedIds)
          if (e.altKey) {
            startLargeAltDragCanvas(draggedIds)
          }
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: 0, y: 0 },
            isAltDrag: e.altKey,
          })
          setActiveSnapTarget(null)
          setActiveLinkedDropTarget(null)
          clearLinkedMovePreview()

          // Remove this listener - the main useEffect will handle it now
          window.removeEventListener('mousemove', checkDragThreshold)
          window.removeEventListener('mouseup', cancelDrag)
        }
      }

      const cancelDrag = () => {
        // Clean up if mouse released before threshold
        dragStateRef.current = null
        magneticSnapTargetsRef.current = []
        dragVisualTopByTrackIdRef.current.clear()
        dragDropGeometryRef.current = null
        dragPreviewOffsetByItemRef.current = {}
        clearLargeAltDragCanvas()
        clearLinkedMovePreview()
        window.removeEventListener('mousemove', checkDragThreshold)
        window.removeEventListener('mouseup', cancelDrag)
      }

      window.addEventListener('mousemove', checkDragThreshold)
      window.addEventListener('mouseup', cancelDrag)
    },
    [
      clearLinkedMovePreview,
      item.id,
      item.from,
      item.trackId,
      selectItems,
      trackLocked,
      setActiveLinkedDropTarget,
      setActiveSnapTarget,
      setDragState,
      getItems,
      getMagneticSnapTargets,
    ],
  )

  /**
   * Handle mouse move - update drag position
   */
  useEffect(() => {
    if (!dragStateRef.current || !isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return

      const deltaX = e.clientX - dragStateRef.current.startMouseX
      const deltaY = e.clientY - dragStateRef.current.startMouseY

      // Dynamic Alt key toggle - update state and cursor
      const altKeyChanged = syncAltDragToggle(
        e,
        isAltDragRef,
        dragStateRef.current,
        getMagneticSnapTargets,
        magneticSnapTargetsRef,
      )

      // Calculate clamped delta to prevent visual preview from going below frame 0
      const deltaFrames = pixelsToFramePreciseRef.current(deltaX)
      const draggedItems = dragStateRef.current.draggedItems
      const { clampedDeltaX } = clampDragDeltaToZero(draggedItems, deltaFrames, deltaX)

      const currentItems = getItems()
      const { currentItemById, currentItemsByTrackId, trackIndexById } = getDragItemIndexes(
        currentItems,
        tracksRef.current,
      )
      const {
        previewTrackTargets,
        hasInvalidExplicitDropTarget,
        linkedDropTarget,
        previewAnchorTrackId,
      } = resolveDragDropTargets({
        clientY: e.clientY,
        startTrackId: dragStateRef.current.startTrackId,
        itemType: item.type,
        itemId: dragStateRef.current.itemId,
        draggedItems: dragStateRef.current.draggedItems,
        tracks: tracksRef.current,
        currentItems,
        getTrackDropTarget,
        getCompatibleTrackIdFromMouseY,
      })
      dragStateRef.current.currentMouseX = e.clientX
      dragStateRef.current.currentMouseY = e.clientY

      setGlobalDragCursor(resolveDragCursor(hasInvalidExplicitDropTarget, e.altKey))

      // For multi-item drag, calculate group bounding box for snap visualization
      // Note: deltaFrames and draggedItems already calculated above for clamping
      const { snapStartFrame, snapDuration, rawGroupStartFrame } = buildGroupSnapWindow({
        draggedItems,
        currentItemById,
        deltaFrames,
        startFrame: dragStateRef.current.startFrame,
        itemId: dragStateRef.current.itemId,
      })

      const snapResult = calculateMagneticSnap(snapStartFrame, snapDuration)
      const previewVisualTopByTrackId = buildTrackVisualTopMap(
        (previewTrackTargets?.tracks ?? tracksRef.current).map((track) => ({
          id: track.id,
          order: track.order ?? 0,
          height: track.height,
          kind: getTrackKind(track),
        })),
        dragVisualTopByTrackIdRef.current,
      )
      let previewOffsets: Record<string, { x: number; y: number }> | null = null
      let anchorPreviewOffset = { x: clampedDeltaX, y: deltaY }
      let linkedPreviewMovedItems: Array<{ id: string; from: number }> = []

      if (draggedItems.length > 1) {
        const multiPreview = buildMultiItemDragPreview({
          draggedItems,
          currentItemById,
          currentItems,
          currentItemsByTrackId,
          deltaFrames,
          deltaY,
          snapDuration,
          snapStartFrame,
          rawGroupStartFrame,
          snapResult,
          previewTrackTargets,
          startTrackId: dragStateRef.current.startTrackId,
          previewAnchorTrackId,
          trackIndexById,
          tracks: tracksRef.current,
          previewVisualTopByTrackId,
          frameToPixels: frameToPixelsRef.current,
          isAltDrag: isAltDragRef.current,
          anchorItemId: dragStateRef.current.itemId,
        })
        previewOffsets = multiPreview.previewOffsets
        anchorPreviewOffset = multiPreview.anchorPreviewOffset
        linkedPreviewMovedItems = multiPreview.linkedPreviewMovedItems
      } else {
        const singlePreview = buildSingleItemDragPreview({
          snapResult,
          previewTrackTargets,
          previewAnchorTrackId,
          draggedItems,
          itemDurationInFrames: item.durationInFrames,
          currentItems,
          currentItemsByTrackId,
          isAltDrag: isAltDragRef.current,
          startTrackId: dragStateRef.current.startTrackId,
          startFrame: dragStateRef.current.startFrame,
          itemId: dragStateRef.current.itemId,
          previewVisualTopByTrackId,
          frameToPixels: frameToPixelsRef.current,
          deltaY,
        })
        previewOffsets = singlePreview.previewOffsets
        anchorPreviewOffset = singlePreview.anchorPreviewOffset
        linkedPreviewMovedItems = singlePreview.linkedPreviewMovedItems
      }

      if (isAltDragRef.current) {
        clearLinkedMovePreview()
      } else {
        setLinkedMovePreview(currentItems, linkedPreviewMovedItems)
      }

      if (elementRef?.current && !isAltDragRef.current) {
        elementRef.current.style.transform = `translate(${anchorPreviewOffset.x}px, ${anchorPreviewOffset.y}px)`
      }

      dragOffsetRef.current = anchorPreviewOffset
      const safePreviewOffsets = previewOffsets ?? {}
      dragPreviewOffsetByItemRef.current = safePreviewOffsets
      if (isAltDragRef.current) {
        updateLargeAltDragCanvas(safePreviewOffsets, anchorPreviewOffset)
      }
      setDragOffset(anchorPreviewOffset)

      // Only update store when snap target or alt state actually changes to reduce re-renders
      syncDragPreviewStores({
        prevSnapTargetRef,
        snapTarget: snapResult.snapTarget,
        prevLinkedDropTarget: useSelectionStore.getState().activeLinkedDropTarget,
        linkedDropTarget,
        setActiveSnapTarget,
        setActiveLinkedDropTarget,
        setDragState,
        altKeyChanged,
        dragStateRef,
        clampedDeltaX,
        deltaY,
        altKey: e.altKey,
      })
    }

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return

      const dragState = dragStateRef.current
      const deltaX = dragState.currentMouseX - dragState.startMouseX
      const isAltDrag = isAltDragRef.current

      // Calculate frame delta
      const deltaFrames = pixelsToFramePreciseRef.current(deltaX)

      const currentItems = getItems()
      const dropTarget = getTrackDropTarget(dragState.currentMouseY, dragState.startTrackId)
      const resolvedTrackTargets = resolveDraggedTrackTargets({
        items: currentItems,
        draggedItems: dragState.draggedItems,
        tracks: tracksRef.current,
        dropTarget,
        preferredTrackHeight:
          tracksRef.current.find((track) => track.id === dropTarget.trackId)?.height ??
          tracksRef.current.find((track) => track.id === dragState.startTrackId)?.height ??
          64,
      })

      // Calculate new track for anchor item
      const newTrackId =
        resolvedTrackTargets?.trackAssignments.get(dragState.itemId) ??
        getCompatibleTrackIdFromMouseY(dragState.currentMouseY, dragState.startTrackId, item.type)

      // Multi-item drag or single?
      if (newTrackId === null) {
        logger.warn('Cannot move items to an incompatible track')
      } else if (dragState.draggedItems.length > 1) {
        // Multi-item drag: calculate group bounding box for snapping
        // Snap should only happen at the edges of the entire selection, not individual items
        let groupStartFrame = Infinity
        let groupEndFrame = -Infinity

        for (const draggedItem of dragState.draggedItems) {
          const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
          if (!sourceItem) continue

          const proposedStart = draggedItem.initialFrame + deltaFrames
          const proposedEnd = proposedStart + sourceItem.durationInFrames

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd
        }

        // Ensure valid bounds
        groupStartFrame = Math.max(0, groupStartFrame)
        const groupDuration = groupEndFrame - groupStartFrame

        // Calculate snap using the group's bounding box
        let snapDelta = 0
        if (groupDuration > 0) {
          const snapResult = calculateMagneticSnap(groupStartFrame, groupDuration)
          snapDelta = snapResult.snappedFrame - groupStartFrame
        }

        // Calculate how much we need to clamp the group to prevent any item going below frame 0
        // Find the minimum proposed start frame across all items
        let minProposedFrame = Infinity
        for (const draggedItem of dragState.draggedItems) {
          const proposedStart = draggedItem.initialFrame + deltaFrames + snapDelta
          if (proposedStart < minProposedFrame) {
            minProposedFrame = proposedStart
          }
        }

        // Calculate group clamp offset - if any item would go below 0, shift the whole group
        const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0

        // Multi-item drag: calculate new positions for all items
        const movedItems = dragState.draggedItems
          .map((draggedItem) => {
            const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
            if (!sourceItem) return null

            // Calculate new frame (maintain relative offset from anchor)
            // Apply frame delta, snap adjustment, AND group clamp offset to all items uniformly
            const newFrom = draggedItem.initialFrame + deltaFrames + snapDelta + groupClampOffset

            let itemNewTrackId = resolvedTrackTargets?.trackAssignments.get(draggedItem.id)
            if (!itemNewTrackId) {
              const anchorTrackIndex = tracksRef.current.findIndex(
                (t) => t.id === dragState.startTrackId,
              )
              const itemTrackIndex = tracksRef.current.findIndex(
                (t) => t.id === draggedItem.initialTrackId,
              )
              const newAnchorTrackIndex = tracksRef.current.findIndex((t) => t.id === newTrackId)
              const trackOffset = itemTrackIndex - anchorTrackIndex
              const newItemTrackIndex = Math.max(
                0,
                Math.min(tracksRef.current.length - 1, newAnchorTrackIndex + trackOffset),
              )

              itemNewTrackId =
                tracksRef.current[newItemTrackIndex]?.id || draggedItem.initialTrackId
            }

            return {
              id: draggedItem.id,
              newFrom,
              newTrackId: itemNewTrackId,
              durationInFrames: sourceItem.durationInFrames,
            }
          })
          .filter((i) => i !== null) as Array<{
          id: string
          newFrom: number
          newTrackId: string
          durationInFrames: number
        }>

        // For multi-item drag: check if ANY item would collide, and if so, snap the whole group forward
        // Find the earliest collision among all moved items
        const draggedItemIds = movedItems.map((m) => m.id)
        // For alt-drag (duplicate), include all items in collision check since originals stay in place
        const itemsExcludingDragged = isAltDrag
          ? currentItems
          : currentItems.filter((i) => !draggedItemIds.includes(i.id))

        let maxSnapForward = 0 // largest positive shift needed
        let maxSnapBackward = 0 // largest negative shift needed (stored as negative)

        for (const movedItem of movedItems) {
          const finalPosition = findNearestAvailableSpace(
            movedItem.newFrom,
            movedItem.durationInFrames,
            movedItem.newTrackId,
            itemsExcludingDragged,
          )

          if (finalPosition === null) {
            logger.warn(
              isAltDrag
                ? 'Cannot duplicate items: no available space'
                : 'Cannot move items: no available space',
            )
            // Clean up and cancel - defer drag state to avoid render cascade
            if (elementRef?.current) {
              elementRef.current.style.transform = ''
            }
            dragOffsetRef.current = { x: 0, y: 0 }
            dragVisualTopByTrackIdRef.current.clear()
            dragDropGeometryRef.current = null
            dragPreviewOffsetByItemRef.current = {}
            clearLargeAltDragCanvas()
            clearLinkedMovePreview()
            prevSnapTargetRef.current = null
            magneticSnapTargetsRef.current = []
            dragStateRef.current = null
            isAltDragRef.current = false
            clearGlobalDragCursor()
            document.body.style.userSelect = ''
            setIsDragging(false)
            setDragOffset({ x: 0, y: 0 })
            queueMicrotask(() => {
              setActiveSnapTarget(null)
              setActiveLinkedDropTarget(null)
              setDragState(null)
            })
            return
          }

          const snapAmount = finalPosition - movedItem.newFrom
          if (snapAmount > maxSnapForward) {
            maxSnapForward = snapAmount
          }
          if (snapAmount < maxSnapBackward) {
            maxSnapBackward = snapAmount
          }
        }

        // Pick whichever direction has the larger correction needed
        const groupSnapDelta =
          Math.abs(maxSnapForward) >= Math.abs(maxSnapBackward) ? maxSnapForward : maxSnapBackward

        if (isAltDrag) {
          // ALT-DRAG: Duplicate items at new positions
          const itemIds = movedItems.map((m) => m.id)
          const positions = movedItems.map((m) => ({
            from: Math.round(m.newFrom + groupSnapDelta),
            trackId: m.newTrackId,
          }))

          if (resolvedTrackTargets) {
            duplicateItemsWithTrackChangesRef.current(
              resolvedTrackTargets.tracks,
              itemIds,
              positions,
            )
          } else {
            duplicateItemsRef.current(itemIds, positions)
          }
        } else {
          // Normal drag: Apply the snap to ALL items in the group
          const currentItemsById = new Map(currentItems.map((item) => [item.id, item]))
          const allUpdates = movedItems.map((m) => ({
            id: m.id,
            from: Math.round(m.newFrom + groupSnapDelta),
            trackId:
              m.newTrackId !== currentItemsById.get(m.id)?.trackId
                ? m.newTrackId
                : undefined,
          }))

          if (resolvedTrackTargets) {
            moveItemsWithTrackChangesRef.current(resolvedTrackTargets.tracks, allUpdates)
          } else {
            moveItemsRef.current(allUpdates)
          }
        }
      } else {
        // Single item drag
        let proposedFrame = Math.max(0, dragState.startFrame + deltaFrames)

        // Apply snapping
        const snapResult = calculateMagneticSnap(proposedFrame, item.durationInFrames)
        // Clamp after snapping to ensure we don't go below frame 0
        proposedFrame = Math.max(0, snapResult.snappedFrame)

        // Find nearest available space (snaps forward if collision)
        // For alt-drag, include the original item in collision check since it stays in place
        const itemsExcludingDragged = isAltDrag
          ? currentItems
          : currentItems.filter((i) => i.id !== item.id)
        const finalFrame = findNearestAvailableSpace(
          proposedFrame,
          item.durationInFrames,
          newTrackId,
          itemsExcludingDragged,
        )

        if (finalFrame !== null) {
          const roundedFinalFrame = Math.round(finalFrame)
          if (isAltDrag) {
            // ALT-DRAG: Duplicate item at new position
            if (resolvedTrackTargets) {
              duplicateItemsWithTrackChangesRef.current(
                resolvedTrackTargets.tracks,
                [item.id],
                [{ from: roundedFinalFrame, trackId: newTrackId }],
              )
            } else {
              duplicateItemsRef.current(
                [item.id],
                [{ from: roundedFinalFrame, trackId: newTrackId }],
              )
            }
          } else {
            // Normal drag: Move item
            const trackChanged = newTrackId !== dragState.startTrackId
            if (resolvedTrackTargets) {
              moveItemsWithTrackChangesRef.current(resolvedTrackTargets.tracks, [
                { id: item.id, from: roundedFinalFrame, trackId: newTrackId },
              ])
            } else {
              moveItemRef.current(item.id, roundedFinalFrame, trackChanged ? newTrackId : undefined)
            }
          }
        } else {
          // No space available - cancel drag (keep at original position)
          logger.warn(
            isAltDrag
              ? 'Cannot duplicate item: no available space'
              : 'Cannot move item: no available space',
          )
        }
      }

      // Clean up - defer drag state clearing to avoid multiple render cycles
      // The move operation already triggered a re-render; clearing drag state
      // should happen after that render completes
      if (elementRef?.current) {
        elementRef.current.style.transform = ''
      }
      dragOffsetRef.current = { x: 0, y: 0 } // Reset shared ref immediately
      dragVisualTopByTrackIdRef.current.clear()
      dragDropGeometryRef.current = null
      dragPreviewOffsetByItemRef.current = {}
      clearLargeAltDragCanvas()
      clearLinkedMovePreview()
      prevSnapTargetRef.current = null // Reset snap target tracking
      magneticSnapTargetsRef.current = []
      dragStateRef.current = null
      isAltDragRef.current = false // Reset alt drag state
      clearGlobalDragCursor()
      document.body.style.userSelect = ''

      // Batch React state updates (React 18 batches these automatically)
      setIsDragging(false)
      setDragOffset({ x: 0, y: 0 })

      // Defer selection store cleanup to next microtask to avoid
      // synchronous re-render cascade after move operation
      queueMicrotask(() => {
        setActiveSnapTarget(null)
        setActiveLinkedDropTarget(null)
        setDragState(null)
      })
    }

    if (dragStateRef.current) {
      const coalescedMouseMove = createRafCoalescedCallback(handleMouseMove)
      const handleCoalescedMouseUp = () => {
        coalescedMouseMove.flush()
        handleMouseUp()
      }

      window.addEventListener('mousemove', coalescedMouseMove.queue)
      window.addEventListener('mouseup', handleCoalescedMouseUp)

      return () => {
        window.removeEventListener('mousemove', coalescedMouseMove.queue)
        window.removeEventListener('mouseup', handleCoalescedMouseUp)
        coalescedMouseMove.cancel()
        magneticSnapTargetsRef.current = []
        dragVisualTopByTrackIdRef.current.clear()
        dragDropGeometryRef.current = null
        clearLargeAltDragCanvas()
        clearLinkedMovePreview()
        clearGlobalDragCursor()
        document.body.style.userSelect = ''
      }
    }
  }, [
    isDragging,
    item.id,
    item.durationInFrames,
    item.type,
    getCompatibleTrackIdFromMouseY,
    getTrackDropTarget,
    calculateMagneticSnap,
    getMagneticSnapTargets,
    clearLinkedMovePreview,
    elementRef,
    getItems,
    getDragItemIndexes,
    setActiveLinkedDropTarget,
    setActiveSnapTarget,
    setDragState,
    setLinkedMovePreview,
  ])

  return {
    isDragging,
    dragOffset,
    handleDragStart,
  }
}
