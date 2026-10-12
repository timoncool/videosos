import { MoveHorizontal, MoveVertical, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { MiniZoomControl } from './mini-zoom-control'

interface DopesheetEditActionsProps {
  disabled: boolean
  hasSelection: boolean
  removeKeyframesAvailable: boolean
  handleRemoveKeyframes: () => void
  horizontalZoomValue: number
  horizontalZoomDisabled: boolean
  setHorizontalZoomValue: (value: number) => void
  resetViewport: () => void
  visualizationMode: 'dopesheet' | 'graph'
  graphVerticalZoomValue: number
  verticalZoomDisabled: boolean
  setGraphVerticalZoomValue: (value: number) => void
}

export function DopesheetEditActions({
  disabled,
  hasSelection,
  removeKeyframesAvailable,
  handleRemoveKeyframes,
  horizontalZoomValue,
  horizontalZoomDisabled,
  setHorizontalZoomValue,
  resetViewport,
  visualizationMode,
  graphVerticalZoomValue,
  verticalZoomDisabled,
  setGraphVerticalZoomValue,
}: DopesheetEditActionsProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center rounded-md border border-border/70 bg-background/85 px-0.5 py-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
        onClick={handleRemoveKeyframes}
        disabled={disabled || !hasSelection || !removeKeyframesAvailable}
        title={t('timeline.keyframeEditor.removeSelectedKeyframes')}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
      <div className="mx-0.5 h-3.5 w-px bg-border/80" />
      <MiniZoomControl
        icon={<MoveHorizontal className="h-3 w-3" />}
        label={t('timeline.keyframeEditor.horizontalZoom')}
        value={horizontalZoomValue}
        disabled={disabled || horizontalZoomDisabled}
        onValueChange={setHorizontalZoomValue}
        onReset={resetViewport}
      />
      {visualizationMode === 'graph' && (
        <>
          <div className="mx-0.5 h-3.5 w-px bg-border/80" />
          <MiniZoomControl
            icon={<MoveVertical className="h-3 w-3" />}
            label={t('timeline.keyframeEditor.verticalZoom')}
            value={graphVerticalZoomValue}
            disabled={disabled || verticalZoomDisabled}
            onValueChange={setGraphVerticalZoomValue}
            onReset={() => setGraphVerticalZoomValue(0)}
          />
        </>
      )}
    </div>
  )
}
