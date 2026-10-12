import type { DirectLinkableProperty } from '@/types/keyframe'
import { getExpressionPresets, type ExpressionPresetGroup } from './dopesheet-expression-catalog'

const PRESET_GROUPS: readonly ExpressionPresetGroup[] = ['Adjust', 'Motion', 'Timing']

interface DopesheetExpressionPresetsMenuProps {
  property: DirectLinkableProperty
  onSelect: (source: string) => void
}

export function DopesheetExpressionPresetsMenu({
  property,
  onSelect,
}: DopesheetExpressionPresetsMenuProps) {
  const presets = getExpressionPresets(property)

  return (
    <select
      aria-label="Expression presets"
      defaultValue=""
      className="h-7 max-w-32 rounded-md border border-border bg-background px-2 text-[10px] text-muted-foreground outline-none hover:text-foreground focus:border-ring"
      onChange={(event) => {
        onSelect(event.currentTarget.value)
        event.currentTarget.value = ''
      }}
    >
      <option value="" disabled>
        Presets…
      </option>
      {PRESET_GROUPS.map((group) => {
        const groupedPresets = presets.filter((preset) => preset.group === group)
        if (groupedPresets.length === 0) return null
        return (
          <optgroup key={group} label={group}>
            {groupedPresets.map((preset) => (
              <option key={preset.label} value={preset.source} title={preset.description}>
                {preset.label}
              </option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
