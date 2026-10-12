import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SaveAnimationPresetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing preset names in the project — drives the overwrite warning. */
  existingNames: string[]
  /** Persist the preset. Resolves false to surface a save failure inline. */
  onSave: (name: string) => Promise<boolean> | boolean
  defaultName?: string
}

/**
 * Presentational capture dialog (U6/U7). Validates an empty name (save
 * disabled) and warns on a duplicate name, switching the confirm action to
 * "Overwrite". Disk-write failures are surfaced via the `onSave` result.
 */
export function SaveAnimationPresetDialog({
  open,
  onOpenChange,
  existingNames,
  onSave,
  defaultName = '',
}: SaveAnimationPresetDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (open) {
      setName(defaultName)
      setFailed(false)
      setSaving(false)
    }
  }, [open, defaultName])

  const trimmedName = name.trim()
  const isDuplicate = existingNames.some(
    (existing) => existing.toLowerCase() === trimmedName.toLowerCase(),
  )
  const canSave = trimmedName.length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setFailed(false)
    try {
      const ok = await onSave(trimmedName)
      if (ok) {
        onOpenChange(false)
        return
      }
      setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editor.animatePresets.dialog.title')}</DialogTitle>
          <DialogDescription>{t('editor.animatePresets.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="animation-preset-name">
            {t('editor.animatePresets.dialog.nameLabel')}
          </Label>
          <Input
            id="animation-preset-name"
            value={name}
            autoFocus
            placeholder={t('editor.animatePresets.dialog.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Guard against committing mid-IME-composition (e.g. Japanese/Korean):
              // the Enter that confirms a candidate must not trigger the save.
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void handleSave()
              }
            }}
          />
          {isDuplicate && (
            <p className="text-xs text-amber-500">
              {t('editor.animatePresets.dialog.duplicateWarning')}
            </p>
          )}
          {failed && (
            <p className="text-xs text-destructive">{t('editor.animatePresets.saveFailed')}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('editor.animatePresets.dialog.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {isDuplicate
              ? t('editor.animatePresets.dialog.overwrite')
              : t('editor.animatePresets.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
