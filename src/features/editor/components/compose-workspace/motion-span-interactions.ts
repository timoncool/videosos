import type { TimelineItem } from '@/types/timeline'
import { trimItemEnd, trimItemStart } from '@/features/editor/deps/timeline-motion'

export interface SpanDragState {
  pointerId: number
  startX: number
  laneWidth: number
  deltaFrames: number
  items: Array<{ id: string; from: number; durationInFrames: number }>
}

function setSpanDragVisualOffset(elements: readonly HTMLElement[], offsetPx: number): void {
  const transform = `translateX(${offsetPx}px)`
  for (const element of elements) element.style.transform = transform
}

export function clearSpanDragVisuals(elements: readonly HTMLElement[]): void {
  for (const element of elements) {
    element.style.removeProperty('transform')
    element.style.removeProperty('will-change')
  }
}

/** Ref slots the drag owns; they live with the component so its render tree can share them. */
export interface MotionSpanDragState {
  dragRef: { current: SpanDragState | null }
  visualsRef: { current: HTMLElement[] }
  animationFrameRef: { current: number | null }
}

export interface MotionSpanDragDeps {
  items: TimelineItem[]
  durationInFrames: number
  visibleFrameRange: number
  pause: () => void
  selectLayer: (itemId: string, modifiers: { toggle?: boolean; range?: boolean }) => void
  selectItems: (itemIds: string[]) => void
  moveItems: (updates: Array<{ id: string; from: number }>) => void
  expandLayerItemIds: (itemIds: string[]) => string[]
  getScrollArea: () => HTMLElement | null
}

export interface MotionSpanDragCommands {
  begin: (event: React.PointerEvent<HTMLButtonElement>, itemIds: string[]) => void
  move: (event: React.PointerEvent<HTMLButtonElement>) => void
  end: (event: React.PointerEvent<HTMLButtonElement>) => void
  cancel: (event: React.PointerEvent<HTMLButtonElement>) => void
}

/** The drag's fixed geometry: the items moving and every visual that previews them. */
function collectDragVisuals(
  origin: HTMLElement,
  itemIds: string[],
  scrollArea: HTMLElement | null,
): HTMLElement[] {
  const itemIdSet = new Set(itemIds)
  const visuals = new Set<HTMLElement>([origin])
  for (const row of scrollArea?.querySelectorAll<HTMLElement>('[data-motion-layer-item-id]') ?? []) {
    if (!itemIdSet.has(row.dataset.motionLayerItemId ?? '')) continue
    for (const visual of row.querySelectorAll<HTMLElement>('[data-motion-span-drag-visual]')) {
      visuals.add(visual)
    }
  }
  return [...visuals]
}

/** Touching a span selects it (or the whole dragged set) before the drag starts. */
function selectDraggedItems(
  deps: MotionSpanDragDeps,
  event: React.PointerEvent<HTMLButtonElement>,
  itemIds: string[],
): void {
  if (itemIds.length !== 1) {
    deps.selectItems(itemIds)
    return
  }
  deps.selectLayer(itemIds[0]!, {
    toggle: event.metaKey || event.ctrlKey,
    range: event.shiftKey,
  })
}

/**
 * Dragging one or more layer spans along the time axis.
 *
 * The drag previews by writing inline transforms to the row's drag visuals and
 * commits a single `moveItems` on release, so a drag is one undoable step. The
 * delta is clamped per drag to the group's own bounds: no item may start before
 * frame 0 or end past the composition, which is why the clamp is computed from
 * every dragged item rather than the one under the pointer.
 */
