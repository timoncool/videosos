import { Check, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface DopesheetViewOptionsMenuProps {
  disabled: boolean
  visualizationMode: 'dopesheet' | 'graph'
  graphRulerUnit: 'frames' | 'seconds'
  onChangeRulerUnit: (unit: 'frames' | 'seconds') => void
  graphHandleVisibility: 'selected' | 'all'
  onToggleGraphHandleVisibility: () => void
  autoZoomGraphHeight: boolean
  onToggleAutoZoomGraphHeight: () => void
}

export function DopesheetViewOptionsMenu({
  disabled,
  visualizationMode,
  graphRulerUnit,
  onChangeRulerUnit,
  graphHandleVisibility,
  onToggleGraphHandleVisibility,
  autoZoomGraphHeight,
  onToggleAutoZoomGraphHeight,
}: DopesheetViewOptionsMenuProps) {
  const { t } = useTranslation()
  const menuLabel =
    visualizationMode === 'graph'
      ? t('timeline.keyframeEditor.graphViewOptions')
      : t('timeline.keyframeEditor.sheetViewOptions')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={disabled}
          aria-label={menuLabel}
          title={menuLabel}
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onChangeRulerUnit('seconds')
          }}
        >
          <Check className={cn('h-3.5 w-3.5', graphRulerUnit !== 'seconds' && 'opacity-0')} />
          {t('timeline.keyframeEditor.displayTimeRulerSeconds')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onChangeRulerUnit('frames')
          }}
        >
          <Check className={cn('h-3.5 w-3.5', graphRulerUnit !== 'frames' && 'opacity-0')} />
          {t('timeline.keyframeEditor.displayTimeRulerFrames')}
        </DropdownMenuItem>
        {visualizationMode === 'graph' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onToggleGraphHandleVisibility()
              }}
            >
              <Check
                className={cn('h-3.5 w-3.5', graphHandleVisibility !== 'all' && 'opacity-0')}
              />
              {t('timeline.keyframeEditor.showAllHandles')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onToggleAutoZoomGraphHeight()
              }}
            >
              <Check className={cn('h-3.5 w-3.5', !autoZoomGraphHeight && 'opacity-0')} />
              {t('timeline.keyframeEditor.autoZoomGraphHeight')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
