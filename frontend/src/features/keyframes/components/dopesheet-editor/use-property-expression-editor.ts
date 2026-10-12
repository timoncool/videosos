import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { toast } from 'sonner'
import { useMotionPickWhipDrag } from '@/shared/hooks/use-pick-whip-drag'
import type { DirectLinkableProperty, PropertyExpression } from '@/types/keyframe'
import { EXPRESSION_DOCK_HEIGHT } from './dopesheet-expression-dock'
import {
  getExpressionReferenceCandidate,
  resolveExpressionReferenceTarget,
  type ExpressionReferenceCandidate,
  type ExpressionReferenceDragOrigin,
  type PropertyExpressionDraft,
} from './expression-reference-utils'

type ExpressionPickWhipApi = ReturnType<
  typeof useMotionPickWhipDrag<ExpressionReferenceDragOrigin, ExpressionReferenceCandidate>
>

export interface PropertyExpressionEditorApi {
  expressionEditor: PropertyExpressionDraft | null
  setExpressionEditor: Dispatch<SetStateAction<PropertyExpressionDraft | null>>
  expressionReferencePick: ExpressionReferenceDragOrigin | null
  setExpressionReferencePick: Dispatch<SetStateAction<ExpressionReferenceDragOrigin | null>>
  expressionReferenceDrag: ExpressionPickWhipApi['drag']
  expressionDockOpen: boolean
  expressionDockRef: RefObject<HTMLElement | null>
  expressionTextareaRef: RefObject<HTMLTextAreaElement | null>
  beginExpressionReferenceDrag: ExpressionPickWhipApi['begin']
  openPropertyExpressionEditor: (
    property: DirectLinkableProperty,
    expression?: PropertyExpression,
  ) => void
  applyExpressionPreset: (property: DirectLinkableProperty, source: string) => void
}

/**
 * Owns the sandboxed expression editor: draft state, open/preset/reference
 * editing operations, pick-whip linking, and dock reveal/height effects.
 */
