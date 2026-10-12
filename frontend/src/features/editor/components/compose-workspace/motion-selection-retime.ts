import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  captureSnapshot,
  useKeyframesStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-motion'
import type {
  MotionSelectionDragState,
  MotionSelectionFrameUpdates,
  MotionSelectionTimeRange,
} from './motion-keyframe-selection'
import {
  buildMotionSelectionRetimeUpdates,
  getMotionSelectionTimeRange,
} from './motion-keyframe-selection'
import type { MotionTimeViewport } from './motion-time-viewport-controller'
import type { TimelineItem } from '@/types/timeline'
// Selection retime: the batch keyframe move driven from the ruler range handles.
//
// The drag previews by writing inline transforms and widths straight to the rendered
// keyframe diamonds, connectors and range element, and commits through the keyframes
// store once on release — previewing through React state would re-render the whole
// timeline on every pointer move.
export interface MotionSelectionRetimeDragState {
  pointerId: number
  edge: 'start' | 'end'
  startClientX: number
  rulerWidth: number
  initialEdgeFrame: number
  selection: MotionSelectionDragState
  itemById: Record<string, TimelineItem>
  snapshot: ReturnType<typeof captureSnapshot>
  hasMoved: boolean
  lastUpdates: MotionSelectionFrameUpdates | null
  keyframeVisuals: MotionSelectionRetimeKeyframeVisual[]
  connectorVisuals: MotionSelectionRetimeConnectorVisual[]
  rangeVisual: MotionSelectionRetimeRangeVisual | null
}

interface MotionSelectionRetimeKeyframeVisual {
  element: HTMLButtonElement
  storageKey: string
  initialAbsoluteFrame: number
  inlineTransform: string
  inlineWillChange: string
}

interface MotionSelectionRetimeConnectorVisual {
  element: HTMLDivElement
  fromReferenceKey: string
  toReferenceKey: string
  initialLeft: number
  initialRight: number
  inlineLeft: string
  inlineWidth: string
  inlineWillChange: string
}

interface MotionSelectionRetimeRangeVisual {
  element: HTMLDivElement
  label: HTMLSpanElement | null
  startHandle: HTMLButtonElement | null
  endHandle: HTMLButtonElement | null
  inlineLeft: string
  inlineWidth: string
  inlineVisibility: string
  inlineWillChange: string
  title: string | null
  labelText: string | null
  labelDisplay: string | null
  startValueMin: string | null
  startValueMax: string | null
  startValueNow: string | null
  endValueMin: string | null
  endValueMax: string | null
  endValueNow: string | null
}
interface VisibleMotionRetimeRange {
  startFrame: number
  endFrame: number
  widthPercent: number
}

export function getVisibleMotionRetimeRange(
  range: ReturnType<typeof getMotionSelectionTimeRange>,
  viewport: MotionTimeViewport,
): VisibleMotionRetimeRange | null {
  if (!range || range.keyframeCount < 2 || range.startFrame >= range.endFrame) return null
  if (range.endFrame < viewport.startFrame || range.startFrame > viewport.endFrame) return null
  const startFrame = Math.max(viewport.startFrame, range.startFrame)
  const endFrame = Math.min(viewport.endFrame, range.endFrame)
  return {
    startFrame,
    endFrame,
    widthPercent:
      ((endFrame - startFrame) / Math.max(1, viewport.endFrame - viewport.startFrame)) * 100,
  }
}

export function getRetimeKeyboardDelta(event: ReactKeyboardEvent<HTMLButtonElement>): number | null {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  return direction === 0 ? null : direction * (event.shiftKey ? 10 : 1)
}

