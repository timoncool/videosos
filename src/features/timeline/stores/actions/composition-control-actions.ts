import type {
  CompositionControlDefinition,
  CompositionControlKind,
  CompositionControlProperty,
} from '@/types/composition-controls'
import { COMPOSITION_CONTROLS_VERSION } from '@/types/composition-controls'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useCompositionsStore } from '../compositions-store'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'

export interface AddCompositionControlInput {
  name: string
  targetItemId: string
  property: CompositionControlProperty
  kind: CompositionControlKind
  defaultValue: string
}
function getCompositionControlSource(compositionId: string) {
  const composition = useCompositionsStore.getState().getComposition(compositionId)
  if (!composition || composition.editorKind !== 'composite-2d') return null
  const isActive = useCompositionNavigationStore.getState().activeCompositionId === compositionId
  return {
    composition,
    items: isActive ? useItemsStore.getState().items : composition.items,
    controls: composition.compositionControls?.controls ?? [],
  }
}

function commitControls(
  compositionId: string,
  controls: CompositionControlDefinition[],
  items: ReturnType<typeof useItemsStore.getState>['items'],
): void {
  useCompositionsStore.getState().updateComposition(compositionId, {
    items,
    compositionControls:
      controls.length > 0 ? { version: COMPOSITION_CONTROLS_VERSION, controls } : undefined,
  })
  useTimelineSettingsStore.getState().markDirty()
}

export function addCompositionControl(
  compositionId: string,
  input: AddCompositionControlInput,
): string | null {
  return execute(
    'ADD_COMPOSITION_CONTROL',
    () => {
      const source = getCompositionControlSource(compositionId)
      if (!source || !input.name.trim()) return null
      if (
        source.controls.some(
          (control) =>
            control.targetItemId === input.targetItemId && control.property === input.property,
        )
      ) {
        return null
      }

      const id = crypto.randomUUID()
      commitControls(
        compositionId,
        [
          ...source.controls,
          {
            id,
            name: input.name.trim(),
            targetItemId: input.targetItemId,
            property: input.property,
            kind: input.kind,
            defaultValue: input.defaultValue,
          },
        ],
        source.items,
      )
      return id
    },
    { compositionId, property: input.property },
  )
}

export function renameCompositionControl(
  compositionId: string,
  controlId: string,
  name: string,
): boolean {
  const trimmedName = name.trim()
  if (!trimmedName) return false
  return execute(
    'RENAME_COMPOSITION_CONTROL',
    () => {
      const source = getCompositionControlSource(compositionId)
      const control = source?.controls.find((candidate) => candidate.id === controlId)
      if (!source || !control || control.name === trimmedName) return false
      commitControls(
        compositionId,
        source.controls.map((candidate) =>
          candidate.id === controlId ? { ...candidate, name: trimmedName } : candidate,
        ),
        source.items,
      )
      return true
    },
    { compositionId, controlId },
  )
}

export function removeCompositionControl(compositionId: string, controlId: string): boolean {
  return execute(
    'REMOVE_COMPOSITION_CONTROL',
    () => {
      const source = getCompositionControlSource(compositionId)
      if (!source || !source.controls.some((control) => control.id === controlId)) return false
      commitControls(
        compositionId,
        source.controls.filter((control) => control.id !== controlId),
        source.items,
      )
      return true
    },
    { compositionId, controlId },
  )
}
