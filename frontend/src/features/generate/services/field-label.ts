import type { TFunction } from 'i18next'
import type { Field } from './generate-api'

/** The key a field goes by whatever the provider calls it: `inputs.seedImage`, `negativePrompt` and `seed_image` alike. */
function normalKey(key: string): string {
  return key
    .replace(/^inputs\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/** A model's field in the window's language when it is a known one; otherwise the name the provider gave it. */
/** A text longer than its model takes: how long it is and the limit, or null when it fits. */
export function overLength(field: Field, value: unknown): { count: number; max: number } | null {
  if (
    (field.type !== 'text' && field.type !== 'textarea') ||
    field.max_length === undefined ||
    typeof value !== 'string'
  )
    return null
  const count = Array.from(value).length
  return count > field.max_length ? { count, max: field.max_length } : null
}

export function fieldLabel(t: TFunction, field: Pick<Field, 'key' | 'label'>): string {
  return t(`generate.fields.${normalKey(field.key)}`, { defaultValue: field.label })
}

/**
 * A sentence the server wrote in English (a price note, a field's hint) in the window's language when it is
 * one VideoSOS words itself; a provider's own sentence has no translation and is shown as it came.
 */
export function providerWords(t: TFunction, text: string): string {
  const key = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return t(`generate.providerWords.${key}`, { defaultValue: text })
}