export function applyMotionSelectionFrameUpdates(updates: MotionSelectionFrameUpdates): void {
  const keyframesStore = useKeyframesStore.getState()
  if (updates.scalar.length > 0) {
    keyframesStore._updateKeyframes(
      updates.scalar.map((update) => ({
        itemId: update.itemId,
        property: update.property,
        keyframeId: update.keyframeId,
        updates: { frame: update.frame },
      })),
    )
  }
  for (const update of updates.vector) {
    keyframesStore._updateVectorKeyframe(update.itemId, update.property, update.keyframeId, {
      frame: update.frame,
    })
  }
}

function getMotionRetimeStorageKey(
  itemId: string,
  kind: 'scalar' | 'vector',
  property: string,
  keyframeId: string,
): string {
  return `${itemId}\u0000${kind}\u0000${property}\u0000${keyframeId}`
}

function getMotionRetimeReferenceKey(itemId: string, keyframeId: string): string {
  return `${itemId}\u0000${keyframeId}`
}

function captureMotionSelectionRetimeKeyframeVisuals(
  root: HTMLElement | null,
  selection: MotionSelectionDragState,
  itemById: Readonly<Record<string, TimelineItem>>,
): MotionSelectionRetimeKeyframeVisual[] {
  if (!root) return []
  const elementByReferenceKey = new Map<string, HTMLButtonElement>()
  for (const element of root.querySelectorAll<HTMLButtonElement>(
    '[data-motion-item-id][data-motion-keyframe-id]',
  )) {
    const itemId = element.dataset.motionItemId
    const keyframeId = element.dataset.motionKeyframeId
    if (itemId && keyframeId) {
      elementByReferenceKey.set(getMotionRetimeReferenceKey(itemId, keyframeId), element)
    }
  }

  return selection.entries.flatMap((entry) => {
    const item = itemById[entry.ref.itemId]
    const element = elementByReferenceKey.get(
      getMotionRetimeReferenceKey(entry.ref.itemId, entry.ref.keyframeId),
    )
    if (!item || !element) return []
    return [
      {
        element,
        storageKey: getMotionRetimeStorageKey(
          entry.ref.itemId,
          entry.storage.kind,
          entry.storage.property,
          entry.storage.keyframeId,
        ),
        initialAbsoluteFrame: item.from + entry.initialFrame,
        inlineTransform: element.style.transform,
        inlineWillChange: element.style.willChange,
      },
    ]
  })
}

function captureMotionSelectionRetimeConnectorVisuals(
  root: HTMLElement | null,
  selection: MotionSelectionDragState,
): MotionSelectionRetimeConnectorVisual[] {
  if (!root) return []
  const selectedReferenceKeys = new Set(
    selection.entries.map((entry) =>
      getMotionRetimeReferenceKey(entry.ref.itemId, entry.ref.keyframeId),
    ),
  )
  const visuals: MotionSelectionRetimeConnectorVisual[] = []
  for (const element of root.querySelectorAll<HTMLDivElement>(
    '[data-motion-item-id][data-motion-connector-from-keyframe-id][data-motion-connector-to-keyframe-id]',
  )) {
    const itemId = element.dataset.motionItemId
    const fromKeyframeId = element.dataset.motionConnectorFromKeyframeId
    const toKeyframeId = element.dataset.motionConnectorToKeyframeId
    if (!itemId || !fromKeyframeId || !toKeyframeId) continue
    const fromReferenceKey = getMotionRetimeReferenceKey(itemId, fromKeyframeId)
    const toReferenceKey = getMotionRetimeReferenceKey(itemId, toKeyframeId)
    if (
      !selectedReferenceKeys.has(fromReferenceKey) &&
      !selectedReferenceKeys.has(toReferenceKey)
    ) {
      continue
    }
    const initialLeft = Number.parseFloat(element.style.left)
    const initialWidth = Number.parseFloat(element.style.width)
    if (!Number.isFinite(initialLeft) || !Number.isFinite(initialWidth)) continue
    visuals.push({
      element,
      fromReferenceKey,
      toReferenceKey,
      initialLeft,
      initialRight: initialLeft + initialWidth,
      inlineLeft: element.style.left,
      inlineWidth: element.style.width,
      inlineWillChange: element.style.willChange,
    })
  }
  return visuals
}

