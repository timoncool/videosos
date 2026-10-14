import { describe, expect, it } from 'vitest'
import { applyElements, mentionedElements } from './prompt-elements'
import type { Field } from './generate-api'

const prompt = {
  key: 'prompt',
  label: 'Prompt',
  type: 'textarea',
  required: true,
  advanced: false,
  role: 'prompt',
} as Field
const refs = (max: number) =>
  ({
    key: 'input_references',
    label: 'References',
    type: 'media',
    media: 'image',
    min: 0,
    max,
    list: true,
    required: false,
    advanced: false,
    role: 'reference',
  }) as Field
const anna = { name: 'Анна', refs: [{ media: 'a1' }, { media: 'a2' }] }
const cat = { name: 'cat', refs: [{ media: 'c1' }] }

describe('elements named in a prompt', () => {
  it('finds each named element once, whatever its case, and leaves other @words alone', () => {
    expect(mentionedElements('@анна and @Cat meet @анна at hi@mail', [anna, cat])).toEqual([
      anna,
      cat,
    ])
  })

  it('sends their pictures in the reference slot after the pictures already there and keeps the names as words', () => {
    const applied = applyElements(
      [prompt, refs(4)],
      { prompt: '@Анна feeds @cat, @nobody', input_references: [{ media: 'x' }] },
      [anna, cat],
    )
    expect(applied.values).toEqual({
      prompt: 'Анна feeds cat, @nobody',
      input_references: [{ media: 'x' }, { media: 'a1' }, { media: 'a2' }, { media: 'c1' }],
    })
    expect(applied.left).toEqual([])
  })

  it('says which elements found no room or no slot', () => {
    expect(
      applyElements([prompt, refs(2)], { prompt: '@Анна and @cat' }, [anna, cat]).left,
    ).toEqual(['cat'])
    expect(applyElements([prompt], { prompt: '@cat' }, [anna, cat])).toEqual({
      values: { prompt: 'cat' },
      left: ['cat'],
    })
  })

  it('changes nothing when the prompt names no element', () => {
    const values = { prompt: 'a fox' }
    expect(applyElements([prompt, refs(4)], values, [anna]).values).toBe(values)
  })
})
