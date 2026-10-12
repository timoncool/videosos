import type {
  CompositionControlDefinition,
  CompositionControlKind,
  CompositionControlOverrides,
  CompositionControlProperty,
  CompositionControlSchema,
} from '@/types/composition-controls'
import { COMPOSITION_CONTROLS_VERSION } from '@/types/composition-controls'
import type { TimelineItem } from '@/types/timeline'

export interface CompositionControlCandidate {
  targetItemId: string
  targetLabel: string
  property: CompositionControlProperty
  kind: CompositionControlKind
  defaultValue: string
}

type ControlValueReader = (item: TimelineItem) => string | null
type ControlValueWriter = (item: TimelineItem, value: string) => TimelineItem

const CONTROL_VALUE_READERS = {
  'text.text': (item) => (item.type === 'text' && !item.textSpans?.length ? item.text : null),
  'text.color': (item) => (item.type === 'text' && !item.textSpans?.length ? item.color : null),
  'shape.fillColor': (item) =>
    item.type === 'shape' && item.fillType !== 'linear' ? item.fillColor : null,
  'shape.strokeColor': (item) =>
    item.type === 'shape' && item.strokeEnabled && item.strokeColor ? item.strokeColor : null,
} satisfies Record<CompositionControlProperty, ControlValueReader>

const CONTROL_VALUE_WRITERS = {
  'text.text': (item, value) =>
    item.type === 'text' && !item.textSpans?.length && item.text !== value
      ? { ...item, text: value }
      : item,
  'text.color': (item, value) =>
    item.type === 'text' && !item.textSpans?.length && item.color !== value
      ? { ...item, color: value }
      : item,
  'shape.fillColor': (item, value) =>
    item.type === 'shape' && item.fillType !== 'linear' && item.fillColor !== value
      ? { ...item, fillColor: value }
      : item,
  'shape.strokeColor': (item, value) =>
    item.type === 'shape' && item.strokeColor !== value ? { ...item, strokeColor: value } : item,
} satisfies Record<CompositionControlProperty, ControlValueWriter>

function readControlValue(item: TimelineItem, property: CompositionControlProperty): string | null {
  return CONTROL_VALUE_READERS[property](item)
}

export function getCompositionControlSourceValue(
  items: readonly TimelineItem[],
  control: Pick<CompositionControlDefinition, 'targetItemId' | 'property' | 'defaultValue'>,
): string {
  const target = items.find((item) => item.id === control.targetItemId)
  return (target && readControlValue(target, control.property)) ?? control.defaultValue
}

export function getCompositionControlCandidates(
  items: readonly TimelineItem[],
): CompositionControlCandidate[] {
  return items.flatMap((item) => {
    const properties: Array<[CompositionControlProperty, CompositionControlKind]> =
      item.type === 'text'
        ? [
            ['text.text', 'text'],
            ['text.color', 'color'],
          ]
        : item.type === 'shape'
          ? [
              ['shape.fillColor', 'color'],
              ['shape.strokeColor', 'color'],
            ]
          : []

    return properties.flatMap(([property, kind]) => {
      const defaultValue = readControlValue(item, property)
      return defaultValue === null
        ? []
        : [{ targetItemId: item.id, targetLabel: item.label, property, kind, defaultValue }]
    })
  })
}

function applyControlValue(
  item: TimelineItem,
  property: CompositionControlProperty,
  value: string,
): TimelineItem {
  return CONTROL_VALUE_WRITERS[property](item, value)
}

export function applyCompositionControlOverrides(
  items: readonly TimelineItem[],
  schema: CompositionControlSchema | undefined,
  overrides: CompositionControlOverrides | undefined,
): TimelineItem[] {
  if (!schema?.controls.length || !overrides || Object.keys(overrides).length === 0) {
    return items as TimelineItem[]
  }

  const controlsByItemId = new Map<string, CompositionControlDefinition[]>()
  for (const control of schema.controls) {
    if (typeof overrides[control.id] !== 'string') continue
    const controls = controlsByItemId.get(control.targetItemId)
    if (controls) controls.push(control)
    else controlsByItemId.set(control.targetItemId, [control])
  }
  if (controlsByItemId.size === 0) return items as TimelineItem[]

  let changed = false
  const resolved = items.map((item) => {
    const controls = controlsByItemId.get(item.id)
    if (!controls) return item
    let next = item
    for (const control of controls) {
      next = applyControlValue(next, control.property, overrides[control.id]!)
    }
    changed ||= next !== item
    return next
  })
  return changed ? resolved : (items as TimelineItem[])
}

function isControlProperty(value: unknown): value is CompositionControlProperty {
  return (
    value === 'text.text' ||
    value === 'text.color' ||
    value === 'shape.fillColor' ||
    value === 'shape.strokeColor'
  )
}

interface ParsedControlDefinition {
  id: string
  name: string
  targetItemId: string
  property: CompositionControlProperty
  kind: unknown
  defaultValue: unknown
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseControlDefinition(value: unknown): ParsedControlDefinition | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<CompositionControlDefinition>
  const id = readNonEmptyString(entry.id)
  const name = readNonEmptyString(entry.name)
  const targetItemId = readNonEmptyString(entry.targetItemId)
  if (!id || !name || !targetItemId || !isControlProperty(entry.property)) return null
  return {
    id,
    name,
    targetItemId,
    property: entry.property,
    kind: entry.kind,
    defaultValue: entry.defaultValue,
  }
}

function resolveControlDefinition(
  entry: ParsedControlDefinition,
  itemById: ReadonlyMap<string, TimelineItem>,
): CompositionControlDefinition | null {
  const target = itemById.get(entry.targetItemId)
  if (!target) return null
  const sourceValue = readControlValue(target, entry.property)
  if (sourceValue === null) return null
  const kind: CompositionControlKind = entry.property === 'text.text' ? 'text' : 'color'
  if (entry.kind !== kind) return null
  return {
    id: entry.id,
    name: entry.name,
    targetItemId: entry.targetItemId,
    property: entry.property,
    kind,
    defaultValue: typeof entry.defaultValue === 'string' ? entry.defaultValue : sourceValue,
  }
}

export function sanitizeCompositionControlSchema(
  value: unknown,
  items: readonly TimelineItem[],
): CompositionControlSchema | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<CompositionControlSchema>
  if (candidate.version !== COMPOSITION_CONTROLS_VERSION || !Array.isArray(candidate.controls)) {
    return undefined
  }

  const itemById = new Map(items.map((item) => [item.id, item]))
  const seenIds = new Set<string>()
  const seenTargets = new Set<string>()
  const controls: CompositionControlDefinition[] = []
  for (const value of candidate.controls) {
    const parsed = parseControlDefinition(value)
    if (!parsed || seenIds.has(parsed.id)) continue
    const control = resolveControlDefinition(parsed, itemById)
    if (!control) continue
    const targetKey = `${control.targetItemId}:${control.property}`
    if (seenTargets.has(targetKey)) continue
    seenIds.add(control.id)
    seenTargets.add(targetKey)
    controls.push(control)
  }

  return controls.length > 0 ? { version: COMPOSITION_CONTROLS_VERSION, controls } : undefined
}