function captureMotionSelectionRetimeRangeVisual(
  element: HTMLDivElement | null,
): MotionSelectionRetimeRangeVisual | null {
  if (!element) return null
  const label = element.querySelector<HTMLSpanElement>('[data-motion-selection-retime-label]')
  const startHandle = element.querySelector<HTMLButtonElement>(
    '[data-motion-selection-retime-edge="start"]',
  )
  const endHandle = element.querySelector<HTMLButtonElement>(
    '[data-motion-selection-retime-edge="end"]',
  )
  return {
    element,
    label,
    startHandle,
    endHandle,
    inlineLeft: element.style.left,
    inlineWidth: element.style.width,
    inlineVisibility: element.style.visibility,
    inlineWillChange: element.style.willChange,
    title: element.getAttribute('title'),
    labelText: label?.textContent ?? null,
    labelDisplay: label?.style.display ?? null,
    startValueMin: startHandle?.getAttribute('aria-valuemin') ?? null,
    startValueMax: startHandle?.getAttribute('aria-valuemax') ?? null,
    startValueNow: startHandle?.getAttribute('aria-valuenow') ?? null,
    endValueMin: endHandle?.getAttribute('aria-valuemin') ?? null,
    endValueMax: endHandle?.getAttribute('aria-valuemax') ?? null,
    endValueNow: endHandle?.getAttribute('aria-valuenow') ?? null,
  }
}

function buildMotionSelectionRetimePreview(
  drag: MotionSelectionRetimeDragState,
  updates: MotionSelectionFrameUpdates,
): { absoluteFrameByStorageKey: Map<string, number>; range: MotionSelectionTimeRange } | null {
  const localFrameByStorageKey = new Map<string, number>()
  for (const update of updates.scalar) {
    localFrameByStorageKey.set(
      getMotionRetimeStorageKey(update.itemId, 'scalar', update.property, update.keyframeId),
      update.frame,
    )
  }
  for (const update of updates.vector) {
    localFrameByStorageKey.set(
      getMotionRetimeStorageKey(update.itemId, 'vector', update.property, update.keyframeId),
      update.frame,
    )
  }

  const absoluteFrameByStorageKey = new Map<string, number>()
  const absoluteFrames: number[] = []
  for (const entry of drag.selection.entries) {
    const item = drag.itemById[entry.ref.itemId]
    if (!item) continue
    const storageKey = getMotionRetimeStorageKey(
      entry.ref.itemId,
      entry.storage.kind,
      entry.storage.property,
      entry.storage.keyframeId,
    )
    const absoluteFrame = item.from + (localFrameByStorageKey.get(storageKey) ?? entry.initialFrame)
    absoluteFrameByStorageKey.set(storageKey, absoluteFrame)
    absoluteFrames.push(absoluteFrame)
  }
  if (absoluteFrames.length === 0) return null
  return {
    absoluteFrameByStorageKey,
    range: {
      startFrame: Math.min(...absoluteFrames),
      endFrame: Math.max(...absoluteFrames),
      keyframeCount: drag.selection.entries.length,
      itemCount: new Set(drag.selection.entries.map((entry) => entry.ref.itemId)).size,
    },
  }
}

