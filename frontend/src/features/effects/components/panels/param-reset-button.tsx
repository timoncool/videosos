import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GpuParamValue } from './panel-props'

interface ParamResetButtonProps {
  effectId: string
  paramKey: string
  label: string
  value: GpuParamValue
  defaultValue: GpuParamValue
  onParamChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
}

export const ParamResetButton = memo(function ParamResetButton({
  effectId,
  paramKey,
  label,
  value,
  defaultValue,
  onParamChange,
}: ParamResetButtonProps) {
  const { t } = useTranslation()
  const resetLabel = `${t('effects.panel.resetToDefaults')}: ${label}`

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
      onClick={() => onParamChange(effectId, paramKey, defaultValue)}
      title={resetLabel}
      aria-label={resetLabel}
      disabled={Object.is(value, defaultValue)}
    >
      <RotateCcw className="h-3 w-3" />
    </Button>
  )
})
