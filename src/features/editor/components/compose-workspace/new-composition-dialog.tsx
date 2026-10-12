import { memo, useEffect, useState } from 'react'
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
import {
  createCompositeComposition,
  type CreateCompositeCompositionOptions,
} from '@/features/editor/deps/timeline-motion'

interface NewCompositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaults: { width: number; height: number; fps: number }
}

export const NewCompositionDialog = memo(function NewCompositionDialog({
  open,
  onOpenChange,
  defaults,
}: NewCompositionDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [width, setWidth] = useState(defaults.width)
  const [height, setHeight] = useState(defaults.height)
  const [fps, setFps] = useState(defaults.fps)
  const [durationSeconds, setDurationSeconds] = useState(10)

  useEffect(() => {
    if (!open) return
    setName('')
    setWidth(defaults.width)
    setHeight(defaults.height)
    setFps(defaults.fps)
    setDurationSeconds(10)
  }, [defaults.fps, defaults.height, defaults.width, open])

  const createComposition = () => {
    const options: CreateCompositeCompositionOptions = {
      name,
      width,
      height,
      fps,
      durationInFrames: Math.max(1, Math.round(fps * durationSeconds)),
    }
    createCompositeComposition(options)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editor.compose.dialog.title')}</DialogTitle>
          <DialogDescription>{t('editor.compose.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="compose-name">{t('editor.compose.dialog.name')}</Label>
            <Input
              id="compose-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('editor.compose.dialog.namePlaceholder')}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="compose-width">{t('editor.compose.dialog.width')}</Label>
              <Input
                id="compose-width"
                type="number"
                min={1}
                max={7680}
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="compose-height">{t('editor.compose.dialog.height')}</Label>
              <Input
                id="compose-height"
                type="number"
                min={1}
                max={4320}
                value={height}
                onChange={(event) => setHeight(Number(event.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="compose-fps">{t('editor.compose.dialog.frameRate')}</Label>
              <Input
                id="compose-fps"
                type="number"
                min={1}
                max={120}
                value={fps}
                onChange={(event) => setFps(Number(event.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="compose-duration">{t('editor.compose.dialog.durationSeconds')}</Label>
              <Input
                id="compose-duration"
                type="number"
                min={0.1}
                max={3600}
                step={0.1}
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={createComposition}>{t('editor.compose.dialog.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
