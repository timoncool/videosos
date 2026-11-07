/**
 * Elements, as Kling's and the competitors' "@name" references: a character, an object or a place kept under a
 * name with its pictures. A prompt that names one with "@name" sends its pictures in the model's reference slot
 * and keeps the name as a word, so the same face or thing comes back in every run and every model.
 */

import type { Field, MediaRef } from './generate-api'

export interface PromptElement {
  name: string
  refs: MediaRef[]
}

const MENTION = /@([\p{L}\p{N}_-]+)/gu

/** The elements a text names, in the order it names them, each once. */
export function mentionedElements(text: string, elements: PromptElement[]): PromptElement[] {
  const found: PromptElement[] = []
  for (const match of text.matchAll(MENTION)) {
    const element = elements.find(
      (each) => each.name.toLocaleLowerCase() === match[1]!.toLocaleLowerCase(),
    )
    if (element && !found.includes(element)) found.push(element)
  }
  return found
}

/** The slot an element's pictures go to: the model's reference pictures, else its only picture slot that takes several. */
type MediaField = Extract<Field, { type: 'media' }>

function elementSlot(fields: Field[]): MediaField | null {
  const pictures = fields.filter(
    (field): field is MediaField => field.type === 'media' && field.media === 'image',
  )
  return (
    pictures.find((field) => field.role === 'reference') ??
    pictures.find((field) => field.max > 1) ??
    null
  )
}

export interface ElementsApplied {
  values: Record<string, unknown>
  /** Elements named in the prompt that the model has no slot for, or no room left in it. */
  left: string[]
}

/** The values a run is sent with: each named element's pictures added to the slot, "@name" written as "name". */
export function applyElements(
  fields: Field[],
  values: Record<string, unknown>,
  elements: PromptElement[],
): ElementsApplied {
  const prompts = fields.filter(
    (field) => field.role === 'prompt' && typeof values[field.key] === 'string',
  )
  const named = prompts.flatMap((field) => mentionedElements(values[field.key] as string, elements))
  const unique = named.filter((element, index) => named.indexOf(element) === index)
  if (unique.length === 0) return { values, left: [] }
  const next = { ...values }
  for (const field of prompts) {
    next[field.key] = (values[field.key] as string).replace(MENTION, (whole, name: string) =>
      unique.some((element) => element.name.toLocaleLowerCase() === name.toLocaleLowerCase())
        ? name
        : whole,
    )
  }
  const slot = elementSlot(fields)
  if (!slot) return { values: next, left: unique.map((element) => element.name) }
  const current = next[slot.key]
  const refs: MediaRef[] = Array.isArray(current)
    ? [...(current as MediaRef[])]
    : current
      ? [current as MediaRef]
      : []
  const max = slot.max
  const left: string[] = []
  for (const element of unique) {
    if (refs.length + element.refs.length > max) {
      left.push(element.name)
      continue
    }
    refs.push(...element.refs)
  }
  next[slot.key] = refs
  return { values: next, left }
}