export function usePropertyExpressionEditor({
  onExpressionDockHeightChange,
  pickWhipRootRef,
}: {
  onExpressionDockHeightChange?: (height: number) => void
  pickWhipRootRef: RefObject<HTMLDivElement | null>
}): PropertyExpressionEditorApi {
  const [expressionEditor, setExpressionEditor] = useState<PropertyExpressionDraft | null>(null)
  const [expressionReferencePick, setExpressionReferencePick] =
    useState<ExpressionReferenceDragOrigin | null>(null)
  const expressionDockRef = useRef<HTMLElement>(null)
  const expressionTextareaRef = useRef<HTMLTextAreaElement>(null)
  const openPropertyExpressionEditor = useCallback(
    (property: DirectLinkableProperty, expression?: PropertyExpression) => {
      const source = expression?.source ?? 'value'
      setExpressionReferencePick(null)
      setExpressionEditor({
        property,
        source,
        enabled: expression?.enabled ?? true,
        selectionStart: source.length,
        selectionEnd: source.length,
      })
    },
    [],
  )
  const expressionDockOpen = expressionEditor !== null
  useEffect(() => {
    onExpressionDockHeightChange?.(expressionDockOpen ? EXPRESSION_DOCK_HEIGHT : 0)
  }, [expressionDockOpen, onExpressionDockHeightChange])
  useEffect(
    () => () => {
      onExpressionDockHeightChange?.(0)
    },
    [onExpressionDockHeightChange],
  )
  useEffect(() => {
    if (!expressionDockOpen) return

    let revealFrame = 0
    const layoutFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        const dock = expressionDockRef.current
        const motionScrollArea = dock?.closest<HTMLElement>(
          '[data-testid="motion-layer-scroll-area"]',
        )
        if (!dock || !motionScrollArea) return

        const dockRect = dock.getBoundingClientRect()
        const viewportRect = motionScrollArea.getBoundingClientRect()
        const overflowBottom = dockRect.bottom - viewportRect.bottom + 8
        if (overflowBottom <= 0) return

        motionScrollArea.scrollTo({
          top: motionScrollArea.scrollTop + overflowBottom,
          behavior: 'smooth',
        })
      })
    })

    return () => {
      cancelAnimationFrame(layoutFrame)
      cancelAnimationFrame(revealFrame)
    }
  }, [expressionDockOpen, expressionEditor?.property])
  const applyExpressionPreset = useCallback((property: DirectLinkableProperty, source: string) => {
    setExpressionEditor((current) => {
      if (!current || current.property !== property) return current
      requestAnimationFrame(() => {
        expressionTextareaRef.current?.focus()
        expressionTextareaRef.current?.setSelectionRange(source.length, source.length)
      })
      return {
        ...current,
        source,
        selectionStart: source.length,
        selectionEnd: source.length,
      }
    })
  }, [])
  const insertExpressionReference = useCallback(
    (origin: ExpressionReferenceDragOrigin, candidate: ExpressionReferenceCandidate) => {
      const reference = `prop(${JSON.stringify(candidate.itemId)}, ${JSON.stringify(candidate.property)})`
      setExpressionEditor((current) => {
        if (!current || current.property !== origin.property) return current
        const replaceDefaultValue =
          current.source.trim() === 'value' && origin.selectionStart === origin.selectionEnd
        const selectionStart = replaceDefaultValue ? 0 : origin.selectionStart
        const selectionEnd = replaceDefaultValue ? current.source.length : origin.selectionEnd
        const source =
          current.source.slice(0, selectionStart) + reference + current.source.slice(selectionEnd)
        const cursor = selectionStart + reference.length
        requestAnimationFrame(() => {
          const textarea = expressionTextareaRef.current
          textarea?.focus()
          textarea?.setSelectionRange(cursor, cursor)
        })
        return {
          ...current,
          source,
          selectionStart: cursor,
          selectionEnd: cursor,
        }
      })
    },
    [],
  )
  const { drag: expressionReferenceDrag, begin: beginExpressionReferenceDrag } =
    useMotionPickWhipDrag<ExpressionReferenceDragOrigin, ExpressionReferenceCandidate>({
      hoverAttribute: 'data-expression-reference-hover',
      getClipRoot: () =>
        pickWhipRootRef.current?.closest<HTMLElement>(
          '[data-pick-whip-scroll-area], [data-testid="motion-layer-scroll-area"]',
        ) ?? pickWhipRootRef.current,
      resolveTarget: resolveExpressionReferenceTarget,
      onCommit: insertExpressionReference,
    })
  useEffect(() => {
    if (!expressionReferencePick) return

    const markedRows = new Set<HTMLElement>()
    const syncCandidateRows = () => {
      for (const row of markedRows) {
        row.removeAttribute('data-expression-reference-pickable')
        row.removeAttribute('data-expression-reference-unavailable')
      }
      markedRows.clear()
      for (const row of document.querySelectorAll<HTMLElement>(
        '[data-expression-item-id][data-expression-property]',
      )) {
        const candidate = getExpressionReferenceCandidate(row, expressionReferencePick)
        row.setAttribute(
          candidate
            ? 'data-expression-reference-pickable'
            : 'data-expression-reference-unavailable',
          'true',
        )
        markedRows.add(row)
      }
    }
    syncCandidateRows()

    const mutationRoot =
      pickWhipRootRef.current?.closest<HTMLElement>(
        '[data-pick-whip-scroll-area], [data-testid="motion-layer-scroll-area"]',
      ) ?? document.body
    const observer =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(syncCandidateRows)
    observer?.observe(mutationRoot, { childList: true, subtree: true })

    const handleCandidateClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null
      const row = element?.closest<HTMLElement>(
        '[data-expression-item-id][data-expression-property]',
      )
      if (!row) return
      event.preventDefault()
      event.stopPropagation()
      const candidate = getExpressionReferenceCandidate(row, expressionReferencePick)
      if (!candidate) {
        toast.info('Choose a compatible property', {
          id: 'expression-reference-compatible-help',
        })
        return
      }
      setExpressionReferencePick(null)
      insertExpressionReference(expressionReferencePick, candidate.value)
    }
    const handlePickKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setExpressionReferencePick(null)
      requestAnimationFrame(() => expressionTextareaRef.current?.focus())
    }
    document.addEventListener('click', handleCandidateClick, true)
    document.addEventListener('keydown', handlePickKeyDown, true)
    return () => {
      observer?.disconnect()
      document.removeEventListener('click', handleCandidateClick, true)
      document.removeEventListener('keydown', handlePickKeyDown, true)
      for (const row of markedRows) {
        row.removeAttribute('data-expression-reference-pickable')
        row.removeAttribute('data-expression-reference-unavailable')
      }
    }
  }, [expressionReferencePick, insertExpressionReference, pickWhipRootRef])

  return {
    expressionEditor,
    setExpressionEditor,
    expressionReferencePick,
    setExpressionReferencePick,
    expressionReferenceDrag,
    beginExpressionReferenceDrag,
    expressionDockOpen,
    expressionDockRef,
    expressionTextareaRef,
    openPropertyExpressionEditor,
    applyExpressionPreset,
  }
}
