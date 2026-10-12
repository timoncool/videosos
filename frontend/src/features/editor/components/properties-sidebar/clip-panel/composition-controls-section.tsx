import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CompositionControlDefinition } from '@/types/composition-controls'
import type { CompositionItem, TimelineItem } from '@/types/timeline'
import { useCompositionsStore, updateItem } from '@/features/editor/deps/timeline-store'
import { getCompositionControlSourceValue } from '@/shared/utils/composition-controls'
import { ColorPicker, PropertyRow, PropertySection } from '../components'

const EMPTY_CONTROLS: CompositionControlDefinition[] = []

function TextControlInput({
  value,
  onCommit,
  label,
}: {
  value: string
  onCommit: (value: string) => void
  label: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
      className="h-7 text-xs"
      aria-label={label}
    />
  )
}

function CompositionOverrideRow({
  control,
  value,
  sourceValue,
  isOverridden,
  onChange,
}: {
  control: CompositionControlDefinition
  value: string
  sourceValue: string
  isOverridden: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const resetLabel = t('editor.compositionControls.resetOverride', {
    defaultValue: 'Reset {{name}} override',
    name: control.name,
  })

  return (
    <PropertyRow label={control.name}>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span
          className={
            isOverridden ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-primary' : 'h-1.5 w-1.5 shrink-0'
          }
          aria-label={
            isOverridden
              ? t('editor.compositionControls.overridden', {
                  defaultValue: '{{name}} is overridden',
                  name: control.name,
                })
              : undefined
          }
          aria-hidden={isOverridden ? undefined : true}
        />
        <div className="min-w-0 flex-1">
          {control.kind === 'text' ? (
            <TextControlInput value={value} label={control.name} onCommit={onChange} />
          ) : (
            <ColorPicker color={value} onChange={onChange} />
          )}
        </div>
        {isOverridden && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={() => onChange(sourceValue)}
            title={resetLabel}
            aria-label={resetLabel}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </PropertyRow>
  )
}

export function CompositionControlsSection({ items }: { items: TimelineItem[] }) {
  const { t } = useTranslation()
  const compositionItem =
    items.length === 1 && items[0]?.type === 'composition' ? (items[0] as CompositionItem) : null
  const composition = useCompositionsStore((state) =>
    compositionItem ? state.compositionById[compositionItem.compositionId] : undefined,
  )
  const controls = composition?.compositionControls?.controls ?? EMPTY_CONTROLS

  const sourceValueById = useMemo(
    () =>
      new Map(
        controls.map((control) => [
          control.id,
          getCompositionControlSourceValue(composition?.items ?? [], control),
        ]),
      ),
    [composition?.items, controls],
  )

  if (!compositionItem || controls.length === 0) return null

  const setControlValue = (control: CompositionControlDefinition, value: string) => {
    const next = { ...(compositionItem.compositionControlOverrides ?? {}) }
    if (value === sourceValueById.get(control.id)) delete next[control.id]
    else next[control.id] = value
    updateItem(compositionItem.id, {
      compositionControlOverrides: Object.keys(next).length > 0 ? next : undefined,
    })
  }

  return (
    <PropertySection
      title={t('editor.compositionControls.instanceTitle', { defaultValue: 'Template overrides' })}
      icon={SlidersHorizontal}
      defaultOpen
    >
      <p className="px-1 pb-2 text-[11px] leading-snug text-muted-foreground">
        {t('editor.compositionControls.instanceHint', {
          defaultValue:
            'Changes apply only to this instance. A blue dot marks values that differ from the source.',
        })}
      </p>
      {controls.map((control) => {
        const sourceValue = sourceValueById.get(control.id) ?? control.defaultValue
        const value = compositionItem.compositionControlOverrides?.[control.id] ?? sourceValue
        const isOverridden = Object.prototype.hasOwnProperty.call(
          compositionItem.compositionControlOverrides ?? {},
          control.id,
        )
        return (
          <CompositionOverrideRow
            key={control.id}
            control={control}
            value={value}
            sourceValue={sourceValue}
            isOverridden={isOverridden}
            onChange={(next) => setControlValue(control, next)}
          />
        )
      })}
      {compositionItem.compositionControlOverrides && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-start gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => updateItem(compositionItem.id, { compositionControlOverrides: undefined })}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('editor.compositionControls.resetAll', { defaultValue: 'Reset all overrides' })}
        </Button>
      )}
    </PropertySection>
  )
}
