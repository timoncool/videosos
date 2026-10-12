import {
  areDirectLinkPropertiesCompatible,
  isDirectLinkableProperty,
  type DirectLinkableProperty,
} from '@/types/keyframe'

export interface ExpressionReferenceDragOrigin {
  itemId: string
  property: DirectLinkableProperty
  selectionStart: number
  selectionEnd: number
}

export interface ExpressionReferenceCandidate {
  itemId: string
  property: DirectLinkableProperty
}

export interface PropertyExpressionDraft {
  property: DirectLinkableProperty
  source: string
  enabled: boolean
  selectionStart: number
  selectionEnd: number
}

export function getExpressionReferenceCandidate(
  element: Element | null,
  origin: ExpressionReferenceDragOrigin,
) {
  const row = element?.closest<HTMLElement>('[data-expression-item-id][data-expression-property]')
  const itemId = row?.dataset.expressionItemId
  const property = row?.dataset.expressionProperty
  if (!row || !itemId || !property || !isDirectLinkableProperty(property)) return null
  if (itemId === origin.itemId && property === origin.property) return null
  if (!areDirectLinkPropertiesCompatible(origin.property, property)) return null
  return { row, value: { itemId, property } }
}

export function resolveExpressionReferenceTarget(
  clientX: number,
  clientY: number,
  origin: ExpressionReferenceDragOrigin,
) {
  const candidate = getExpressionReferenceCandidate(
    document.elementFromPoint(clientX, clientY),
    origin,
  )
  return candidate ? { status: 'valid' as const, ...candidate } : null
}
