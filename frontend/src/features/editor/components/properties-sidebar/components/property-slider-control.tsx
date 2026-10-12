import { RotateCcw } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import type { AnimatableProperty } from '@/types/keyframe'
import { SliderInput } from './slider-input'

type SliderInputProps = ComponentProps<typeof SliderInput>

interface PropertySliderControlProps extends Omit<SliderInputProps, 'className'> {
  className?: string
  keyframe?: {
    itemIds: string[]
    property: AnimatableProperty
    currentValue: number
    disabled?: boolean
  }
  onReset?: () => void
  resetLabel?: string
}

/** Standard property-panel composition: slider, optional keyframe, optional reset. */
export function PropertySliderControl({
  className,
  keyframe,
  onReset,
  resetLabel,
  ...sliderProps
}: PropertySliderControlProps) {
  return (
    <div className="flex w-full items-center gap-1">
      <SliderInput {...sliderProps} className={`min-w-0 flex-1 ${className ?? ''}`} />
      {keyframe && (
        <KeyframeToggle
          itemIds={keyframe.itemIds}
          property={keyframe.property}
          currentValue={keyframe.currentValue}
          disabled={keyframe.disabled}
        />
      )}
      {onReset && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={onReset}
          title={resetLabel}
          aria-label={resetLabel}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