function applyMotionSelectionRetimeVisuals(
  drag: MotionSelectionRetimeDragState,
  updates: MotionSelectionFrameUpdates,
  viewport: MotionTimeViewport,
): void {
  const preview = buildMotionSelectionRetimePreview(drag, updates)
  if (!preview) return
  const visibleFrameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const offsetPxByReferenceKey = new Map<string, number>()
  for (const entry of drag.selection.entries) {
    const item = drag.itemById[entry.ref.itemId]
    if (!item) continue
    const storageKey = getMotionRetimeStorageKey(
      entry.ref.itemId,
      entry.storage.kind,
      entry.storage.property,
      entry.storage.keyframeId,
    )
    const initialAbsoluteFrame = item.from + entry.initialFrame
    const absoluteFrame = preview.absoluteFrameByStorageKey.get(storageKey) ?? initialAbsoluteFrame
    offsetPxByReferenceKey.set(
      getMotionRetimeReferenceKey(entry.ref.itemId, entry.ref.keyframeId),
      ((absoluteFrame - initialAbsoluteFrame) / visibleFrameRange) * drag.rulerWidth,
    )
  }
  for (const visual of drag.keyframeVisuals) {
    const absoluteFrame =
      preview.absoluteFrameByStorageKey.get(visual.storageKey) ?? visual.initialAbsoluteFrame
    const offsetPx =
      ((absoluteFrame - visual.initialAbsoluteFrame) / visibleFrameRange) * drag.rulerWidth
    visual.element.style.transform = `translate3d(${offsetPx}px, 0, 0)`
    visual.element.style.willChange = 'transform'
  }
  for (const visual of drag.connectorVisuals) {
    const nextLeft = visual.initialLeft + (offsetPxByReferenceKey.get(visual.fromReferenceKey) ?? 0)
    const nextRight = visual.initialRight + (offsetPxByReferenceKey.get(visual.toReferenceKey) ?? 0)
    visual.element.style.left = `${Math.min(nextLeft, nextRight)}px`
    visual.element.style.width = `${Math.abs(nextRight - nextLeft)}px`
    visual.element.style.willChange = 'left, width'
  }

  const rangeVisual = drag.rangeVisual
  if (!rangeVisual) return
  applyRetimeRangeVisual(rangeVisual, preview, viewport, visibleFrameRange)
}

/**
 * Places the range element, its label and its handle ARIA values for the
 * previewed selection, hiding the element entirely when the range scrolls out of
 * view rather than leaving a stale bar on the ruler.
 */
function applyRetimeRangeVisual(
  rangeVisual: MotionSelectionRetimeRangeVisual,
  preview: { range: MotionSelectionTimeRange },
  viewport: MotionTimeViewport,
  visibleFrameRange: number,
): void {
  const visibleRange = getVisibleMotionRetimeRange(preview.range, viewport)
  if (!visibleRange) {
    rangeVisual.element.style.visibility = 'hidden'
    return
  }
  const selectionDuration = preview.range.endFrame - preview.range.startFrame
  const layerSuffix = preview.range.itemCount === 1 ? '' : 's'
  rangeVisual.element.style.visibility = 'visible'
  rangeVisual.element.style.left = `${
    ((visibleRange.startFrame - viewport.startFrame) / visibleFrameRange) * 100
  }%`
  rangeVisual.element.style.width = `${Math.max(0.4, visibleRange.widthPercent)}%`
  rangeVisual.element.style.willChange = 'left, width'
  rangeVisual.element.title = `${preview.range.keyframeCount} selected keyframes across ${preview.range.itemCount} layer${layerSuffix} · ${selectionDuration}f`
  if (rangeVisual.label) {
    rangeVisual.label.textContent = `${preview.range.keyframeCount} keys · ${selectionDuration}f`
    rangeVisual.label.style.display = visibleRange.widthPercent >= 8 ? '' : 'none'
  }
  rangeVisual.startHandle?.setAttribute('aria-valuemax', String(preview.range.endFrame - 1))
  rangeVisual.startHandle?.setAttribute('aria-valuenow', String(preview.range.startFrame))
  rangeVisual.endHandle?.setAttribute('aria-valuemin', String(preview.range.startFrame + 1))
  rangeVisual.endHandle?.setAttribute('aria-valuenow', String(preview.range.endFrame))
}

