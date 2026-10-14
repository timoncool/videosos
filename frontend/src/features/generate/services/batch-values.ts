/**
 * One form's values for another model, as the competitors' "models x variants" batch sends one brief to several
 * models: each field of the other model takes the value of the field that means the same (the prompt, the
 * negative prompt, the reference pictures, the first frame) or has the same key; what the other model has no
 * field for stays out, and its own fields keep their defaults.
 */

import type { Field } from './generate-api'

export function carryValues(fromFields: Field[], values: Record<string, unknown>, toFields: Field[]): Record<string, unknown> {
  const carried: Record<string, unknown> = {}
  for (const field of toFields) {
    if (values[field.key] !== undefined) {
      carried[field.key] = values[field.key]
      continue
    }
    if (!field.role) continue
    const twin = fromFields.find((each) => each.role === field.role && values[each.key] !== undefined)
    if (twin) carried[field.key] = values[twin.key]
  }
  return carried
}