export function createMotionSpanDragCommands(input: {
  state: MotionSpanDragState
  deps: MotionSpanDragDeps
}): MotionSpanDragCommands {
  const { state, deps } = input
  const { dragRef, visualsRef, animationFrameRef } = state

  const cancelPreviewFrame = (): void => {
    if (animationFrameRef.current === null) return
    cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
  }

  const release = (): void => {
    cancelPreviewFrame()
    clearSpanDragVisuals(visualsRef.current)
    visualsRef.current = []
    dragRef.current = null
  }

  const begin = (event: React.PointerEvent<HTMLButtonElement>, itemIds: string[]): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const lane = event.currentTarget.parentElement
    const laneWidth = lane?.getBoundingClientRect().width ?? 0
    if (laneWidth <= 0) return
    const itemIdSet = new Set(deps.expandLayerItemIds(itemIds))
    const dragItems = deps.items
      .filter((item) => itemIdSet.has(item.id))
      .map((item) => ({
        id: item.id,
        from: item.from,
        durationInFrames: item.durationInFrames,
      }))
    if (dragItems.length === 0) return
    deps.pause()
    selectDraggedItems(deps, event, itemIds)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      laneWidth,
      deltaFrames: 0,
      items: dragItems,
    }
    visualsRef.current = collectDragVisuals(event.currentTarget, itemIds, deps.getScrollArea())
    for (const visual of visualsRef.current) visual.style.willChange = 'transform'
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const move = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rawDelta = Math.round(((event.clientX - drag.startX) / drag.laneWidth) * deps.visibleFrameRange)
    const minDelta = -Math.min(...drag.items.map((item) => item.from))
    const maxDelta = Math.min(
      ...drag.items.map((item) => deps.durationInFrames - item.from - 1),
    )
    const deltaFrames = Math.max(minDelta, Math.min(maxDelta, rawDelta))
    if (deltaFrames === drag.deltaFrames) return
    const next = { ...drag, deltaFrames }
    dragRef.current = next
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null
      const latestDrag = dragRef.current
      if (!latestDrag) return
      setSpanDragVisualOffset(
        visualsRef.current,
        (latestDrag.deltaFrames / deps.visibleFrameRange) * latestDrag.laneWidth,
      )
    })
  }

  const end = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    release()
    if (drag.deltaFrames !== 0) {
      deps.moveItems(drag.items.map((item) => ({ id: item.id, from: item.from + drag.deltaFrames })))
    }
  }

  const cancel = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    release()
  }

  return { begin, move, end, cancel }
}

export interface SpanTrimState {
  pointerId: number
  itemId: string
  handle: 'start' | 'end'
  startX: number
  laneWidth: number
  deltaFrames: number
  from: number
  durationInFrames: number
  segment: HTMLButtonElement
  segmentWidthPx: number
  segmentInlineWidth: string
  segmentInlineTransform: string
  segmentInlineWillChange: string
  timelineVisuals: HTMLElement[]
}

/** The segment and lane a trim is about to resize, or null when there is none. */
function resolveSpanTrimTarget(event: React.PointerEvent<HTMLSpanElement>): {
  laneWidth: number
  segment: HTMLButtonElement
  segmentRect: DOMRect
  timelineVisuals: HTMLElement[]
} | null {
  const lane = event.currentTarget.closest<HTMLElement>('[data-motion-timeline-lane]')
  const laneWidth = lane?.getBoundingClientRect().width ?? 0
  const segment = event.currentTarget.closest<HTMLButtonElement>(
    '[data-testid^="motion-layer-span-"]',
  )
  if (laneWidth <= 0 || !segment) return null
  const row = segment.closest<HTMLElement>('[data-motion-layer-item-id]')
  const timelineVisuals = Array.from(
    row?.querySelectorAll<HTMLElement>('[data-motion-span-drag-visual]') ?? [],
  ).filter((visual) => visual !== segment)
  return { laneWidth, segment, segmentRect: segment.getBoundingClientRect(), timelineVisuals }
}

/** Previews a trim by resizing the dragged edge; the opposite edge stays put. */
function applySpanTrimVisuals(trim: SpanTrimState, visibleFrameRange: number): void {
  const offsetPx = (trim.deltaFrames / visibleFrameRange) * trim.laneWidth
  trim.segment.style.transform =
    trim.handle === 'start' ? `translateX(${offsetPx}px)` : trim.segmentInlineTransform
  trim.segment.style.width = `${Math.max(
    1,
    trim.segmentWidthPx + (trim.handle === 'start' ? -offsetPx : offsetPx),
  )}px`
  if (trim.handle === 'start') setSpanDragVisualOffset(trim.timelineVisuals, offsetPx)
}

export function clearSpanTrimVisuals(trim: SpanTrimState): void {
  trim.segment.style.width = trim.segmentInlineWidth
  trim.segment.style.transform = trim.segmentInlineTransform
  trim.segment.style.willChange = trim.segmentInlineWillChange
  clearSpanDragVisuals(trim.timelineVisuals)
}

/**
 * The trim delta, clamped so the edge cannot cross its own opposite edge or run
 * past the composition, in authored frames rather than pixels.
 */
