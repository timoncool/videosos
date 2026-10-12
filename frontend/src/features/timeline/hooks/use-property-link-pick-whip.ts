import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DirectLinkableProperty } from '@/types/keyframe'
import { areDirectLinkPropertiesCompatible, isDirectLinkableProperty } from '@/types/keyframe'
import {
  removeDirectPropertyLink,
  setDirectPropertyLink,
} from '@/features/timeline/stores/actions/keyframe-actions'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { wouldCreateDirectPropertyLinkCycle } from '@/features/timeline/deps/keyframes'
import { useMotionPickWhipDrag } from '@/shared/hooks/use-pick-whip-drag'

interface PropertyEndpoint {
  itemId: string
  property: DirectLinkableProperty
}

function resolvePropertyCandidateElement(element: Element | null, origin: PropertyEndpoint) {
  const row = element?.closest<HTMLElement>('[data-expression-item-id][data-expression-property]')
  const itemId = row?.dataset.expressionItemId
  const property = row?.dataset.expressionProperty
  if (!row || !itemId || !property || !isDirectLinkableProperty(property)) return null
  if (itemId === origin.itemId && property === origin.property) return null
  if (!areDirectLinkPropertiesCompatible(origin.property, property)) return null
  return { row, value: { itemId, property } }
}

function resolvePropertyCandidate(clientX: number, clientY: number, origin: PropertyEndpoint) {
  const candidate = resolvePropertyCandidateElement(
    document.elementFromPoint(clientX, clientY),
    origin,
  )
  return candidate ? { status: 'valid' as const, ...candidate } : null
}

function resolveEligiblePropertyRows(origin: PropertyEndpoint): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-expression-item-id][data-expression-property]'),
  ).filter((row) => resolvePropertyCandidateElement(row, origin) !== null)
}

export function usePropertyLinkPickWhip() {
  const { t } = useTranslation()
  const commit = useCallback(
    (target: PropertyEndpoint, source: PropertyEndpoint) => {
      const keyframesByItemId = useKeyframesStore.getState().keyframesByItemId
      if (
        wouldCreateDirectPropertyLinkCycle(
          target.itemId,
          target.property,
          source.itemId,
          source.property,
          (itemId) => keyframesByItemId[itemId],
        )
      ) {
        toast.error(t('editor.compose.propertyLinkCycle'))
        return
      }
      setDirectPropertyLink(target.itemId, {
        type: 'link',
        targetProperty: target.property,
        sourceItemId: source.itemId,
        sourceProperty: source.property,
        enabled: true,
        timeOffsetFrames: 0,
      })
    },
    [t],
  )
  const { drag: genericDrag, begin: beginDrag } = useMotionPickWhipDrag({
    hoverAttribute: 'data-expression-link-hover',
    eligibleAttribute: 'data-expression-link-eligible',
    resolveEligibleRows: resolveEligiblePropertyRows,
    resolveTarget: resolvePropertyCandidate,
    onCommit: commit,
  })

  const begin = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      itemId: string,
      property: DirectLinkableProperty,
    ) => beginDrag(event, { itemId, property }),
    [beginDrag],
  )
  const remove = useCallback((itemId: string, property: DirectLinkableProperty) => {
    removeDirectPropertyLink(itemId, property)
  }, [])
  const drag = genericDrag
    ? {
        pointerId: genericDrag.pointerId,
        targetItemId: genericDrag.origin.itemId,
        targetProperty: genericDrag.origin.property,
        startX: genericDrag.startX,
        startY: genericDrag.startY,
        currentX: genericDrag.currentX,
        currentY: genericDrag.currentY,
        moved: genericDrag.moved,
        sourceItemId: genericDrag.candidate?.value.itemId ?? null,
        sourceProperty: genericDrag.candidate?.value.property ?? null,
        clipBounds: genericDrag.clipBounds,
        presentation: genericDrag.presentation,
      }
    : null

  return { drag, begin, remove }
}
