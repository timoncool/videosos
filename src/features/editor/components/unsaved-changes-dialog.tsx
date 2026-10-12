import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
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
import { Button } from '@/components/ui/button'
import { Save, Trash2 } from 'lucide-react'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('UnsavedChangesDialog')

interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => Promise<void>
  projectName?: string
}

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onSave,
  projectName,
}: UnsavedChangesDialogProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [isSaving, setIsSaving] = useState(false)

  const handleSaveAndExit = async () => {
    setIsSaving(true)
    try {
      await onSave()
      onOpenChange(false)
      navigate({ to: '/projects' })
    } catch (error) {
      logger.error('Failed to save project:', error)
      // Keep dialog open on error
    } finally {
      setIsSaving(false)
    }
  }

  const handleDiscard = () => {
    onOpenChange(false)
    navigate({ to: '/projects' })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('unsavedChanges.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {projectName ? (
              <Trans
                i18nKey="unsavedChanges.descriptionWithName"
                values={{ name: projectName }}
                components={{ strong: <strong /> }}
              />
            ) : (
              t('unsavedChanges.description')
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={isSaving}>{t('common.cancel')}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDiscard}
            disabled={isSaving}
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {t('unsavedChanges.discard')}
          </Button>
          <AlertDialogAction onClick={handleSaveAndExit} disabled={isSaving} className="gap-2">
            <Save className="w-4 h-4" />
            {isSaving ? t('unsavedChanges.saving') : t('unsavedChanges.saveAndExit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