function resolveTrimDelta(input: {
  clientDeltaX: number
  laneWidth: number
  handle: 'start' | 'end'
  from: number
  durationInFrames: number
  totalDurationInFrames: number
  visibleFrameRange: number
}): number {
  const rawDelta = Math.round((input.clientDeltaX / input.laneWidth) * input.visibleFrameRange)
  const minDelta = input.handle === 'start' ? -input.from : -(input.durationInFrames - 1)
  const maxDelta =
    input.handle === 'start'
      ? input.durationInFrames - 1
      : input.totalDurationInFrames - (input.from + input.durationInFrames)
  return Math.max(minDelta, Math.min(maxDelta, rawDelta))
}

export interface MotionSpanTrimState {
  trimRef: { current: SpanTrimState | null }
  animationFrameRef: { current: number | null }
}

export interface MotionSpanTrimDeps {
  durationInFrames: number
  visibleFrameRange: number
  pause: () => void
  selectItems: (itemIds: string[]) => void
}

export interface MotionSpanTrimCommands {
  begin: (
    event: React.PointerEvent<HTMLSpanElement>,
    item: TimelineItem,
    handle: 'start' | 'end',
  ) => void
  move: (event: React.PointerEvent<HTMLSpanElement>) => void
  end: (event: React.PointerEvent<HTMLSpanElement>) => void
  cancel: (event: React.PointerEvent<HTMLSpanElement>) => void
}

/**
 * Trimming a layer span from either edge.
 *
 * Like the drag, the trim previews on the next animation frame and commits once
 * on release, so each edge drag is one undoable step. The commit is linked
 * (`forceLinked`), because trimming one end of a linked pair without the other
 * would desynchronise them.
 */
export function createMotionSpanTrimCommands(input: {
  state: MotionSpanTrimState
  deps: MotionSpanTrimDeps
}): MotionSpanTrimCommands {
  const { trimRef, animationFrameRef } = input.state
  const deps = input.deps

  const finish = (event: React.PointerEvent<HTMLSpanElement>, commit: boolean): void => {
    const trim = trimRef.current
    if (!trim || trim.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    clearSpanTrimVisuals(trim)
    trimRef.current = null
    if (!commit || trim.deltaFrames === 0) return
    if (trim.handle === 'start') {
      trimItemStart(trim.itemId, trim.deltaFrames, { forceLinked: true })
    } else {
      trimItemEnd(trim.itemId, trim.deltaFrames, { forceLinked: true })
    }
  }

  const begin = (
    event: React.PointerEvent<HTMLSpanElement>,
    item: TimelineItem,
    handle: 'start' | 'end',
  ): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const target = resolveSpanTrimTarget(event)
    if (!target) return
    deps.pause()
    deps.selectItems([item.id])
    const trim: SpanTrimState = {
      pointerId: event.pointerId,
      itemId: item.id,
      handle,
      startX: event.clientX,
      laneWidth: target.laneWidth,
      deltaFrames: 0,
      from: item.from,
      durationInFrames: item.durationInFrames,
      segment: target.segment,
      segmentWidthPx: target.segmentRect.width,
      segmentInlineWidth: target.segment.style.width,
      segmentInlineTransform: target.segment.style.transform,
      segmentInlineWillChange: target.segment.style.willChange,
      timelineVisuals: target.timelineVisuals,
    }
    trim.segment.style.willChange = 'transform, width'
    if (handle === 'start') {
      for (const visual of trim.timelineVisuals) visual.style.willChange = 'transform'
    }
    trimRef.current = trim
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const move = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const trim = trimRef.current
    if (!trim || trim.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const deltaFrames = resolveTrimDelta({
      clientDeltaX: event.clientX - trim.startX,
      laneWidth: trim.laneWidth,
      handle: trim.handle,
      from: trim.from,
      durationInFrames: trim.durationInFrames,
      totalDurationInFrames: deps.durationInFrames,
      visibleFrameRange: deps.visibleFrameRange,
    })
    if (deltaFrames === trim.deltaFrames) return
    trimRef.current = { ...trim, deltaFrames }
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null
      const latestTrim = trimRef.current
      if (latestTrim) applySpanTrimVisuals(latestTrim, deps.visibleFrameRange)
    })
  }

  const end = (event: React.PointerEvent<HTMLSpanElement>): void => finish(event, true)
  const cancel = (event: React.PointerEvent<HTMLSpanElement>): void => finish(event, false)

  return { begin, move, end, cancel }
}