export function restoreMotionSelectionRetimeVisuals(
  drag: MotionSelectionRetimeDragState,
  restoreRange: boolean,
): void {
  for (const visual of drag.keyframeVisuals) {
    visual.element.style.transform = visual.inlineTransform
    visual.element.style.willChange = visual.inlineWillChange
  }
  for (const visual of drag.connectorVisuals) {
    if (restoreRange) {
      visual.element.style.left = visual.inlineLeft
      visual.element.style.width = visual.inlineWidth
    }
    visual.element.style.willChange = visual.inlineWillChange
  }
  const rangeVisual = drag.rangeVisual
  if (!rangeVisual) return
  rangeVisual.element.style.visibility = rangeVisual.inlineVisibility
  rangeVisual.element.style.willChange = rangeVisual.inlineWillChange
  if (!restoreRange) return
  rangeVisual.element.style.left = rangeVisual.inlineLeft
  rangeVisual.element.style.width = rangeVisual.inlineWidth
  if (rangeVisual.title === null) rangeVisual.element.removeAttribute('title')
  else rangeVisual.element.setAttribute('title', rangeVisual.title)
  if (rangeVisual.label) {
    rangeVisual.label.textContent = rangeVisual.labelText
    rangeVisual.label.style.display = rangeVisual.labelDisplay ?? ''
  }
  const restoreAttribute = (
    element: HTMLButtonElement | null,
    name: string,
    value: string | null,
  ) => {
    if (!element) return
    if (value === null) element.removeAttribute(name)
    else element.setAttribute(name, value)
  }
  restoreAttribute(rangeVisual.startHandle, 'aria-valuemin', rangeVisual.startValueMin)
  restoreAttribute(rangeVisual.startHandle, 'aria-valuemax', rangeVisual.startValueMax)
  restoreAttribute(rangeVisual.startHandle, 'aria-valuenow', rangeVisual.startValueNow)
  restoreAttribute(rangeVisual.endHandle, 'aria-valuemin', rangeVisual.endValueMin)
  restoreAttribute(rangeVisual.endHandle, 'aria-valuemax', rangeVisual.endValueMax)
  restoreAttribute(rangeVisual.endHandle, 'aria-valuenow', rangeVisual.endValueNow)
}

function hasMotionSelectionRetimeChanges(
  drag: MotionSelectionRetimeDragState,
  updates: MotionSelectionFrameUpdates,
): boolean {
  const initialFrameByStorageKey = new Map(
    drag.selection.entries.map((entry) => [
      getMotionRetimeStorageKey(
        entry.ref.itemId,
        entry.storage.kind,
        entry.storage.property,
        entry.storage.keyframeId,
      ),
      entry.initialFrame,
    ]),
  )
  return (
    updates.scalar.some(
      (update) =>
        initialFrameByStorageKey.get(
          getMotionRetimeStorageKey(update.itemId, 'scalar', update.property, update.keyframeId),
        ) !== update.frame,
    ) ||
    updates.vector.some(
      (update) =>
        initialFrameByStorageKey.get(
          getMotionRetimeStorageKey(update.itemId, 'vector', update.property, update.keyframeId),
        ) !== update.frame,
    )
  )
}

export interface MotionSelectionRetimeState {
  dragRef: { current: MotionSelectionRetimeDragState | null }
  pendingFrameRef: { current: number | null }
  animationFrameRef: { current: number | null }
}

export interface MotionSelectionRetimeDeps {
  durationInFrames: number
  visibleFrameRange: number
  selection: MotionSelectionDragState | null
  selectionTimeRange: MotionSelectionTimeRange | null
  itemById: Record<string, TimelineItem>
  getRuler: () => HTMLDivElement | null
  getScrollArea: () => HTMLDivElement | null
  getRangeElement: () => HTMLDivElement | null
  getTimeViewport: () => MotionTimeViewport
}

