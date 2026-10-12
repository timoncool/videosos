import { useEffect, useMemo, useState } from 'react'
import { Palette, Plus, SlidersHorizontal, Trash2, Type } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type {
  CompositionControlDefinition,
  CompositionControlProperty,
} from '@/types/composition-controls'
import {
  addCompositionControl,
  removeCompositionControl,
  renameCompositionControl,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
} from '@/features/editor/deps/timeline-store'
import { getCompositionControlCandidates } from '@/shared/utils/composition-controls'
import { PropertySection } from '../components'

const EMPTY_CONTROLS: CompositionControlDefinition[] = []

function propertyLabel(property: CompositionControlProperty): string {
  if (property === 'text.text') return 'Text'
  if (property === 'text.color') return 'Text color'
  if (property === 'shape.fillColor') return 'Fill color'
  return 'Stroke color'
}

function defaultControlName(targetLabel: string, property: CompositionControlProperty): string {
  if (property === 'text.text') return targetLabel
  return `${targetLabel} ${propertyLabel(property).toLowerCase()}`
}

function ControlNameInput({
  compositionId,
  control,
}: {
  compositionId: string
  control: CompositionControlDefinition
}) {
  const [draft, setDraft] = useState(control.name)
  useEffect(() => setDraft(control.name), [control.name])

  const commit = () => {
    const trimmed = draft.trim()
    if (!trimmed) setDraft(control.name)
    else if (trimmed !== control.name) renameCompositionControl(compositionId, control.id, trimmed)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Escape') {
      setDraft(control.name)
      event.currentTarget.blur()
    }
  }

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className="h-7 min-w-0 flex-1 text-xs"
      aria-label={`Rename ${control.name}`}
    />
  )
}

export function CompositionControlsAuthoringSection({
  defaultOpen = true,
}: {
  defaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const [addOpen, setAddOpen] = useState(false)
  const activeCompositionId = useCompositionNavigationStore((state) => state.activeCompositionId)
  const composition = useCompositionsStore((state) =>
    activeCompositionId ? state.compositionById[activeCompositionId] : undefined,
  )
  const items = useItemsStore((state) => state.items)
  const controls = composition?.compositionControls?.controls ?? EMPTY_CONTROLS
  const existingTargets = useMemo(
    () => new Set(controls.map((control) => `${control.targetItemId}:${control.property}`)),
    [controls],
  )
  const availableCandidates = useMemo(
    () =>
      getCompositionControlCandidates(items).filter(
        (candidate) => !existingTargets.has(`${candidate.targetItemId}:${candidate.property}`),
      ),
    [existingTargets, items],
  )
  const itemLabelById = useMemo(() => new Map(items.map((item) => [item.id, item.label])), [items])

  if (!activeCompositionId || composition?.editorKind !== 'composite-2d') return null

  return (
    <PropertySection
      title={t('editor.compositionControls.authoringTitle', {
        defaultValue: `Published controls (${controls.length})`,
      })}
      icon={SlidersHorizontal}
      defaultOpen={defaultOpen}
    >
      <p className="px-1 pb-2 text-[11px] leading-snug text-muted-foreground">
        {t('editor.compositionControls.authoringHint', {
          defaultValue:
            'Choose the text and colors that stay editable when this composition is reused.',
        })}
      </p>

      {controls.map((control) => (
        <div
          key={control.id}
          className="group flex items-center gap-1.5 rounded-md py-1"
          data-testid={`composition-control-definition-${control.id}`}
        >
          {control.kind === 'text' ? (
            <Type className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Palette className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <ControlNameInput compositionId={activeCompositionId} control={control} />
            <div className="truncate px-2 pt-0.5 text-[10px] text-muted-foreground/70">
              {itemLabelById.get(control.targetItemId) ?? control.targetItemId} ·{' '}
              {propertyLabel(control.property)}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeCompositionControl(activeCompositionId, control.id)}
            aria-label={`Remove ${control.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={
              controls.length > 0 ? 'mt-2 h-7 w-full gap-1.5 text-xs' : 'h-8 w-full gap-1.5 text-xs'
            }
            disabled={availableCandidates.length === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            {controls.length > 0
              ? t('editor.compositionControls.addAnother', {
                  defaultValue: 'Expose another property',
                })
              : t('editor.compositionControls.add', { defaultValue: 'Expose property' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="left" className="w-64 p-1.5">
          <div className="max-h-72 overflow-y-auto">
            {availableCandidates.map((candidate) => (
              <button
                type="button"
                key={`${candidate.targetItemId}:${candidate.property}`}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-secondary/60"
                onClick={() => {
                  addCompositionControl(activeCompositionId, {
                    ...candidate,
                    name: defaultControlName(candidate.targetLabel, candidate.property),
                  })
                  setAddOpen(false)
                }}
              >
                {candidate.kind === 'text' ? (
                  <Type className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Palette className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs">{candidate.targetLabel}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {propertyLabel(candidate.property)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {availableCandidates.length === 0 && (
        <p className="px-1 pt-2 text-[10px] leading-snug text-muted-foreground/80">
          {controls.length > 0
            ? t('editor.compositionControls.allExposed', {
                defaultValue: 'All supported properties are exposed.',
              })
            : t('editor.compositionControls.noCandidates', {
                defaultValue: 'Add a text or shape layer to expose editable properties.',
              })}
        </p>
      )}
    </PropertySection>
  )
}
