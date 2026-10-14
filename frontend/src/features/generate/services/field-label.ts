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
export function fieldLabel(t: TFunction, field: Pick<Field, 'key' | 'label'>): string {
  return t(`generate.fields.${normalKey(field.key)}`, { defaultValue: field.label })
}
