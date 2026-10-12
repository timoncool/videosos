import type { TFunction } from 'i18next'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import {
  hasRedundantTransformParentLink,
  wouldCreateTransformParentCycle,
} from '@/shared/utils/transform-parenting'

export type TransformParentRejectionReason =
  | 'self'
  | 'unsupported-child'
  | 'unsupported-parent'
  | 'already-parented'
  | 'cycle'
  | 'duplicate-transform'

export interface TransformParentRejection {
  reason: TransformParentRejectionReason
  itemName: string
}

interface TransformParentValidationOptions {
  childItemId: string
  parentItemId: string
  itemById: Record<string, TimelineItem>
  keyframesByItemId: Record<string, ItemKeyframes>
}

function canParticipateInTransformHierarchy(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'adjustment'
}

export function getTransformParentRejection({
  childItemId,
  parentItemId,
  itemById,
  keyframesByItemId,
}: TransformParentValidationOptions): TransformParentRejection | null {
  const child = itemById[childItemId]
  const parent = itemById[parentItemId]
  if (!child || !parent) return null
  if (parentItemId === childItemId) {
    return { reason: 'self', itemName: child.label || child.type }
  }
  if (!canParticipateInTransformHierarchy(child)) {
    return { reason: 'unsupported-child', itemName: child.label || child.type }
  }
  if (!canParticipateInTransformHierarchy(parent)) {
    return { reason: 'unsupported-parent', itemName: parent.label || parent.type }
  }
  if (child.transformParent?.parentItemId === parentItemId) {
    return { reason: 'already-parented', itemName: parent.label || parent.type }
  }
  if (
    wouldCreateTransformParentCycle(
      childItemId,
      parentItemId,
      (itemId) => itemById[itemId],
      (itemId) => keyframesByItemId[itemId],
    )
  ) {
    return { reason: 'cycle', itemName: parent.label || parent.type }
  }
  if (
    hasRedundantTransformParentLink(
      childItemId,
      parentItemId,
      (itemId) => itemById[itemId],
      (itemId) => keyframesByItemId[itemId],
    )
  ) {
    return { reason: 'duplicate-transform', itemName: parent.label || parent.type }
  }
  return null
}

export function getTransformParentRejectionMessage(
  t: TFunction,
  rejection: TransformParentRejection,
): string {
  switch (rejection.reason) {
    case 'self':
      return t('editor.compose.parentPickWhipSelf', {
        defaultValue: 'A layer cannot parent itself.',
      })
    case 'unsupported-child':
      return t('editor.compose.parentPickWhipUnsupportedChild', {
        defaultValue: '{{name}} cannot be parented.',
        name: rejection.itemName,
      })
    case 'unsupported-parent':
      return t('editor.compose.parentPickWhipUnsupportedTarget', {
        defaultValue: '{{name}} cannot be used as a transform parent.',
        name: rejection.itemName,
      })
    case 'already-parented':
      return t('editor.compose.parentPickWhipAlreadyParented', {
        defaultValue: '{{name}} is already this layer’s parent.',
        name: rejection.itemName,
      })
    case 'cycle':
      return t('editor.compose.parentPickWhipCycle', {
        defaultValue: 'This parent link would create a circular dependency.',
      })
    case 'duplicate-transform':
      return t('editor.compose.parentPickWhipDuplicateTransform', {
        defaultValue:
          '{{name}} already drives this layer’s transform. Parenting it would apply the transform twice.',
        name: rejection.itemName,
      })
  }
}
