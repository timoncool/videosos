/** Current persisted schema for authored controls exposed by a composition. */
export const COMPOSITION_CONTROLS_VERSION = 1 as const

export type CompositionControlProperty =
  | 'text.text'
  | 'text.color'
  | 'shape.fillColor'
  | 'shape.strokeColor'

export type CompositionControlKind = 'text' | 'color'

export interface CompositionControlDefinition {
  id: string
  name: string
  targetItemId: string
  property: CompositionControlProperty
  kind: CompositionControlKind
  defaultValue: string
}

export interface CompositionControlSchemaV1 {
  version: typeof COMPOSITION_CONTROLS_VERSION
  controls: CompositionControlDefinition[]
}

export type CompositionControlSchema = CompositionControlSchemaV1
export type CompositionControlOverrides = Record<string, string>