export interface MotionSelectionRetimeCommands {
  begin: (event: ReactPointerEvent<HTMLButtonElement>, edge: 'start' | 'end') => void
  move: (event: ReactPointerEvent<HTMLButtonElement>) => void
  end: (event: ReactPointerEvent<HTMLButtonElement>) => void
  cancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

/**
 * Batch-retiming the selected keyframes from the ruler range handles.
 *
 * A drag captures the rendered keyframe diamonds, connectors and range element up
 * front, previews by writing to them directly on one animation frame, and commits
 * once on release — one undo entry for the whole gesture, and no React render per
 * pointer move. Restoring differs by outcome: a cancelled drag puts the captured
 * inline styles back, a committed drag keeps the previewed geometry and lets the
 * store render own it.
 */
export function createMotionSelectionRetimeCommands(input: {
  state: MotionSelectionRetimeState
  deps: MotionSelectionRetimeDeps
}): MotionSelectionRetimeCommands {
  const { dragRef, pendingFrameRef, animationFrameRef } = input.state
  const deps = input.deps

  const applyPreview = (): void => {
    animationFrameRef.current = null
    const drag = dragRef.current
    const targetFrame = pendingFrameRef.current
    pendingFrameRef.current = null
    if (!drag || targetFrame === null) return
    const updates = buildMotionSelectionRetimeUpdates(
      drag.selection,
      drag.itemById,
      drag.edge,
      targetFrame,
      deps.durationInFrames,
    )
    drag.lastUpdates = updates
    applyMotionSelectionRetimeVisuals(drag, updates, deps.getTimeViewport())
  }

  const flushPreview = (): void => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    applyPreview()
  }

  const begin = (
    event: ReactPointerEvent<HTMLButtonElement>,
    edge: 'start' | 'end',
  ): void => {
    if (!deps.selection || !deps.selectionTimeRange) return
    const ruler = deps.getRuler()
    if (!ruler) return
    event.preventDefault()
    event.stopPropagation()
    const rect = ruler.getBoundingClientRect()
    const scrollArea = deps.getScrollArea()
    dragRef.current = {
      pointerId: event.pointerId,
      edge,
      startClientX: event.clientX,
      rulerWidth: Math.max(1, rect.width),
      initialEdgeFrame:
        edge === 'start' ? deps.selectionTimeRange.startFrame : deps.selectionTimeRange.endFrame,
      selection: deps.selection,
      itemById: deps.itemById,
      snapshot: captureSnapshot(),
      hasMoved: false,
      lastUpdates: null,
      keyframeVisuals: captureMotionSelectionRetimeKeyframeVisuals(
        scrollArea,
        deps.selection,
        deps.itemById,
      ),
      connectorVisuals: captureMotionSelectionRetimeConnectorVisuals(scrollArea, deps.selection),
      rangeVisual: captureMotionSelectionRetimeRangeVisual(deps.getRangeElement()),
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const move = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const deltaFrames = Math.round(
      ((event.clientX - drag.startClientX) / drag.rulerWidth) * deps.visibleFrameRange,
    )
    if (deltaFrames === 0 && !drag.hasMoved) return
    drag.hasMoved = true
    pendingFrameRef.current = drag.initialEdgeFrame + deltaFrames
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(applyPreview)
    }
  }

  const end = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (drag.hasMoved) {
      flushPreview()
      const updates = drag.lastUpdates
      if (updates && hasMotionSelectionRetimeChanges(drag, updates)) {
        flushSync(() => applyMotionSelectionFrameUpdates(updates))
        restoreMotionSelectionRetimeVisuals(drag, false)
        useTimelineCommandStore
          .getState()
          .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, drag.snapshot)
        useTimelineSettingsStore.getState().markDirty()
      } else {
        restoreMotionSelectionRetimeVisuals(drag, true)
      }
    }
    pendingFrameRef.current = null
    dragRef.current = null
  }

  const cancel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    pendingFrameRef.current = null
    restoreMotionSelectionRetimeVisuals(drag, true)
    dragRef.current = null
  }

  return { begin, move, end, cancel }
}
