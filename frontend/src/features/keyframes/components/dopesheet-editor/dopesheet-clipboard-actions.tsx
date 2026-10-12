import { ClipboardPaste, Copy, Scissors } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface DopesheetClipboardActionsProps {
  disabled: boolean
  hasSelection: boolean
  hasKeyframeClipboard: boolean
  isKeyframeClipboardCut: boolean
  onCopyKeyframes?: () => void
  onCutKeyframes?: () => void
  onPasteKeyframes?: () => void
}

export function DopesheetClipboardActions({
  disabled,
  hasSelection,
  hasKeyframeClipboard,
  isKeyframeClipboardCut,
  onCopyKeyframes,
  onCutKeyframes,
  onPasteKeyframes,
}: DopesheetClipboardActionsProps) {
  const { t } = useTranslation()

  if (!onCopyKeyframes && !onCutKeyframes && !onPasteKeyframes) {
    return null
  }

  const pasteLabel = isKeyframeClipboardCut
    ? t('timeline.keyframeEditor.moveKeyframesFromClipboard')
    : t('timeline.keyframeEditor.pasteKeyframes')

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/70 bg-background/85 px-0.5 py-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onCopyKeyframes}
        disabled={disabled || !hasSelection || !onCopyKeyframes}
        title={t('timeline.keyframeEditor.copySelectedKeyframes')}
        aria-label={t('timeline.keyframeEditor.copySelectedKeyframes')}
      >
        <Copy className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onCutKeyframes}
        disabled={disabled || !hasSelection || !onCutKeyframes}
        title={t('timeline.keyframeEditor.cutSelectedKeyframes')}
        aria-label={t('timeline.keyframeEditor.cutSelectedKeyframes')}
      >
        <Scissors className="h-3 w-3" />
      </Button>
      <Button
        variant={isKeyframeClipboardCut ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onPasteKeyframes}
        disabled={disabled || !hasKeyframeClipboard || !onPasteKeyframes}
        title={pasteLabel}
        aria-label={pasteLabel}
      >
        <ClipboardPaste className="h-3 w-3" />
      </Button>
      {isKeyframeClipboardCut && hasKeyframeClipboard && (
        <span className="pl-0.5 text-[10px] font-medium text-amber-500">
          {t('timeline.keyframeEditor.cut')}
        </span>
      )}
    </div>
  )
}
