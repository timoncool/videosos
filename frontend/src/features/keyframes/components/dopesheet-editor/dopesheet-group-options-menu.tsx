import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AnimatableProperty } from '@/types/keyframe'
import { MINI_ICON_BUTTON_CLASS, MINI_ICON_CLASS } from './dopesheet-constants'

export interface DopesheetDimensionSeparationControl {
  label: string
  separated: boolean
  disabled?: boolean
  onChange: (separated: boolean) => void
}

export interface DopesheetDimensionSeparationEntry {
  property: AnimatableProperty
  control: DopesheetDimensionSeparationControl
}

interface DopesheetGroupOptionsMenuProps {
  groupLabel: string
  dimensionSeparation: DopesheetDimensionSeparationEntry | null
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
}

export function DopesheetGroupOptionsMenu({
  groupLabel,
  dimensionSeparation,
  disabled,
  isPropertyLocked,
}: DopesheetGroupOptionsMenuProps) {
  if (!dimensionSeparation) return null

  const { property, control } = dimensionSeparation
  const menuLabel = `${groupLabel} options`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`${MINI_ICON_BUTTON_CLASS} text-muted-foreground hover:text-foreground`}
          disabled={disabled || isPropertyLocked(property) || control.disabled}
          title={menuLabel}
          aria-label={menuLabel}
        >
          <MoreHorizontal className={MINI_ICON_CLASS} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuCheckboxItem
          checked={control.separated}
          onCheckedChange={(checked) => control.onChange(checked === true)}
        >
          Separate {control.label} dimensions
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
