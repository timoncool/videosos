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
import { getKeyframeGroupLabel } from '@/features/keyframes/utils/property-i18n'
import type { PropertyAccordionGroup } from './property-groups'

interface DopesheetParameterMenuProps {
  disabled: boolean
  hasAvailableProperties: boolean
  parameterFilter: 'all' | 'keyframed'
  onToggleKeyframedOnly: () => void
  allPropertyGroups: PropertyAccordionGroup[]
  visibleGroups: Record<string, boolean>
  onToggleVisibleGroup: (id: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onResetParameterView: () => void
}

export function DopesheetParameterMenu({
  disabled,
  hasAvailableProperties,
  parameterFilter,
  onToggleKeyframedOnly,
  allPropertyGroups,
  visibleGroups,
  onToggleVisibleGroup,
  onExpandAll,
  onCollapseAll,
  onResetParameterView,
}: DopesheetParameterMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={disabled || !hasAvailableProperties}
          aria-label={t('timeline.keyframeEditor.parameterDisplayOptions')}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onToggleKeyframedOnly()
          }}
        >
          <Check className={cn('h-3.5 w-3.5', parameterFilter !== 'keyframed' && 'opacity-0')} />
          {t('timeline.keyframeEditor.displayKeyframedParameters')}
        </DropdownMenuItem>
        {allPropertyGroups.length > 0 && <DropdownMenuSeparator />}
        {allPropertyGroups.map((group) => {
          const isVisible = visibleGroups[group.id] ?? true
          return (
            <DropdownMenuItem
              key={group.id}
              onSelect={(event) => {
                event.preventDefault()
                onToggleVisibleGroup(group.id)
              }}
            >
              <Check className={cn('h-3.5 w-3.5', !isVisible && 'opacity-0')} />
              {t('timeline.keyframeEditor.displayGroupParameters', {
                group: getKeyframeGroupLabel(t, group.id, group.label),
              })}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onExpandAll}>
          {t('timeline.keyframeEditor.expandAllParameters')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCollapseAll}>
          {t('timeline.keyframeEditor.collapseAllParameters')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onResetParameterView}>
          {t('timeline.keyframeEditor.resetParameterView')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
