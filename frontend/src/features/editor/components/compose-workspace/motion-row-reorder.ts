import type { TimelineTrack } from '@/types/timeline'
import { setTracks, useItemsStore } from '@/features/editor/deps/timeline-motion'

export interface RowReorderDragState {
  pointerId: number
  sourceTrackId: string
  parentTrackId: string | null
  startY: number
  deltaY: number
  originIndex: number
  targetIndex: number
  sourceRow: HTMLElement
  dropCandidates: Array<{ trackId: string; centerY: number; row: HTMLElement }>
  dropIndicator: HTMLDivElement
}

/** Ref slots the drag owns; they stay with the component so its render tree can read them. */
export interface MotionRowReorderState {
  dragRef: { current: RowReorderDragState | null }
  animationFrameRef: { current: number | null }
  pendingClientYRef: { current: number | null }
}

export interface MotionRowReorderDeps {
  /** Publishes the drag to React so rows can render their dragging state. */
  setDrag: (drag: RowReorderDragState | null) => void
}

export interface MotionRowReorderCommands {
  begin: (event: React.PointerEvent<HTMLButtonElement>, track: TimelineTrack) => void
  move: (event: React.PointerEvent<HTMLButtonElement>) => void
  end: (event: React.PointerEvent<HTMLButtonElement>) => void
  cancel: (event: React.PointerEvent<HTMLButtonElement>) => void
  /** Drops an in-flight drag and its inline transforms (unmount). */
  dispose: () => void
}

/**
 * The index the dragged row would land on, counted against the sibling rows it
 * can drop between. A pointer past the last candidate lands after it.
 */
function resolveDropTarget(
  drag: RowReorderDragState,
  clientY: number,
): { targetIndex: number; dropAfterLast: boolean } {
  const targetIndex = drag.dropCandidates.reduce(
    (index, candidate) => index + (clientY > candidate.centerY ? 1 : 0),
    0,
  )
  return { targetIndex, dropAfterLast: targetIndex >= drag.dropCandidates.length }
}

/**
 * Applies the drop: siblings are renumbered in their own list, then every track
 * keeps its identity and only `order` changes, so the reorder is one undoable
 * step and unrelated tracks are untouched by reference.
 */
function commitRowReorder(drag: RowReorderDragState): void {
  const latestTracks = useItemsStore.getState().tracks
  const siblings = latestTracks
    .filter((track) => (track.parentTrackId ?? null) === drag.parentTrackId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const sourceIndex = siblings.findIndex((track) => track.id === drag.sourceTrackId)
  if (sourceIndex < 0) return
  const [source] = siblings.splice(sourceIndex, 1)
  if (!source) return
  siblings.splice(Math.max(0, Math.min(drag.targetIndex, siblings.length)), 0, source)
  const orderByTrackId = new Map(siblings.map((track, index) => [track.id, index]))
  setTracks(
    latestTracks.map((track) => {
      const order = orderByTrackId.get(track.id)
      return order === undefined ? track : { ...track, order }
    }),
  )
}

/**
 * Reordering layer rows by dragging the three-dot handle.
 *
 * The row follows the pointer by transform while a drop indicator marks the gap
 * it would land in; nothing is committed until release, and the commit renumbers
 * only the sibling list the row belongs to. Previews are coalesced to one
 * animation frame, and the pointer's latest position is kept in a ref so a
 * release that arrives before the preview frame still commits the right target.
 */
export function createMotionRowReorderCommands(input: {
  state: MotionRowReorderState
  deps: MotionRowReorderDeps
}): MotionRowReorderCommands {
  const { dragRef, animationFrameRef, pendingClientYRef } = input.state
  const deps = input.deps

  const applyPreview = (clientY: number): void => {
    const drag = dragRef.current
    if (!drag) return
    const { targetIndex, dropAfterLast } = resolveDropTarget(drag, clientY)
    const dropTarget = drag.dropCandidates[targetIndex] ?? drag.dropCandidates.at(-1) ?? null
    const next = { ...drag, deltaY: clientY - drag.startY, targetIndex }
    dragRef.current = next
    drag.sourceRow.style.transform = `translate3d(0, ${next.deltaY}px, 0)`
    if (!dropTarget) {
      drag.dropIndicator.remove()
      return
    }
    dropTarget.row.appendChild(drag.dropIndicator)
    drag.dropIndicator.style.top = dropAfterLast ? '' : '0'
    drag.dropIndicator.style.bottom = dropAfterLast ? '0' : ''
  }

  const clearPreview = (drag: RowReorderDragState): void => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    pendingClientYRef.current = null
    drag.sourceRow.style.transform = ''
    drag.sourceRow.style.willChange = ''
    drag.dropIndicator.remove()
  }

  const begin = (event: React.PointerEvent<HTMLButtonElement>, track: TimelineTrack): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const parentTrackId = track.parentTrackId ?? null
    const root = event.currentTarget.closest('[data-testid="compositing-timeline"]')
    const siblingRows = Array.from(
      root?.querySelectorAll<HTMLElement>('[data-motion-row-track-id]') ?? [],
    ).filter((row) => (row.dataset.motionParentTrackId || null) === parentTrackId)
    const siblingCenters = siblingRows.map((row) => {
      const rect = row.getBoundingClientRect()
      return {
        trackId: row.dataset.motionRowTrackId!,
        centerY: rect.top + rect.height / 2,
        row,
      }
    })
    const originIndex = siblingCenters.findIndex((candidate) => candidate.trackId === track.id)
    if (originIndex < 0) return
    const sourceRow = siblingCenters[originIndex]?.row
    if (!sourceRow) return
    const dropIndicator = document.createElement('div')
    dropIndicator.className = 'pointer-events-none absolute inset-x-0 z-40 h-0.5 bg-primary'
    sourceRow.style.willChange = 'transform'
    const next: RowReorderDragState = {
      pointerId: event.pointerId,
      sourceTrackId: track.id,
      parentTrackId,
      startY: event.clientY,
      deltaY: 0,
      originIndex,
      targetIndex: originIndex,
      sourceRow,
      dropCandidates: siblingCenters.filter((candidate) => candidate.trackId !== track.id),
      dropIndicator,
    }
    dragRef.current = next
    deps.setDrag(next)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const move = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    pendingClientYRef.current = event.clientY
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      const clientY = pendingClientYRef.current
      pendingClientYRef.current = null
      if (clientY !== null) applyPreview(clientY)
    })
  }

  const end = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const activeDrag = dragRef.current
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    applyPreview(event.clientY)
    const drag = dragRef.current
    if (!drag) return
    clearPreview(drag)
    dragRef.current = null
    deps.setDrag(null)
    if (drag.targetIndex === drag.originIndex) return
    commitRowReorder(drag)
  }

  const cancel = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clearPreview(drag)
    dragRef.current = null
    deps.setDrag(null)
  }

  const dispose = (): void => {
    const drag = dragRef.current
    if (drag) clearPreview(drag)
    dragRef.current = null
  }

  return { begin, move, end, cancel, dispose }
}
