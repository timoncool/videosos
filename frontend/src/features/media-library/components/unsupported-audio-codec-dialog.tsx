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
import { Volume2, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface UnsupportedCodecFile {
  fileName: string
  audioCodec: string
}

interface UnsupportedAudioCodecDialogProps {
  open: boolean
  files: UnsupportedCodecFile[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Dialog shown when importing media files with unsupported audio codecs.
 * Informs the user that waveform visualization won't be available for these files.
 */
export function UnsupportedAudioCodecDialog({
  open,
  files,
  onConfirm,
  onCancel,
}: UnsupportedAudioCodecDialogProps) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent className="sm:max-w-[500px] overflow-hidden">
        <AlertDialogHeader className="overflow-hidden">
          <AlertDialogTitle className="flex items-center gap-2">
            <VolumeX className="w-5 h-5 text-yellow-500 shrink-0" />
            {t('media.unsupportedCodec.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                {files.length === 1
                  ? t('media.unsupportedCodec.bodySingle')
                  : t('media.unsupportedCodec.bodyMultiple', { count: files.length })}
              </p>

              <div className="max-h-[200px] overflow-y-auto overflow-x-hidden space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 p-2 bg-secondary/50 rounded text-sm"
                  >
                    <Volume2 className="w-4 h-4 text-muted-foreground" />
                    <span className="truncate" title={file.fileName}>
                      {file.fileName}
                    </span>
                    <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-secondary rounded uppercase whitespace-nowrap">
                      {file.audioCodec}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">{t('media.unsupportedCodec.note')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t('media.unsupportedCodec.cancelImport')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('media.unsupportedCodec.importAnyway')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
