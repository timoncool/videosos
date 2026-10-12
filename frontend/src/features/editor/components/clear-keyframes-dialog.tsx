import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  removeKeyframesForItem,
  removeKeyframesForProperty,
} from '@/features/editor/deps/timeline-store'
import { PROPERTY_LABELS } from '@/types/keyframe'
import { useClearKeyframesDialogStore } from '@/shared/state/clear-keyframes-dialog'

/**
 * Confirmation dialog for clearing keyframes from selected items.
 * Triggered by Shift+A hotkey or context menu actions.
 */
export function ClearKeyframesDialog() {
  const { t } = useTranslation()
  const isOpen = useClearKeyframesDialogStore((s) => s.isOpen)
  const itemIds = useClearKeyframesDialogStore((s) => s.itemIds)
  const property = useClearKeyframesDialogStore((s) => s.property)
  const close = useClearKeyframesDialogStore((s) => s.close)

  const handleConfirm = () => {
    if (property) {
      // Clear keyframes for specific property
      for (const itemId of itemIds) {
        removeKeyframesForProperty(itemId, property)
      }
    } else {
      // Clear all keyframes
      for (const itemId of itemIds) {
        removeKeyframesForItem(itemId)
      }
    }
    close()
  }

  const itemCount = itemIds.length
  const propertyLabel = property ? PROPERTY_LABELS[property] : null

  const title = property
    ? t('editor.clearKeyframesDialog.titleProperty', { property: propertyLabel })
    : t('editor.clearKeyframesDialog.titleAll')
  const description = property
    ? t('editor.clearKeyframesDialog.descriptionProperty', {
        property: propertyLabel,
        count: itemCount,
      })
    : t('editor.clearKeyframesDialog.descriptionAll', { count: itemCount })

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            <br />
            <span className="text-muted-foreground text-xs mt-1 block">
              {t('editor.clearKeyframesDialog.undoHint')}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            {t('editor.clearKeyframesDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
